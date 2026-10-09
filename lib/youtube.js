/*
 * YouTube live chat, read the way YouTube's own chat box does: load the
 * stream's chat page once, then poll its "get_live_chat" endpoint with the
 * continuation token it hands back. Undocumented, so it can change; the page
 * and response parsers are pure and unit-tested against real responses.
 */

import { tokenize } from './format.js';

const YT = 'https://www.youtube.com';

/* ---- Pages (pure) ---- */

/** The JSON assigned to ytInitialData in a YouTube page, or null. */
function extractInitialData(html) {
  const m = /(?:window\["ytInitialData"\]|var ytInitialData)\s*=\s*(\{.+?\});\s*<\/script>/s.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** The live video a channel's /live page points at, or null if it isn't live. */
export function liveVideoIdFromChannelPage(html) {
  const canonical = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/.exec(html);
  return canonical ? canonical[1] : null;
}

const continuationOf = (c) =>
  c?.invalidationContinuationData || c?.timedContinuationData || c?.reloadContinuationData || null;

/**
 * How long to wait before asking for more chat (ms), after a poll that got `actions` and waited `previous`.
 * A live stream's chat hands back an "invalidation" continuation that says 10 s: YouTube's own page is woken
 * sooner by a push we don't get, so waiting that long made messages up to 10 s late. Ask every second while
 * messages come, slowing to every 3 s in a quiet chat. Other kinds: as YouTube says, between 1 and 10 s.
 */
export function nextPoll(continuation, actions, previous = 1000) {
  if (continuation?.invalidationContinuationData) return actions?.length ? 1000 : Math.min(3000, Math.round(previous * 1.5));
  return Math.min(10000, Math.max(1000, Number(continuationOf(continuation)?.timeoutMs) || 5000));
}

/**
 * From the live chat page: what polling needs, plus the messages already shown.
 * Prefers the "Live chat" view (every message) over "Top chat" (filtered).
 */
export function parseLiveChatPage(html) {
  const data = extractInitialData(html);
  const renderer = data?.contents?.liveChatRenderer;
  if (!renderer) return null;
  const views = renderer.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems || [];
  const allMessages = views.length > 1 ? views[1].continuation?.reloadContinuationData?.continuation : null;
  return {
    apiKey: /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1] || '',
    clientVersion: /"clientVersion":"([\d.]+)"/.exec(html)?.[1] || '2.20240101.00.00',
    continuation: allMessages || continuationOf(renderer.continuations?.[0])?.continuation || null,
    actions: renderer.actions || [],
  };
}

/* ---- Messages (pure) ---- */

/** Message runs → parts: text (with links), emoji images. */
export function runsToParts(runs = []) {
  const parts = [];
  for (const run of runs) {
    if (run.emoji) {
      const thumbs = run.emoji.image?.thumbnails || [];
      const name = run.emoji.shortcuts?.[0] || run.emoji.emojiId || '';
      // Standard emoji: show the character itself; channel emoji: the image.
      if (!run.emoji.isCustomEmoji && run.emoji.emojiId && !/^UC/.test(run.emoji.emojiId)) {
        parts.push({ type: 'text', text: run.emoji.emojiId });
      } else if (thumbs.length) {
        parts.push({ type: 'emote', name, url: thumbs.at(-1).url });
      }
    } else if (run.navigationEndpoint?.urlEndpoint?.url) {
      const raw = run.navigationEndpoint.urlEndpoint.url;
      // YouTube wraps outside links in /redirect?q=…; anything but a web link stays plain text.
      let href = raw.startsWith('/') ? `${YT}${raw}` : raw;
      try {
        const url = new URL(href);
        if (url.hostname.endsWith('youtube.com') && url.pathname === '/redirect') href = url.searchParams.get('q') || href;
        if (!/^https?:$/.test(new URL(href).protocol)) throw new Error('not a web link');
        parts.push({ type: 'link', text: run.text || href, href });
      } catch {
        parts.push({ type: 'text', text: run.text || '' });
      }
    } else if (typeof run.text === 'string') {
      parts.push(...tokenize(run.text));
    }
  }
  return parts;
}

const BADGE_TYPES = { OWNER: 'owner', MODERATOR: 'moderator', VERIFIED: 'verified' };

function authorBadges(list = []) {
  return list.map(({ liveChatAuthorBadgeRenderer: b }) => {
    const type = BADGE_TYPES[b?.icon?.iconType] || (b?.customThumbnail ? 'member' : 'other');
    return { type, title: b?.tooltip || type, url: b?.customThumbnail?.thumbnails?.at(-1)?.url || '' };
  });
}

const simple = (t) => t?.simpleText ?? (t?.runs || []).map((r) => r.text || '').join('');

/** YouTube's colours are ARGB integers (Super Chat tiers). */
function argbToCss(n) {
  if (typeof n !== 'number') return '';
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** A chat item → message, or null for items we don't show. */
function itemToMessage(item) {
  const [kind, r] =
    item.liveChatTextMessageRenderer ? ['chat', item.liveChatTextMessageRenderer]
    : item.liveChatPaidMessageRenderer ? ['superchat', item.liveChatPaidMessageRenderer]
    : item.liveChatMembershipItemRenderer ? ['member', item.liveChatMembershipItemRenderer]
    : item.liveChatPaidStickerRenderer ? ['superchat', item.liveChatPaidStickerRenderer]
    : [null, null];
  if (!r) return null;
  const parts = runsToParts(r.message?.runs || []);
  const system =
    kind === 'member'
      ? simple(r.headerSubtext) || 'New member'
      : kind === 'superchat'
        ? `Super Chat ${simple(r.purchaseAmountText)}`
        : '';
  return {
    id: r.id,
    platform: 'youtube',
    time: Number(r.timestampUsec) / 1000 || Date.now(),
    kind: kind === 'chat' ? 'chat' : 'notice',
    system,
    event:
      kind === 'superchat'
        ? { type: 'superchat', amount: simple(r.purchaseAmountText), color: argbToCss(r.bodyBackgroundColor ?? r.backgroundColor) }
        : kind === 'member'
          ? { type: 'member', text: system }
          : null,
    user: {
      id: r.authorExternalChannelId || '',
      login: simple(r.authorName),
      name: simple(r.authorName) || 'Someone',
      color: '',
      badges: authorBadges(r.authorBadges),
      photo: r.authorPhoto?.thumbnails?.at(-1)?.url || '',
    },
    parts,
    text: parts.map((p) => p.text || p.name || '').join(''),
  };
}

/** YouTube chat actions → chat events: message, deleteMessage, clearUser. */
export function parseChatActions(actions = []) {
  const events = [];
  for (const action of actions) {
    const add = action.addChatItemAction?.item;
    if (add) {
      const message = itemToMessage(add);
      if (message) events.push({ type: 'message', message });
      continue;
    }
    const deleted = action.markChatItemAsDeletedAction?.targetItemId;
    if (deleted) {
      events.push({ type: 'deleteMessage', id: deleted });
      continue;
    }
    const byAuthor = action.markChatItemsByAuthorAsDeletedAction?.externalChannelId;
    if (byAuthor) events.push({ type: 'clearUser', userId: byAuthor });
  }
  return events;
}

/** When the stream started (ms), from its watch page, or null. */
export function streamStartFromPage(html) {
  const time = /"startTimestamp":"([^"]+)"/.exec(html)?.[1];
  return time ? Date.parse(time) : null;
}

/** The channel streaming, from its watch page: { name, avatar } (either may be ''). */
export function channelFromPage(html) {
  const avatar = /"videoOwnerRenderer":\{"thumbnail":\{"thumbnails":\[\{"url":"([^"]+)"/.exec(html)?.[1] || '';
  const name = /"ownerChannelName":("(?:[^"\\]|\\.)*")/.exec(html)?.[1];
  return {
    name: name ? JSON.parse(name) : '',
    // 48 px by default; 88 is sharp on high-resolution screens.
    avatar: avatar.replace(/=s\d+-/, '=s88-'),
    // Its @handle (as sources write it: lower case), for a chat opened from a video ('' if the page doesn't say).
    handle: /"ownerProfileUrl":"https?:\/\/www\.youtube\.com\/(@[^"/]+)"/.exec(html)?.[1].toLowerCase() || '',
  };
}

/** "Watching now" from an updated_metadata response, or null. */
export function parseViewers(json) {
  const count = json?.actions?.find((a) => a.updateViewershipAction)?.updateViewershipAction.viewCount
    ?.videoViewCountRenderer?.originalViewCount;
  return count == null ? null : Number(count);
}

/* ---- The poller ---- */

/** Fetch a YouTube page; anonymous first, with your YouTube cookies if a consent page is in the way. */
/** The video a channel (a source with a handle or channel id) is live in now, or null; with the page. */
async function liveVideo(source) {
  const html = await getPage(`${YT}${source.handle ? `/${source.handle}` : `/channel/${source.channelId}`}/live`);
  return { videoId: liveVideoIdFromChannelPage(html), html };
}

/** Whether a channel (a source with a handle or channel id) is live now. */
export async function youtubeLive(source) {
  return Boolean((await liveVideo(source)).videoId);
}

async function getPage(url) {
  for (const credentials of ['omit', 'include']) {
    const res = await fetch(url, { credentials });
    const html = await res.text();
    if (credentials === 'include' || !/consent\.(youtube|google)\.com/.test(res.url)) return html;
  }
}

/**
 * Events (EventTarget): "event" (detail: message / deleteMessage / clearUser),
 * "status" (detail: { state: 'connecting' | 'live' | 'reconnecting' | 'recovered' | 'error', text?, videoId?, channel?: { name, avatar, handle } }).
 */
export class YouTubeChat extends EventTarget {
  constructor(source) {
    super();
    this.source = source;
    this.stopped = false;
    this.timer = null;
    this.failures = 0; // polls in a row that didn't get through
    this.wait = 1000; // the last wait between polls
  }

  status(detail) {
    this.dispatchEvent(new CustomEvent('status', { detail }));
  }

  emit(events) {
    for (const event of events) this.dispatchEvent(new CustomEvent('event', { detail: event }));
  }

  async start() {
    this.status({ state: 'connecting' });
    try {
      let videoId = this.source.videoId;
      let watch; // the watch page (channel, start time): for a stream, loaded beside its chat, which doesn't wait for it
      if (videoId) {
        watch = getPage(`${YT}/watch?v=${videoId}`);
        watch.catch(() => {});
      } else {
        // The channel's /live page is its live stream's watch page.
        const live = await liveVideo(this.source);
        if (this.stopped) return;
        videoId = live.videoId;
        if (!videoId) throw new Error("This channel isn't live right now.");
        watch = Promise.resolve(live.html);
      }
      this.videoId = videoId;
      const page = parseLiveChatPage(await getPage(`${YT}/live_chat?is_popout=1&v=${videoId}`));
      if (this.stopped) return;
      if (!page?.continuation) throw new Error("This stream has no live chat (it may have ended, or chat is off).");
      this.page = page;
      this.emit(parseChatActions(page.actions.map((a) => a.replayChatItemAction?.actions?.[0] || a)));
      this.poll(page.continuation);
      const html = await watch.catch(() => ''); // without it, no name, picture or uptime; the chat still works
      if (this.stopped) return;
      this.startedAt = streamStartFromPage(html);
      this.channel = channelFromPage(html);
      this.status({ state: 'live', videoId, channel: this.channel });
    } catch (error) {
      if (!this.stopped) this.status({ state: 'error', text: error.message });
    }
  }

  async poll(continuation) {
    if (this.stopped) return;
    let next = continuation;
    let wait = 5000;
    try {
      const res = await this.api('live_chat/get_live_chat', { continuation });
      if (!res.ok) throw new Error(`YouTube answered ${res.status}`);
      const chat = (await res.json())?.continuationContents?.liveChatContinuation;
      if (this.stopped) return; // removed while this was on its way
      if (!chat) throw new Error('The live chat has ended.');
      this.emit(parseChatActions(chat.actions));
      const c = continuationOf(chat.continuations?.[0]);
      if (!c?.continuation) throw new Error('The live chat has ended.');
      next = c.continuation;
      wait = this.wait = nextPoll(chat.continuations[0], chat.actions, this.wait);
      if (this.failures >= 3) this.status({ state: 'recovered' });
      this.failures = 0;
    } catch (error) {
      if (/ended/.test(error.message)) return this.status({ state: 'error', text: error.message });
      // A network blip or a refusal: try the same continuation again, and say so if it keeps failing.
      if (++this.failures === 3) this.status({ state: 'reconnecting' });
      wait = 10000;
    }
    if (!this.stopped) this.timer = setTimeout(() => this.poll(next), wait);
  }

  /** POST to YouTube's web API, as its own chat page does. */
  api(endpoint, body) {
    return fetch(`${YT}/youtubei/v1/${endpoint}?prettyPrint=false${this.page.apiKey ? `&key=${this.page.apiKey}` : ''}`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: this.page.clientVersion, hl: 'en' } },
        ...body,
      }),
    });
  }

  /** { startedAt, viewers } for the stream once the chat is live (either can be null). */
  async liveInfo() {
    const res = await this.api('updated_metadata', { videoId: this.videoId });
    if (!res.ok) throw new Error(`YouTube answered ${res.status}`);
    return { startedAt: this.startedAt, viewers: parseViewers(await res.json()) };
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
