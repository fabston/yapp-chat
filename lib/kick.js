/*
 * Kick chat: the channel and its earlier messages from Kick's web API (what
 * kick.com itself uses; it answers the extension with its kick.com access,
 * not other programs), live messages over Kick's Pusher socket, and, signed
 * in with Yapp Chat's Kick app, sending and moderating through Kick's public
 * API. The parsers are pure and unit-tested against real responses.
 */

import { KICK_CLIENT_ID, KICK_TOKEN_SERVICE } from './apps.js';
import { loadKickAuth, saveKickAuth, signInRedirectUrl } from './settings.js';
import { renewTokens, requestTokens, tokenFields } from './tokens.js';

const KICK = 'https://kick.com';
const API = 'https://api.kick.com/public/v1';
const PUSHER = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';

// user:read: who you are; chat:write: sending; moderation:*: delete, timeout and ban where you're a moderator.
const SCOPES = 'user:read chat:write moderation:ban moderation:chat_message:manage';

export const kickEmoteUrl = (id) => `https://files.kick.com/emotes/${id}/fullsize`;

/* ---- Responses → data (pure) ---- */

/** Kick's times: ISO, or "2026-10-06 21:09:19" (UTC, without saying so). Ms, or 0. */
export function kickTime(value) {
  if (!value) return 0;
  return Date.parse(/T/.test(value) ? value : `${value.replace(' ', 'T')}Z`) || 0;
}

/**
 * Chat modes, from the channel's chatroom or a ChatroomUpdatedEvent, in
 * lib/twitch.js roomModes' shape: { emoteOnly, subsOnly, slow (seconds),
 * followersOnly (-1 off, else minutes) }.
 */
export function kickModes(room) {
  if (!room) return {};
  const on = (v) => (typeof v === 'object' && v ? Boolean(v.enabled) : Boolean(v));
  const slow = typeof room.slow_mode === 'object' ? room.slow_mode : { enabled: room.slow_mode, message_interval: room.message_interval };
  const followers = typeof room.followers_mode === 'object' ? room.followers_mode : { enabled: room.followers_mode, min_duration: room.following_min_duration };
  return {
    emoteOnly: on(room.emotes_mode),
    subsOnly: on(room.subscribers_mode),
    slow: slow?.enabled ? Number(slow.message_interval) || 0 : 0,
    followersOnly: followers?.enabled ? Number(followers.min_duration) || 0 : -1,
  };
}

/** Live now: { startedAt, viewers }, or null if not (a channel's `livestream`, or /livestream's `data`). */
export function parseKickLive(stream) {
  if (!stream || stream.is_live === false) return null;
  return { startedAt: kickTime(stream.start_time || stream.created_at), viewers: Number(stream.viewer_count ?? stream.viewers) || 0 };
}

/**
 * /api/v2/channels/{slug}: { channelId, userId, chatroomId, slug, name,
 * avatar, banner, bio, followers, verified, subBadges [{ months, url }]
 * (fewest months first), live, modes }, or null if there's no such channel.
 */
export function parseKickChannel(json) {
  if (!json?.id || !json.chatroom?.id) return null;
  return {
    channelId: String(json.id),
    userId: String(json.user_id),
    chatroomId: String(json.chatroom.id),
    slug: json.slug,
    name: json.user?.username || json.slug,
    avatar: json.user?.profile_pic || '',
    banner: json.banner_image?.url || '',
    bio: (json.user?.bio || '').trim(),
    followers: Number(json.followers_count) || 0,
    verified: Boolean(json.verified),
    subBadges: (json.subscriber_badges || [])
      .map((b) => ({ months: Number(b.months) || 0, url: b.badge_image?.src || '' }))
      .filter((b) => b.url)
      .sort((a, b) => a.months - b.months),
    live: parseKickLive(json.livestream),
    modes: kickModes(json.chatroom),
    youtube: youtubeFromKick(json.user?.youtube),
  };
}

/**
 * The YouTube channel on a Kick profile as a source, or null: Kick keeps what the streamer typed, a name
 * ("theburntpeanut", their @handle), "channel/UC…" or a whole link. Pure; unit-tested.
 */
export function youtubeFromKick(value) {
  const path = String(value || '').trim().replace(/^(https?:\/\/)?((www|m)\.)?youtube\.com\//i, '').replace(/\/+$/, '');
  const channelId = /^channel\/(UC[\w-]{22})$/.exec(path)?.[1];
  if (channelId) return { platform: 'youtube', channelId };
  const handle = /^@?([\w.-]{3,30})$/.exec(path)?.[1];
  return handle ? { platform: 'youtube', handle: `@${handle.toLowerCase()}` } : null;
}

/**
 * Message text with Kick's emotes ("[emote:37226:KEKW]") turned into their
 * names, and where they are, in lib/twitch.js' native emote form
 * ({ id, start, end }, in code points), so format.js twitchParts draws them.
 */
export function kickContent(content = '') {
  const nativeEmotes = [];
  let text = '';
  let length = 0; // in code points
  let pos = 0;
  for (const m of content.matchAll(/\[emote:(\d+):([^\]\s]+)\]/g)) {
    const before = content.slice(pos, m.index);
    text += before;
    length += [...before].length;
    const name = [...m[2]];
    nativeEmotes.push({ id: m[1], start: length, end: length + name.length - 1 });
    text += m[2];
    length += name.length;
    pos = m.index + m[0].length;
  }
  return { text: text + content.slice(pos), nativeEmotes };
}

/** Kick's role badges, as badge pills (lib/chat.js BADGE_PILLS) or a picture. */
const ROLE_TITLES = {
  broadcaster: 'Broadcaster',
  moderator: 'Moderator',
  vip: 'VIP',
  og: 'OG',
  founder: 'Founder',
  verified: 'Verified',
  staff: 'Kick staff',
  sub_gifter: 'Sub gifter',
  sidekick: 'Sidekick',
};

/** The channel's sub badge for so many months: the one for the most months up to it. */
export function subBadgeFor(subBadges, months) {
  return subBadges.findLast((b) => b.months <= months) || subBadges[0] || null;
}

/**
 * A sender's badges: their roles here (sub with the channel's own picture
 * for their months), then the global badge they chose to show (level,
 * events). Also their sub months. { badges: [{ set, version, url?, title }], months }
 */
export function kickBadges(identity, subBadges = []) {
  const badges = [];
  let months = 0;
  for (const b of identity?.badges || []) {
    if (b.type === 'subscriber') {
      months = Number(b.count) || 0;
      const picture = subBadgeFor(subBadges, months);
      badges.push({ set: 'subscriber', version: String(months), url: picture?.url, title: `${months}-month subscriber` });
    } else if (ROLE_TITLES[b.type]) {
      badges.push({ set: b.type, version: String(b.count || 1), title: b.count ? `${ROLE_TITLES[b.type]} (${b.count})` : ROLE_TITLES[b.type] });
    }
  }
  for (const b of identity?.badges_v2 || []) {
    if (!b.selected || !b.image_url) continue;
    const title = b.name === 'level' ? `Level ${b.metadata?.level ?? ''}`.trim() : b.name.replace(/_/g, ' ');
    badges.push({ set: `kick-${b.name}`, version: '1', url: b.image_url, title });
  }
  return { badges, months };
}

/** A user as the chat shows them, from a Kick sender. */
function kickUser(sender, subBadges) {
  const { badges, months } = kickBadges(sender?.identity, subBadges);
  return {
    id: String(sender?.id ?? ''),
    login: sender?.slug || (sender?.username || '').toLowerCase(),
    name: sender?.username || sender?.slug || '',
    color: sender?.identity?.color || '',
    badges,
    months,
  };
}

/** A chat message (live over the socket, or from /messages, whose metadata is a JSON string). */
function parseKickMessage(raw, channel, subBadges = []) {
  let meta = raw.metadata || {};
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      meta = {};
    }
  }
  const { text, nativeEmotes } = kickContent(raw.content || '');
  const reply = raw.type === 'reply' ? meta : null;
  return {
    id: raw.id,
    platform: 'kick',
    channel,
    time: kickTime(raw.created_at) || Date.now(),
    kind: 'chat',
    action: false,
    system: '',
    event: null,
    first: false,
    replyTo: reply?.original_sender?.username || '',
    replyLogin: reply?.original_sender?.slug || (reply?.original_sender?.username || '').toLowerCase(),
    replyBody: reply ? kickContent(reply.original_message?.content || '').text : '',
    replyId: reply?.original_message?.id || '',
    replyRoot: '', // Kick doesn't say: a conversation is followed reply by reply
    user: kickUser(raw.sender, subBadges),
    text,
    nativeEmotes,
  };
}

/**
 * A sub, gift, host or KICKs gift: a notice line in lib/twitch.js' message
 * shape. Kick sends only a name for most of these: no user id, so no mod tools
 * on them (they need one).
 */
function kickNotice(channel, id, login, event, extra = {}) {
  const name = login || '';
  return {
    id,
    platform: 'kick',
    channel,
    time: Date.now(),
    kind: 'notice',
    action: false,
    system: '',
    event,
    first: false,
    replyTo: '',
    replyBody: '',
    replyId: '',
    user: { id: extra.userId ? String(extra.userId) : '', login: name.toLowerCase(), name, color: extra.color || '', badges: [], months: 0 },
    text: extra.text || '',
    nativeEmotes: [],
    ...(extra.text ? kickContent(extra.text) : {}),
  };
}

/**
 * A Pusher event → chat events, in lib/twitch.js twitchEvent's shapes:
 * message, deleteMessage, clearUser (timeout/ban, duration in seconds),
 * clearAll, room (modes), live (went live or offline: look again). [] for others.
 */
export function kickEvent(name, data, channel, subBadges = []) {
  const event = name.replace(/^App\\Events\\/, '');
  const id = (suffix) => `kick-${suffix}-${data?.id || data?.chatroom_id || ''}-${Date.now()}`;
  switch (event) {
    case 'ChatMessageEvent': {
      const message = parseKickMessage(data, channel, subBadges);
      // A sub anniversary shared in chat: a resub notice with their message.
      const celebration = data.metadata?.celebration;
      if (data.type === 'celebration' && celebration) {
        message.kind = 'notice';
        message.event = { type: 'resub', plan: '', months: Number(celebration.total_months) || 0, streak: 0 };
      }
      return [{ type: 'message', channel, message }];
    }
    case 'MessageDeletedEvent':
      return [{ type: 'deleteMessage', channel, id: data.message?.id || data.id }];
    case 'UserBannedEvent':
      return [
        {
          type: 'clearUser',
          channel,
          userId: String(data.user?.id ?? ''),
          login: data.user?.slug || (data.user?.username || '').toLowerCase(),
          duration: data.permanent ? 0 : (Number(data.duration) || 0) * 60, // Kick says minutes
          time: Date.now(),
          by: data.banned_by?.username || '',
        },
      ];
    case 'UserUnbannedEvent':
      return [{ type: 'unban', channel, userId: String(data.user?.id ?? ''), name: data.user?.username || '', by: data.unbanned_by?.username || '' }];
    case 'ChatroomClearEvent':
      return [{ type: 'clearAll', channel }];
    case 'ChatroomUpdatedEvent':
      return [{ type: 'room', channel, modes: kickModes(data) }];
    case 'SubscriptionEvent': {
      const months = Number(data.months) || 1;
      return [{ type: 'message', channel, message: kickNotice(channel, id('sub'), data.username, months > 1 ? { type: 'resub', plan: '', months, streak: 0 } : { type: 'sub', plan: '' }) }];
    }
    case 'GiftedSubscriptionsEvent': {
      const to = data.gifted_usernames || [];
      const event = to.length === 1 ? { type: 'gift', plan: '', recipient: to[0], recipientLogin: to[0].toLowerCase(), recipientId: '', inBatch: false } : { type: 'gifts', plan: '', count: to.length, total: Number(data.gifter_total) || 0 };
      return [{ type: 'message', channel, message: kickNotice(channel, id('gift'), data.gifter_username || 'Anonymous', event) }];
    }
    case 'StreamHostEvent':
      return [{ type: 'message', channel, message: kickNotice(channel, id('host'), data.host_username, { type: 'raid', raider: data.host_username, viewers: Number(data.number_viewers) || 0 }, { text: data.optional_message || '' }) }];
    case 'KicksGifted': {
      const sender = data.sender || {};
      const event = { type: 'kicks', amount: Number(data.gift?.amount) || 0, gift: data.gift?.name || '' };
      return [{ type: 'message', channel, message: kickNotice(channel, id('kicks'), sender.username, event, { userId: sender.id, color: sender.username_color, text: data.message || '' }) }];
    }
    case 'StreamerIsLive':
    case 'StopStreamBroadcast':
      return [{ type: 'live', channel }];
    default:
      return [];
  }
}

/** /api/v2/channels/{channel id}/messages: the latest messages, oldest first. */
export function parseKickHistory(json, channel, subBadges = []) {
  return (json?.data?.messages || [])
    .filter((raw) => raw?.id && raw.sender)
    .map((raw) => parseKickMessage(raw, channel, subBadges))
    .sort((a, b) => a.time - b.time);
}

/** /emotes/{slug}: [channel's, global, emoji] groups → Map name → { url, owner (the channel's: `channel`), kickId }. */
export function parseKickEmotes(json, slug) {
  const map = new Map();
  for (const group of Array.isArray(json) ? json : []) {
    const owner = group.slug === slug ? 'channel' : 'kick';
    for (const e of group.emotes || []) if (e?.id && e.name) map.set(e.name, { url: kickEmoteUrl(e.id), owner, kickId: String(e.id) });
  }
  return map;
}

/**
 * /api/v2/channels/{channel slug}/users/{username}: what the card shows about
 * someone in this channel. { photo, followingSince, subMonths, badges, isMod, banned }
 */
export function parseKickCardUser(json, subBadges = []) {
  if (!json?.id) return null;
  const { badges } = kickBadges({ badges: json.badges, badges_v2: json.badges_v2 }, subBadges);
  return {
    photo: json.profile_pic || '',
    followingSince: kickTime(json.following_since),
    subMonths: Number(json.subscribed_for) || 0,
    badges,
    isMod: Boolean(json.is_moderator || json.is_channel_owner),
    banned: Boolean(json.banned),
  };
}

/**
 * /api/search: channels as channel-suggest.js rows. Their `login` is what
 * goes in the box ("kick:xqc"). Kick's search says who's live, not how many watch.
 */
export function parseKickSearch(json) {
  return (json?.channels || [])
    .filter((c) => c?.slug)
    .map((c) => ({
      platform: 'kick',
      login: `kick:${c.slug}`,
      name: c.user?.username || c.slug,
      avatar: c.user?.profilePic || c.user?.profile_pic || '',
      viewers: null,
      live: Boolean(c.isLive),
      followers: Number(c.followers_count ?? c.followersCount) || 0,
    }))
    .sort((a, b) => b.live - a.live || b.followers - a.followers);
}

/* ---- Clips and videos (link previews) ---- */

/** { title, thumbnail, channel, views, seconds, by } for a Kick clip (api/v2/clips/{id}), or null. Pure; unit-tested. */
export function parseKickClip(json) {
  const c = json?.clip;
  if (!c) return null;
  return { title: c.title || '', thumbnail: c.thumbnail_url || '', channel: c.channel?.username || '', views: c.views ?? c.view_count ?? 0, seconds: c.duration || 0, by: c.creator?.username || '' };
}

/**
 * { title, thumbnail, channel, views, ms, category } for a Kick video, a past stream (api/v1/video/{uuid}), or null
 * (also a private or deleted one). Its picture is a link that works for 5 minutes. Pure; unit-tested.
 */
export function parseKickVideo(json) {
  const s = json?.livestream;
  if (!s || json.is_private || json.deleted_at) return null;
  return {
    title: s.session_title || '',
    thumbnail: typeof s.thumbnail === 'string' ? s.thumbnail : s.thumbnail?.src || '',
    channel: s.channel?.user?.username || s.channel?.slug || '',
    views: json.views || 0,
    ms: s.duration || 0,
    category: s.categories?.[0]?.name || '',
  };
}

/**
 * A channel's page (kick.com/name), in Twitch's shape (parseTwitchChannel): { name, avatar, title, game, viewers
 * (null offline), thumbnail, followers }, or null. The stream's picture comes from /livestream's data
 * (`livestream`): the channel's own link to it is refused (403). Pure; unit-tested.
 */
export function parseKickChannelPreview(json, livestream = null) {
  const channel = parseKickChannel(json);
  if (!channel) return null;
  const stream = channel.live && json.livestream;
  return {
    name: channel.name,
    avatar: channel.avatar,
    title: stream?.session_title || '',
    game: stream?.categories?.[0]?.name || '',
    viewers: channel.live ? channel.live.viewers : null,
    thumbnail: (stream && livestream?.thumbnail?.src) || '',
    followers: channel.followers,
  };
}

/* ---- Kick's web API ---- */

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Kick answered ${res.status}`);
  return res.json();
}

/** Kick's channel search (3 letters or more). */
export async function kickSearchChannels(query) {
  if (query.length < 3) return [];
  return parseKickSearch(await getJson(`${KICK}/api/search?searched_word=${encodeURIComponent(query)}`));
}

export async function kickChannel(slug) {
  return parseKickChannel(await getJson(`${KICK}/api/v2/channels/${slug}`));
}

export async function kickLiveInfo(slug) {
  return parseKickLive((await getJson(`${KICK}/api/v2/channels/${slug}/livestream`))?.data);
}

async function kickHistory(channelId, slug, subBadges) {
  return parseKickHistory(await getJson(`${KICK}/api/v2/channels/${channelId}/messages`), slug, subBadges);
}

export async function kickEmotes(slug) {
  return parseKickEmotes(await getJson(`${KICK}/emotes/${slug}`).catch(() => null), slug);
}

export async function kickClip(id) {
  return parseKickClip(await getJson(`${KICK}/api/v2/clips/${id}`));
}

export async function kickVideo(uuid) {
  return parseKickVideo(await getJson(`${KICK}/api/v1/video/${uuid}`));
}

export async function kickChannelPreview(slug) {
  const json = await getJson(`${KICK}/api/v2/channels/${slug}`);
  const livestream = json?.livestream ? (await getJson(`${KICK}/api/v2/channels/${slug}/livestream`).catch(() => null))?.data : null;
  return parseKickChannelPreview(json, livestream);
}

/** Someone in a channel: by their username, not their slug (Kick's slugs have "-" where names have "_"). */
export async function kickCardUser(channel, username, subBadges) {
  return parseKickCardUser(await getJson(`${KICK}/api/v2/channels/${channel}/users/${encodeURIComponent(username)}`), subBadges);
}

/* ---- Live chat: Pusher over WebSocket ---- */

/** Without the socket: how often to fetch the latest messages, and how many fetches between tries of the socket. */
const POLL_EVERY = 3000;
const SOCKET_AGAIN = 100; // about 5 minutes

/**
 * One Kick channel's chat. Events: "status" ({ state: connecting | ready |
 * missing | reconnecting | recovered | polling, channel?, text? }) and
 * "event" (the shapes kickEvent returns). Reconnects by itself after a drop.
 * If Kick's socket refuses the connection for good (Pusher's 4000–4099:
 * Kick changed its app key or cluster) or never connects, it fetches the
 * latest messages every few seconds instead (no deletions, bans or subs
 * then), and tries the socket again now and then.
 */
export class KickChat extends EventTarget {
  constructor(source) {
    super();
    this.slug = source.channel;
    this.channel = null; // parseKickChannel, once loaded
    this.stopped = false;
    this.retry = 0;
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
      this.channel = await kickChannel(this.slug);
    } catch {
      return this.later(() => this.start());
    }
    if (this.stopped) return;
    this.retry = 0; // tries to load the channel aren't a dropped connection
    if (!this.channel) return this.status({ state: 'missing', text: `There's no Kick channel called ${this.slug}.` });
    this.status({ state: 'ready', channel: this.channel });
    this.connect();
  }

  /** Try again after a while, longer each time (up to a minute). */
  later(task) {
    if (this.stopped) return;
    this.status({ state: 'reconnecting' });
    const wait = Math.min(60_000, 2000 * 2 ** this.retry++);
    this.timer = setTimeout(task, wait);
  }

  connect() {
    if (this.stopped) return;
    const { chatroomId, channelId } = this.channel;
    const ws = new WebSocket(PUSHER);
    this.ws = ws;
    let quiet = null;
    let established = false;
    // Pusher sends something at least every 2 minutes (pings); nothing for longer means a dead socket.
    const listen = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => ws.close(), 150_000);
    };
    ws.addEventListener('message', (e) => {
      listen();
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.event === 'pusher:connection_established') {
        established = true;
        this.failures = 0;
        for (const channel of [`chatrooms.${chatroomId}.v2`, `chatroom_${chatroomId}`, `channel.${channelId}`, `channel_${channelId}`]) {
          ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel } }));
        }
        if (this.retry || this.polling) this.status({ state: 'recovered' });
        this.retry = 0;
        this.polling = false; // live again
        return;
      }
      if (m.event === 'pusher:ping') return ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      if (!m.data || m.event.startsWith('pusher')) return;
      let data;
      try {
        data = typeof m.data === 'string' ? JSON.parse(m.data) : m.data;
      } catch {
        return;
      }
      this.emit(kickEvent(m.event, data, this.slug, this.channel.subBadges));
    });
    ws.addEventListener('close', (e) => {
      clearTimeout(quiet);
      if (this.ws !== ws || this.polling) return; // stopped, or polling tries the socket itself
      if (!established) this.failures = (this.failures || 0) + 1;
      // Pusher's 4000–4099: not again unchanged. Three tries that never connected: likewise.
      if ((e.code >= 4000 && e.code < 4100) || this.failures >= 3) return this.poll();
      this.later(() => this.connect());
    });
    listen();
  }

  /** The latest messages every few seconds (the chat page's own list), and the socket again every few minutes. */
  poll() {
    if (this.stopped) return;
    this.polling = true;
    this.failures = 0;
    this.status({ state: 'polling' });
    let fetches = 0;
    const tick = async () => {
      if (this.stopped || !this.polling) return;
      const messages = await this.history().catch(() => []);
      if (this.stopped || !this.polling) return;
      this.emit(messages.map((message) => ({ type: 'message', channel: this.slug, message }))); // the pane skips ones it has
      if (++fetches % SOCKET_AGAIN === 0) this.connect();
      this.timer = setTimeout(tick, POLL_EVERY);
    };
    tick();
  }

  /** The latest messages (when the chat opens, and after a drop). */
  history() {
    return this.channel ? kickHistory(this.channel.channelId, this.slug, this.channel.subBadges) : Promise.resolve([]);
  }

  liveInfo() {
    return kickLiveInfo(this.slug);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}

/* ---- Your Kick account: sign-in (OAuth with PKCE) and the public API ---- */

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Sign in with Yapp Chat's Kick app (lib/apps.js; its redirect URL is this extension's). `onApproved`: Kick's
 * window has closed with your answer, and the rest (the token, who you are: a moment) begins.
 */
export async function kickSignIn(onApproved) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = crypto.randomUUID();
  const redirect = signInRedirectUrl();
  const url = new URL('https://id.kick.com/oauth/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: KICK_CLIENT_ID,
    redirect_uri: redirect,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  const result = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  onApproved?.();
  const back = new URL(result).searchParams;
  if (back.get('state') !== state) throw new Error('Sign-in was interrupted. Try again.');
  if (!back.get('code')) throw new Error(back.get('error_description') || "Kick didn't accept the sign-in.");
  const token = await requestTokens(KICK_TOKEN_SERVICE, { grant_type: 'authorization_code', code: back.get('code'), redirect_uri: redirect, code_verifier: verifier }, 'Kick');
  const auth = { ...tokenFields(token), scopes: (token.scope || SCOPES).split(' ') };
  const me = (await kickApi(auth, 'GET', 'users'))?.data?.[0];
  if (!me) throw new Error("Kick didn't say who you are.");
  return { ...auth, userId: String(me.user_id), login: (me.name || '').toLowerCase(), name: me.name || '', picture: me.profile_picture || '' };
}

/** Your Kick profile picture, for a sign-in from before it was kept (Settings shows it). */
export async function kickPicture(auth) {
  return (await kickApi(auth, 'GET', 'users'))?.data?.[0]?.profile_picture || '';
}

export async function kickSignOut(auth) {
  const revoke = (token, type) =>
    token && fetch(`https://id.kick.com/oauth/revoke?${new URLSearchParams({ token, token_hint_type: type })}`, { method: 'POST' }).catch(() => {});
  await Promise.all([revoke(auth.token, 'access_token'), revoke(auth.refreshToken, 'refresh_token')]);
}

/** The sign-in with a fresh token when this one is (nearly) out (lib/tokens.js renewTokens). */
const freshAuth = (auth) => renewTokens(auth, { url: KICK_TOKEN_SERVICE, platform: 'Kick', load: loadKickAuth, save: saveKickAuth });

/** Kick's public API as you. Mutates `auth` when the token is refreshed. */
async function kickApi(auth, method, path, body) {
  await freshAuth(auth);
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = res.status === 401 ? 'Sign in to Kick again in Settings.' : json?.message || `Kick answered ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return json;
}

/** Send to a channel (its broadcaster's user id), as a reply to `replyId` if given. */
export function kickSend(auth, broadcasterId, content, replyId) {
  const body = { broadcaster_user_id: Number(broadcasterId), content, type: 'user', ...(replyId && { reply_to_message_id: replyId }) };
  return kickApi(auth, 'POST', 'chat', body);
}

/** Time someone out for `minutes` (1 to 7 days' worth), or ban them (no minutes). */
export function kickBan(auth, broadcasterId, userId, minutes = 0, reason = '') {
  const body = { broadcaster_user_id: Number(broadcasterId), user_id: Number(userId), ...(minutes && { duration: minutes }), ...(reason && { reason }) };
  return kickApi(auth, 'POST', 'moderation/bans', body);
}

/** Lift a timeout or a ban. */
export function kickUnban(auth, broadcasterId, userId) {
  return kickApi(auth, 'DELETE', 'moderation/bans', { broadcaster_user_id: Number(broadcasterId), user_id: Number(userId) });
}

export function kickDeleteMessage(auth, messageId) {
  return kickApi(auth, 'DELETE', `chat/${messageId}`);
}
