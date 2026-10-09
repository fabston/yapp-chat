/*
 * The chat view, used by the side panel and the chat windows. A page creates
 * one ChatContext (settings, your Twitch account, the shared Twitch
 * connection, emotes) and opens panes with it. A pane shows one chat: one or
 * more feeds (a Twitch or Kick channel or a YouTube stream each) merged into one list.
 */

import { channelSuggest } from './channel-suggest.js';
import { channelEmotes, globalEmotes, kickChannelEmotes } from './emotes.js';
import { cheerParts, foldKey, foldWords, formatAgo, formatClock, formatCount, formatDuration, formatFullTime, setNameTheme, formatUptime, nearlySame, readableColor, similarWords, textMatcher, twitchParts, visibleLength } from './format.js';
import { icon } from './icons.js';
import { parseIrc } from './irc.js';
import { linkPreview } from './links.js';
import { addMention } from './mentions.js';
import { CHAT_FONTS, EMOTE_SIZES, hiddenBy, loadKickAuth, loadSettings, loadTwitchAuth, saveSettings, saveTwitchAuth } from './settings.js';
import { KickChat, kickBan, kickCardUser, kickDeleteMessage, kickEmoteUrl, kickEmotes, kickSend } from './kick.js';
import { Cosmetics } from './cosmetics.js';
import { chatFromInput, chatKey, MAX_MERGED, sourceKey, sourceLabel, uniqueSources, PLATFORM_NAMES } from './sources.js';
import {
  cheerColor,
  cheermoteUrl,
  TwitchClient,
  twitchBadges,
  twitchBan,
  twitchCheermotes,
  twitchDeleteMessage,
  twitchEmoteUrl,
  twitchEvent,
  twitchLiveInfo,
  twitchRecentMessages,
  twitchProfile,
  twitchUsableEmotes,
  freshTwitchAuth,
  validateToken,
} from './twitch.js';
import { refused } from './tokens.js';
import { popOutChat } from './window.js';
import { YouTubeChat } from './youtube.js';
import { openUserCard } from './card.js';
import { NOTICE_STYLE, isModeration, kicks } from './notices.js';
import { el, iconButton, mentionName, platformBadge, platformTile } from './ui.js';

/** Open panes on this page (for "New since you left" and keyboard shortcuts). */
const panes = new Set();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) panes.forEach((pane) => pane.markAway());
});

/** The pane the pointer or the focus was last in (keyboard shortcuts act on it). */
let activePane = null;

/**
 * Shortcuts: Ctrl/⌘+F filters the chat you're in; Ctrl/⌘+E opens its emote
 * picker; Esc (outside a text box, with nothing open to close) jumps every
 * chat back to the newest messages.
 * Alt+←/→ is the chat window's.
 */
document.addEventListener('keydown', (e) => {
  const visible = [...panes].filter((p) => !p.root.hidden);
  const pane = panes.has(activePane) && !activePane.root.hidden ? activePane : visible[0];
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f' && pane) {
    e.preventDefault();
    pane.openFilter();
  } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e' && pane?.picker) {
    e.preventDefault();
    pane.toggleEmotePicker();
  } else if (e.key === 'Escape' && !e.target.closest?.('input, textarea')) {
    // Esc closes what's open first (a card, a menu…; their own handlers); only then back to live.
    const open = document.querySelector('.usercard:not([hidden]), .context-menu:not([hidden]), .feeds-pop:not([hidden]), .emote-picker:not([hidden]), .mentions-pop:not([hidden])');
    if (!open) visible.forEach((p) => p.scrollToEnd());
  }
});

/** Lines kept per pane; older ones are dropped (up to twice as many while it's held or you read back). */
const MAX_LINES = 600;

/** After the pointer leaves a name, link or reply, the chat waits this long (ms) to follow again, so moving from one to the next doesn't let it jump. */
const HOLD_GRACE = 500;

/** Settings → Hold the chat anywhere under the pointer: it follows again this long (ms) after the pointer stops moving. */
const HOLD_MOVING = 1500;

/** Twitch's announcement colours. */
const ANNOUNCEMENT_COLORS = { blue: '#4f9dff', green: '#00c98d', orange: '#ff9f43', purple: '#a970ff' };

/** Badge pills when there's no image (Twitch badge images need a signed-in account). */
const BADGE_PILLS = {
  broadcaster: ['B', 'Broadcaster'],
  owner: ['B', 'Channel owner'],
  moderator: ['M', 'Moderator'],
  vip: ['V', 'VIP'],
  subscriber: ['S', 'Subscriber'],
  founder: ['F', 'Founder'],
  member: ['S', 'Member'],
  partner: ['✓', 'Verified'],
  verified: ['✓', 'Verified'],
  staff: ['T', 'Staff'],
  og: ['OG', 'OG'], // Kick's roles from here
  sub_gifter: ['G', 'Sub gifter'],
  sidekick: ['SK', 'Sidekick'],
};

/**
 * Events: "reload" (settings changed; panes re-check what to hide and who's
 * a friend; detail.restyled: theme changed, so they redraw their lines).
 */
export class ChatContext extends EventTarget {
  static async create() {
    const ctx = new ChatContext();
    ({ emoteUse: ctx.emoteUse = {} } = await chrome.storage.local.get('emoteUse'));
    await ctx.reload();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.kickAuth?.newValue) ctx.kickAuth = changes.kickAuth.newValue;
      // A Twitch token renewed on another page: into the same object, which the chat connection holds too.
      if (area === 'local' && changes.twitchAuth?.newValue?.token && ctx.auth.userId === changes.twitchAuth.newValue.userId) Object.assign(ctx.auth, changes.twitchAuth.newValue);
    });
    // Theme "System": follow the system when it switches.
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => ctx.settings.theme === 'system' && ctx.reload());
    return ctx;
  }

  /** You used an emote (sent it): it ranks higher in suggestions and shows under Recent. */
  noteEmoteUse(names) {
    if (!names.length) return;
    for (const name of names) this.emoteUse[name] = { n: (this.emoteUse[name]?.n || 0) + 1, at: Date.now() };
    // Keep the 300 most recently used.
    const kept = Object.entries(this.emoteUse).sort((a, b) => b[1].at - a[1].at).slice(0, 300);
    this.emoteUse = Object.fromEntries(kept);
    chrome.storage.local.set({ emoteUse: this.emoteUse });
  }

  /** (Re)read settings and the account; drops a Twitch sign-in that Twitch says is gone. */
  async reload() {
    this.settings = await loadSettings();
    // The same account into the same object: the chat connection holds it, and renewed tokens reach it through it.
    const auth = await loadTwitchAuth();
    this.auth = this.auth && this.auth.userId === auth.userId ? Object.assign(this.auth, auth) : auth;
    this.kickAuth = await loadKickAuth();
    // What the sign-in allows (undefined: Twitch couldn't be asked; null: it refused the token). One that renews
    // itself is renewed first, if it needs it.
    let renewal = null;
    await freshTwitchAuth(this.auth).catch((error) => (renewal = error));
    const info = this.auth.token ? await validateToken(this.auth.token).catch(() => undefined) : undefined;
    // Signed out only when the sign-in is gone: the token refused, and no renewal can mend it (none to try, it went
    // through, or Twitch refused it too). One that couldn't reach Twitch or yapp.chat waits for next time.
    if (info === null && (!this.auth.refreshToken || !renewal || refused(renewal))) {
      this.auth = {};
      await saveTwitchAuth(this.auth);
    }
    this.scopes = info?.scopes || [];
    const words = [...this.settings.highlightWords];
    // Your names: Twitch's and Kick's.
    if (this.settings.highlightName) words.push(...[this.auth.login, this.kickAuth.login].filter(Boolean));
    this.isHighlight = textMatcher(words) || (() => false);
    this.isHidden = hiddenBy(this.settings);
    this.friends = new Set(this.settings.friends);
    const root = document.documentElement;
    const { theme } = this.settings;
    const light = theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
    const restyled = this.light !== undefined && this.light !== light;
    this.light = light;
    root.dataset.theme = light ? 'light' : 'dark';
    setNameTheme(light);
    root.dataset.density = this.settings.density;
    root.style.setProperty('--chat-font', CHAT_FONTS[this.settings.chatFont][1]);
    root.style.setProperty('--chat-size', `${this.settings.fontSize}px`);
    root.style.setProperty('--emote-scale', EMOTE_SIZES[this.settings.emoteSize]);
    root.classList.toggle('alt-rows', this.settings.altRows);
    // 7TV paints and badges, BTTV and FFZ badges: one connection for the page.
    if (this.settings.cosmetics) this.cosmetics ??= new Cosmetics();
    this.emotesPromise = null;
    this.dispatchEvent(new CustomEvent('reload', { detail: { restyled } }));
  }

  get signedIn() {
    return Boolean(this.auth.token);
  }

  get kickSignedIn() {
    return Boolean(this.kickAuth.token);
  }

  /** Signed in where a feed is, so you can write there (YouTube chat is read-only). */
  canWrite(feed) {
    return feed.platform === 'twitch' ? this.signedIn : feed.platform === 'kick' ? this.kickSignedIn : false;
  }

  /** One of your own accounts: on Kick by user id (its names and slugs differ), on Twitch by login. */
  isOwn(user, platform) {
    if (platform === 'kick') return Boolean(this.kickAuth.userId) && user?.id === this.kickAuth.userId;
    return platform === 'twitch' && Boolean(user?.login) && user.login === this.auth.login;
  }

  /** The page's single Twitch connection, opened on first use. */
  twitch() {
    if (!this.twitchClient) {
      this.twitchClient = new TwitchClient(this.signedIn ? this.auth : null);
      this.twitchClient.connect();
    }
    return this.twitchClient;
  }

  /** A guest connection (not you), for reading channels you're banned from. */
  guestTwitch() {
    if (!this.signedIn) return this.twitch();
    if (!this.guestClient) {
      this.guestClient = new TwitchClient(null);
      this.guestClient.connect();
    }
    return this.guestClient;
  }

  globalEmotes() {
    this.emotesPromise ??= globalEmotes(this.settings.emotes);
    return this.emotesPromise;
  }

}

/* ---- Instant tooltip for emotes and badges (one, shared by every pane) ---- */

const EMOTE_SOURCES = {
  'static-cdn.jtvnw.net': 'Twitch',
  'cdn.betterttv.net': 'BetterTTV',
  'cdn.frankerfacez.com': 'FrankerFaceZ',
  'cdn.7tv.app': '7TV',
  'd3aqoihi2n8ty8.cloudfront.net': 'Twitch cheer',
  'files.kick.com': 'Kick',
};

function emoteSource(url) {
  const { host } = new URL(url);
  return EMOTE_SOURCES[host] || (host.endsWith('.ggpht.com') ? 'YouTube' : '');
}

/** What a tooltip can be shown for, inside a chat list. */
const TIP_TARGETS = '.emote-stack, .badge, .badge-pill, .msg-source, .reply-line, a.link, .msg .name, .msg .ts, .fold-count';

/** The chat holds still while the pointer is over these: tooltips, replies (to read them) and names (to click them). */
// A message with mod buttons on it holds too: a busy chat mustn't slide another message under a Timeout click.
// And a deleted one (struck through), to read what it said.
const HOLD_TARGETS = `${TIP_TARGETS}, .msg.reply, .msg-actions, .msg:has(> .msg-actions.mod), .msg.deleted`;

let hoverTip = null;

/** How loud "×N" is (chat.css): quiet from 2, brighter from 5, filled from 20, so big waves stand out. */
const foldLevel = (count) => (count >= 20 ? 'high' : count >= 5 ? 'mid' : 'low');

/** Who sent a folded message, and where (a merged chat folds the same message from Twitch, Kick and YouTube). */
const sender = (message) => ({ user: message.user, platform: message.platform });

/** A sender as counted once: the same name on another platform is someone else. */
const senderKey = ({ user, platform }) => `${platform} ${user?.login || user?.id || user?.name}`;

/** One version of a folded group: its text, who sent it, and the message shown for it. */
const versionOf = (message) => ({ text: message.text, senders: [sender(message)], message });

/** How noisy a wording is: what folding ignores in it (extra punctuation, stretched letters, words again). */
const noise = (text) => visibleLength(text) - [...foldKey(text)].length;

/**
 * Fold similar messages: a word in this many messages here within 30 s, and in at least this share of all of them,
 * is a wave's word ("key", said by 60 of 100; not a name a few talk about: "summit" in 8 of 50), and reactions with it
 * fold together: the word and at most one other (WAVE_SHORT words: "rip LOL", "craft the key"). Longer ones say
 * more ("kek is lol in orcish"), and laughing words hang off all sorts of messages.
 */
const WAVE_WORD = 8;
const WAVE_SHARE = 0.25;
const WAVE_SHORT = 2;

/** The system asks for less motion: no pop on a growing "×12". */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Where the pointer is across the window (tooltips over wide things follow it). */
let pointerX = 0;
document.addEventListener('pointermove', (e) => (pointerX = e.clientX), { passive: true });

/**
 * Show `nodes` in the tooltip, above `target` (below it near the top), inside
 * the window: centred on small targets (emotes, badges), at the pointer over
 * wide ones (a reply line or a long link across a wide window).
 */
function placeTip(target, kind, nodes) {
  hoverTip ??= document.body.appendChild(el('div', 'hover-tip'));
  hoverTip.dataset.kind = kind;
  hoverTip.replaceChildren(...nodes);
  hoverTip.hidden = false;
  const r = target.getBoundingClientRect();
  const t = hoverTip.getBoundingClientRect();
  const x = r.width > 160 ? Math.max(r.left, Math.min(pointerX, r.right)) : r.left + r.width / 2;
  hoverTip.style.left = `${Math.max(8, Math.min(x - t.width / 2, innerWidth - t.width - 8))}px`;
  // Above, unless it doesn't fit there and does below; if it fits neither, on the roomier side, kept in the window.
  const above = r.top - t.height - 6;
  const below = r.bottom + 6;
  const top = above >= 8 || (below + t.height > innerHeight - 8 && r.top > innerHeight - r.bottom) ? above : below;
  hoverTip.style.top = `${Math.max(8, Math.min(top, innerHeight - t.height - 8))}px`;
}

/**
 * Show `target` large with its name and where it's from: an emote (with any
 * zero-width ones drawn over it), a badge, or the channel a message came from.
 */
function showTip(target) {
  const isEmote = target.classList.contains('emote-stack');
  const items = isEmote
    ? [...target.querySelectorAll('img')].map((img) => ({
        node: img,
        name: img.alt,
        source: [emoteSource(img.src), img.classList.contains('zero-width') && 'zero-width'].filter(Boolean).join(' · '),
      }))
    : [{ node: target.querySelector('img') || target, name: target.dataset.tip, source: target.dataset.tipSource || 'Badge' }];
  placeTip(
    target,
    isEmote ? 'emote' : 'badge',
    items.map(({ node, name, source }) => {
      const item = el('div', 'tip-item');
      const preview = node.cloneNode(true);
      preview.className = node.classList.contains('badge-pill') ? 'badge-pill tip-preview' : 'tip-preview';
      if (node.classList.contains('source-avatar')) preview.classList.add('round');
      if (preview.alt) preview.alt = '';
      item.append(preview, el('strong', '', name));
      if (source) item.append(el('span', 'tip-source', source));
      return item;
    }),
  );
}

function hideTip() {
  if (hoverTip) hoverTip.hidden = true;
}

/* ---- Right-click menu on a message (one, shared by every pane) ---- */

let menu = null;

/**
 * `items`: [label, action, picture?, className?], or '-' for a divider.
 * `above`: open upwards from y (menus from the message box).
 */
function showMenu(x, y, items, { above = false } = {}) {
  menu ??= document.body.appendChild(el('div', 'context-menu'));
  menu.setAttribute('role', 'menu');
  menu.replaceChildren(
    ...items.map((entry) => {
      if (entry === '-') return el('hr', 'menu-sep');
      const [label, action, picture, className] = entry;
      const item = el('button', `menu-item ${className || ''}`.trim());
      if (picture) item.append(picture);
      item.append(label);
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.addEventListener('click', () => {
        hideMenu();
        action();
      });
      return item;
    }),
  );
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(above ? y - r.height - 4 : y, innerHeight - r.height - 4))}px`;
}

function hideMenu() {
  if (menu) menu.hidden = true;
}

document.addEventListener('pointerdown', (e) => {
  if (menu && !menu.contains(e.target)) hideMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideMenu();
});
window.addEventListener('blur', hideMenu);

/* ---- Feeds: one Twitch or Kick channel or YouTube stream each ---- */

/**
 * A stream feeding a pane, with its own connection, emotes, badges, live
 * status and channel picture. Messages go to the pane with the feed attached.
 */
class Feed {
  constructor(pane, source) {
    this.pane = pane;
    this.ctx = pane.ctx;
    this.source = source;
    this.key = sourceKey(source);
    this.platform = source.platform;
    this.label = sourceLabel(source);
    this.avatar = '';
    this.status = '';
    this.live = undefined; // { startedAt, viewers } | null (offline) | undefined (not known yet)
    this.banned = false;
    this.emotes = new Map(); // third-party (BTTV, FFZ, 7TV), channel and global
    this.twitchEmotes = new Map(); // Twitch emotes you can type here (signed in)
    this.badgeImages = new Map();
    this.channelEmotes = new Map(); // the channel's own BTTV / FFZ / 7TV (for the emote picker)
    this.cheermotes = new Map(); // Twitch: cheer prefixes (global and the channel's own)
    this.modes = {}; // Twitch: slow, sub-only, emote-only… (lib/twitch.js roomModes)
    this.chatters = new Map(); // login → user, most recent last (for @ suggestions)
    this.offenses = []; // timeouts and bans seen here (for user cards)
    this.cooldownUntil = 0; // slow mode: when you can send here again
  }

  start() {
    this.globalsReady = this.ctx.globalEmotes().then((map) => {
      for (const [name, emote] of map) if (!this.emotes.has(name)) this.emotes.set(name, emote);
    });
    if (this.platform === 'twitch') {
      const { channel } = this.source;
      this.cheersReady = twitchCheermotes(channel).then((map) => (this.cheermotes = map));
      this.loadHistory();
      this.connect(this.ctx.twitch());
      twitchBadges(this.ctx.auth).then((map) => this.badgeImages.size || (this.badgeImages = map)); // unless the channel's (with these) came first
      this.watchLive(() => twitchLiveInfo(channel));
      twitchProfile(channel)
        .then((p) => p?.photo && this.setAvatar(p.photo))
        .catch(() => {});
    } else if (this.platform === 'kick') {
      this.startKick();
    } else {
      this.startYouTube();
    }
  }

  connect(client) {
    const { channel } = this.source;
    this.client = client;
    this.setStatus(client.socket?.readyState === WebSocket.OPEN ? '' : 'Connecting…');
    this.onEvent = ({ detail: event }) => {
      if (event.channel === channel) this.handleEvent(event);
    };
    this.onStatus = ({ detail }) => {
      this.setStatus(detail.connected ? '' : 'Reconnecting…', detail.connected ? '' : 'warn');
      // Back after a drop: fill in what was said meanwhile (recent-messages service).
      if (!detail.connected) this.dropped = true;
      else if (this.dropped) {
        this.dropped = false;
        this.fillGap();
      }
      // One connection for all channels: say it once per pane.
      if (detail.authFailed && !this.pane.authWarned) {
        this.pane.authWarned = true;
        this.pane.system('Your Twitch sign-in expired. Reading anonymously; sign in again in Settings to chat.');
      }
    };
    client.addEventListener('event', this.onEvent);
    client.addEventListener('status', this.onStatus);
    client.join(channel);
  }

  disconnect() {
    if (!this.client) return;
    this.client.removeEventListener('event', this.onEvent);
    this.client.removeEventListener('status', this.onStatus);
    this.client.part(this.source.channel);
    this.client = null;
  }

  /** Twitch stops sending a chat to accounts banned from it: read it as a guest, and say so. */
  readAsGuest() {
    this.banned = true;
    this.disconnect();
    this.connect(this.ctx.guestTwitch());
    this.pane.renderHead();
    this.pane.renderInput();
  }

  startYouTube() {
    this.youtube = new YouTubeChat(this.source);
    this.youtube.addEventListener('event', ({ detail }) => this.handleEvent(detail));
    this.youtube.addEventListener('status', ({ detail }) => {
      if (detail.state === 'connecting') return this.setStatus('Connecting…');
      if (detail.state === 'reconnecting') return this.setStatus('Reconnecting…', 'warn');
      if (detail.state === 'recovered') return this.setStatus('');
      if (detail.state === 'live') {
        if (detail.channel?.name) this.label = detail.channel.name;
        this.setStatus('');
        if (detail.channel?.avatar) this.setAvatar(detail.channel.avatar);
        return this.watchLive(() => this.youtube.liveInfo());
      }
      this.setStatus('Offline', 'warn');
      this.pane.system(detail.text, this);
    });
    this.youtube.start();
  }

  /**
   * Kick: the channel first (its chat room, picture, badges, modes), then
   * the live socket, the earlier messages, its emotes, and whether you
   * moderate it.
   */
  startKick() {
    this.kick = new KickChat(this.source);
    this.kick.addEventListener('event', ({ detail }) => this.handleEvent(detail));
    this.kick.addEventListener('status', ({ detail }) => {
      if (detail.state === 'connecting') return this.setStatus('Connecting…');
      if (detail.state === 'reconnecting') {
        this.dropped = true;
        return this.setStatus('Reconnecting…', 'warn');
      }
      if (detail.state === 'recovered') {
        this.setStatus('');
        if (this.dropped) this.fillGap();
        this.dropped = false;
        return;
      }
      if (detail.state === 'polling') {
        this.setStatus('Delayed', 'warn');
        return this.pane.system("Kick's live chat connection isn't available, so new messages come every few seconds (without deletions, bans or subs).", this);
      }
      if (detail.state === 'missing') {
        this.setStatus('Not found', 'warn');
        return this.pane.system(detail.text, this);
      }
      // Ready: the channel is known.
      const channel = detail.channel;
      this.kickChannel = channel;
      this.roomId = channel.userId; // its broadcaster: what Kick's API sends and moderates by
      this.label = channel.name;
      this.modes = channel.modes;
      this.setStatus('');
      if (channel.avatar) this.setAvatar(channel.avatar);
      this.watchLive(() => this.kick.liveInfo());
      this.loadKickExtras(channel);
    });
    this.kick.start();
  }

  async loadKickExtras(channel) {
    const ready = Promise.all([this.globalsReady, kickEmotes(channel.slug), kickChannelEmotes(channel.userId, this.ctx.settings.emotes)])
      .then(([, kick, seventv]) => {
        for (const [name, emote] of [...kick, ...seventv]) this.emotes.set(name, emote);
        this.channelEmotes = new Map([...[...kick].filter(([, e]) => e.owner === 'channel'), ...seventv]);
        this.kickGlobalEmotes = new Map([...kick].filter(([, e]) => e.owner === 'kick')); // Kick's global ones and emoji
      })
      .catch(() => {});
    if (this.ctx.kickSignedIn) {
      kickCardUser(channel.slug, this.ctx.kickAuth.login, channel.subBadges)
        .then((me) => {
          this.kickMod = Boolean(me?.isMod);
          this.banned = Boolean(me?.banned);
          this.pane.renderHead();
          this.pane.renderInput();
        })
        .catch(() => {});
    }
    if (!this.ctx.settings.recentMessages) return;
    // Its emotes first, so they show in what was said before; but a slow emote service (7TV) doesn't hold it up long.
    await Promise.race([ready, new Promise((r) => setTimeout(r, 4000))]);
    // Kick's web API now and then fails a request: once more after a moment.
    const earlier = await this.kick.history().catch(() => new Promise((r) => setTimeout(r, 2000)).then(() => this.kick.history()).catch(() => []));
    if (!this.stopped) this.pane.addHistory(earlier, this);
  }

  /** How long the stream has been live and how many watch; refreshed every minute. */
  watchLive(fetchInfo) {
    const refresh = async () => {
      try {
        this.live = await fetchInfo();
        this.pane.renderHead();
      } catch {
        // Keep what's shown; try again next minute.
      }
    };
    refresh();
    this.liveTimer = setInterval(refresh, 60_000);
  }

  setStatus(text, tone = '') {
    this.status = text;
    this.statusTone = tone;
    this.pane.renderHead();
  }

  setAvatar(url) {
    this.avatar = url;
    this.pane.updateAvatars(this);
    this.pane.renderHead();
  }

  async handleEvent(event) {
    const { pane } = this;
    switch (event.type) {
      case 'message':
        return pane.add(event.message, this);
      case 'deleteMessage':
        return pane.markDeleted((m) => m.id === event.id);
      case 'clearUser':
        // Remembered for their user card too.
        this.offenses.push({ id: `timeout-${event.time}`, kind: 'timeout', time: event.time, duration: event.duration, user: { id: event.userId, login: event.login } });
        if (this.offenses.length > 500) this.offenses.shift();
        // Their messages up to it (in the earlier messages, they may have written again after a short timeout).
        pane.markDeleted((m, feed) => feed === this && m.time <= event.time && (m.user.id === event.userId || (event.login && m.user.login === event.login)));
        if (this.platform === 'kick' && !event.duration && this.ctx.isOwn({ id: event.userId }, 'kick')) {
          this.banned = true; // you: no more sending here
          pane.renderInput();
        }
        if (!event.earlier) pane.add(this.modMessage(event), this); // the earlier ones are placed by loadHistory
        return;
      case 'clearAll':
        return pane.system('The chat was cleared by a moderator.', this);
      case 'live':
        // Kick: went live or ended; look again now rather than in a minute.
        return this.kick?.liveInfo().then((live) => ((this.live = live), pane.renderHead()), () => {});
      case 'notice':
        if (event.id === 'msg_banned' && !this.banned && this.ctx.signedIn) this.readAsGuest();
        return pane.system(event.text, this);
      case 'room': {
        // Chat modes: the first has them all, later ones only what changed.
        this.modes = { ...this.modes, ...event.modes };
        pane.renderHead();
        if (this.roomId || !event.roomId) return;
        // The channel's numeric id: now its own emotes and badges can load, and 7TV cosmetics come in.
        this.roomId = event.roomId;
        this.ctx.cosmetics?.watch(event.roomId);
        const [emotes, badges] = await Promise.all([
          channelEmotes(event.roomId, this.source.channel, this.ctx.settings.emotes),
          twitchBadges(this.ctx.auth, event.roomId),
        ]);
        for (const [name, emote] of emotes) this.emotes.set(name, emote);
        this.channelEmotes = emotes;
        if (badges.size) this.badgeImages = badges;
        if (this.ctx.signedIn) twitchUsableEmotes(this.ctx.auth, event.roomId).then((map) => (this.twitchEmotes = map));
        return;
      }
      default:
        return;
    }
  }

  /**
   * A timeout or ban as a notice in the chat ("name was timed out · 10 minutes").
   * Twitch gives only their login (and not who did it); their name and colour
   * come from their messages here, when they've written lately.
   */
  modMessage(event) {
    const user = this.chatters.get(event.login) || { id: event.userId, login: event.login, name: event.login, color: '', badges: [] };
    const what = event.duration ? { type: 'timeout', duration: event.duration } : { type: 'ban' };
    return { id: `mod-${this.platform}-${event.userId}-${event.time}`, platform: this.platform, kind: 'notice', time: event.time, user, text: '', system: '', event: what };
  }

  /** Messages missed while the connection was down, in their place (not greyed: they're new). */
  async fillGap() {
    if (this.kick) {
      const missed = await this.kick.history().catch(() => []);
      return this.stopped || this.pane.addHistory(missed, this, { greyed: false });
    }
    const lines = await twitchRecentMessages(this.source.channel, 100).catch(() => []);
    if (!this.stopped) this.addRecent(lines, false);
  }

  /**
   * Recent-messages lines in their place: the messages, then the timeouts and bans by time (with the names and
   * colours of the messages just added), then the deletions and clears applied to them.
   */
  addRecent(lines, greyed) {
    const messages = [];
    const clears = [];
    for (const line of lines) {
      const event = twitchEvent(parseIrc(line));
      if (event?.type === 'message') messages.push(event.message);
      else if (event?.type === 'clearUser' || event?.type === 'deleteMessage') clears.push(event);
    }
    this.pane.addHistory(messages, this, { greyed });
    this.pane.addHistory(clears.filter((e) => e.type === 'clearUser').map((e) => this.modMessage(e)), this, { greyed });
    for (const event of clears) this.handleEvent({ ...event, earlier: true });
  }

  /** What was said before you opened the chat (Twitch), placed above what's arrived since. */
  async loadHistory() {
    if (!this.ctx.settings.recentMessages) return;
    const lines = await twitchRecentMessages(this.source.channel).catch(() => []);
    if (this.stopped) return;
    // The history carries the channel's id: load its emotes and cheers first, so they show in it.
    const roomId = lines.length ? parseIrc(lines[0]).tags['room-id'] : '';
    if (roomId) {
      await Promise.all([
        this.globalsReady,
        this.cheersReady,
        channelEmotes(roomId, this.source.channel, this.ctx.settings.emotes).then((map) => {
          for (const [name, emote] of map) this.emotes.set(name, emote);
          this.channelEmotes = map;
        }),
      ]).catch(() => {});
    }
    if (!this.stopped) this.addRecent(lines, true);
  }

  /** The emotes you can type here: this chat's, and your own Twitch ones. */
  get typable() {
    return new Map([...this.emotes, ...this.twitchEmotes]);
  }

  /** You moderate this channel (or it's yours): mod tools show (Twitch or Kick, signed in). */
  get isMod() {
    if (this.platform === 'kick') return this.ctx.kickSignedIn && !this.banned && Boolean(this.kickMod) && Boolean(this.ctx.kickAuth.scopes?.includes('moderation:ban'));
    const badges = this.client?.userStates.get(this.source.channel)?.badges || '';
    return this.ctx.signedIn && !this.banned && /(^|,)(broadcaster|moderator)\//.test(badges);
  }

  /** Slow mode applies to you here (moderators, VIPs and the broadcaster skip it). */
  get slowFor() {
    if (this.platform !== 'twitch') return 0; // Kick says so when you send too soon
    const badges = this.client?.userStates.get(this.source.channel)?.badges || '';
    return /(^|,)(broadcaster|moderator|vip)\//.test(badges) ? 0 : this.modes.slow || 0;
  }

  /** The stream itself. */
  pageUrl() {
    const { source } = this;
    if (this.platform === 'twitch') return `https://www.twitch.tv/${source.channel}`;
    if (this.platform === 'kick') return `https://kick.com/${source.channel}`;
    const video = this.youtube?.videoId || source.videoId;
    if (video) return `https://www.youtube.com/watch?v=${video}`;
    return `https://www.youtube.com/${source.handle || `channel/${source.channelId}`}`;
  }

  /** YouTube's own chat for this stream, where you write on YouTube (null until the stream is found). */
  get youTubeChatUrl() {
    const video = this.youtube?.videoId || this.source.videoId;
    return video ? `https://www.youtube.com/live_chat?is_popout=1&v=${video}` : null;
  }

  /** Where a user's channel is, on this feed's platform. */
  profileUrl(user) {
    if (this.platform === 'kick') return `https://kick.com/${user.login}`;
    return this.platform === 'twitch' ? `https://www.twitch.tv/${user.login}` : `https://www.youtube.com/channel/${user.id}`;
  }

  stop() {
    this.stopped = true;
    this.disconnect();
    this.youtube?.stop();
    this.kick?.stop();
    clearInterval(this.liveTimer);
  }
}

/* ---- Panes ---- */

export class ChatPane {
  /**
   * @param {HTMLElement} host where the pane goes
   * @param {object[]} chat its sources (from sources.js); several are merged into one list
   * @param {ChatContext} ctx
   * @param {object} options
   *   onClose: show a close button that calls it
   *   onChange(chat): channels were added or removed here (to save the new list)
   *   popOut: show the pop-out button (default true)
   */
  constructor(host, chat, ctx, { onClose, onChange, popOut = true } = {}) {
    this.ctx = ctx;
    this.onChange = onChange;
    this.lines = []; // { message, node, feed, count?, lastTime? }
    this.recent = new Map(); // fold key → line, for folding repeats
    this.seen = new Set();
    this.queue = [];
    this.unseen = 0;
    this.atBottom = true;
    this.holds = new Set(); // why the chat holds still: 'pointer', 'moving', 'finger', 'selection' (see hold)
    this.holdTimers = new Map(); // reason → its pending release
    this.pressing = false; // a button or finger is down on the list (dragging the scrollbar, a touch scroll)
    this.scrolledAt = 0; // when you last scrolled it yourself (wheel, keys)
    this.heat = { said: [], counts: new Map() }; // Fold similar messages: the last 30 s's words (noteWords)
    this.touch = false; // the last press on the chat was a finger (no hovering then)
    this.feeds = [];
    this.sent = []; // what you've sent here, for ↑ (newest last)
    this.recall = null; // where ↑/↓ is in it, or null
    this.build(host, onClose, popOut);
    // Settings changed: what's hidden, who's a friend, the theme (name colours), cosmetics.
    this.knownFriends = new Set(ctx.friends);
    this.onReload = (e) => {
      this.applyFilter();
      const was = this.knownFriends;
      this.knownFriends = new Set(ctx.friends);
      if (e.detail?.restyled) this.rerender();
      else this.redrawUser((u) => was.has(u.login?.toLowerCase()) !== this.knownFriends.has(u.login?.toLowerCase()));
      this.watchCosmetics();
    };
    ctx.addEventListener('reload', this.onReload);
    this.onCosmetics = ({ detail: uid }) => this.redrawUser((u) => u.id === uid);
    this.watchCosmetics();
    panes.add(this);
    for (const type of ['pointerenter', 'focusin']) this.root.addEventListener(type, () => (activePane = this));
    this.setChat(chat);
  }

  get chat() {
    return this.feeds.map((f) => f.source);
  }

  get key() {
    return chatKey(this.chat);
  }

  /** Several feeds: each message shows the channel it came from. */
  get merged() {
    return this.feeds.length > 1;
  }

  /** Different platforms together: each message also shows the platform. */
  get mixed() {
    return new Set(this.feeds.map((f) => f.platform)).size > 1;
  }

  /** Show these sources: feeds for new ones start, feeds for removed ones stop. */
  setChat(chat) {
    const wanted = uniqueSources(chat);
    const wasMerged = this.merged;
    const keep = new Map(this.feeds.map((f) => [f.key, f]));
    const feeds = wanted.map((source) => keep.get(sourceKey(source)) || new Feed(this, source));
    for (const feed of this.feeds) if (!feeds.includes(feed)) feed.stop();
    const added = feeds.filter((f) => !this.feeds.includes(f));
    this.feeds = feeds;
    this.root.dataset.platform = this.mixed ? 'mixed' : feeds[0].platform;
    for (const feed of added) feed.start();
    // Going between one feed and several changes how every line looks.
    if (wasMerged !== this.merged && this.lines.length) this.rerender();
    this.renderHead();
    this.renderInput();
  }

  /** You added or removed a channel here. */
  changeChat(chat) {
    this.setChat(chat);
    this.onChange?.(this.chat);
  }

  /* ---- DOM ---- */

  build(host, onClose, popOut) {
    this.root = el('section', 'pane');

    const head = el('header', 'pane-head');
    this.feedsEl = el('div', 'pane-feeds');
    this.statusEl = el('span', 'pane-status');
    const actions = el('div', 'pane-actions');
    actions.append(
      iconButton('plus', 'Add a channel to this chat', () => this.toggleRow(this.addRow, this.addInput)),
      iconButton('search', 'Filter messages', () => this.toggleRow(this.filterRow, this.filterInput)),
    );
    if (popOut) actions.append(iconButton('external', 'Pop out this chat', () => popOutChat(this.chat)));
    if (onClose) actions.append(iconButton('x', 'Close this chat', onClose));
    head.append(this.feedsEl, this.statusEl, actions);
    this.feedsPop = el('div', 'feeds-pop');
    this.feedsPop.hidden = true;
    // Click outside the panel or press Esc: close it.
    // Also the user card (not when the click opens another one).
    this.onOutside = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      const inside = (...nodes) => e.type === 'pointerdown' && nodes.some((n) => n.contains(e.target));
      // Esc always closes the card; a click does unless it's on a name (which opens another).
      const onName = e.type === 'pointerdown' && e.target.closest?.('.name');
      const cardOpen = !this.card.hidden;
      if (cardOpen && !inside(this.card) && !onName) this.card.hidden = true;
      // The conversation too, but Esc closes a card opened from it first.
      if (!this.thread.hidden && !inside(this.thread, this.card) && !(e.type === 'keydown' && cardOpen)) this.thread.hidden = true;
      if (this.picker && !this.picker.hidden && !inside(this.picker, this.pickerBtn)) this.picker.hidden = true;
      if (!this.feedsPop.hidden && !inside(this.feedsPop, this.feedsEl)) {
        this.feedsPop.hidden = true;
        this.renderHead();
      }
    };
    document.addEventListener('pointerdown', this.onOutside);
    document.addEventListener('keydown', this.onOutside);

    // "+": add channels, merged into this chat.
    this.addRow = el('form', 'pane-filter');
    this.addRow.hidden = true;
    this.addInput = el('input', 'input');
    this.addInput.placeholder = 'Add a channel: Twitch name, kick:name, YouTube @handle or link';
    this.addInput.setAttribute('aria-label', 'Add a channel to this chat');
    this.addInput.addEventListener('input', () => this.addInput.setCustomValidity(''));
    this.addRow.append(this.addInput);
    this.removeSuggest = channelSuggest(this.addInput, this.ctx, {
      exclude: () => this.feeds.filter((f) => f.platform !== 'youtube').map((f) => (f.platform === 'kick' ? `kick:${f.source.channel}` : f.source.channel)),
    });
    this.addRow.addEventListener('submit', (e) => {
      e.preventDefault();
      const more = chatFromInput(this.addInput.value);
      if (!more) {
        this.addInput.setCustomValidity('Enter a Twitch channel, kick:name, a YouTube @handle, or a Twitch/Kick/YouTube link.');
        return this.addInput.reportValidity();
      }
      if (this.feeds.length + more.length > MAX_MERGED) {
        this.addInput.setCustomValidity(`Up to ${MAX_MERGED} channels in one chat.`);
        return this.addInput.reportValidity();
      }
      this.changeChat([...this.chat, ...more]);
      this.toggleRow(this.addRow, this.addInput);
    });

    this.filterRow = el('div', 'pane-filter');
    this.filterRow.hidden = true;
    this.filterInput = el('input', 'input');
    this.filterInput.type = 'search';
    this.filterInput.placeholder = 'Filter by text or name';
    this.filterInput.setAttribute('aria-label', 'Filter messages');
    this.filterInput.addEventListener('input', () => this.applyFilter());
    this.filterRow.append(this.filterInput);

    this.list = el('div', 'pane-list');
    this.list.setAttribute('role', 'log');
    this.list.addEventListener('scroll', () => {
      // While it's held, only your own scrolling says whether you follow the chat: the chat moves its lines itself
      // then (repeats folding to the bottom), which must not read as you scrolling up and leave it paused.
      if (this.hovering && !this.pressing && performance.now() - this.scrolledAt > 300) return;
      this.atBottom = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 40;
      if (this.atBottom) this.setUnseen(0);
      this.list.classList.toggle('scrolled-up', !this.atBottom);
    });
    // Tooltips for emotes, badges, channels and replies. The chat holds still
    // while one is open, and while you're over a reply or a name.
    this.list.addEventListener('mouseover', (e) => {
      pointerX = e.clientX; // the tooltip goes where the pointer is (wide targets)
      const target = e.target.closest(TIP_TARGETS);
      if (target !== this.tipTarget) {
        this.tipTarget = target;
        this.markReplied(target?.classList.contains('reply-line') ? target : null);
        if (target?.classList.contains('reply-line')) this.showReplyTip(target);
        else if (target?.matches('a.link')) this.showLinkTip(target);
        else if (target?.matches('.name, .ts')) this.showTimeTip(target);
        else if (target?.matches('.fold-count')) this.showFoldTip(target);
        else if (target) showTip(target);
      }
      if (!this.touch) this.hold(Boolean(e.target.closest(HOLD_TARGETS)), 'pointer', HOLD_GRACE);
    });
    this.list.addEventListener('mouseout', (e) => {
      const target = e.target.closest(TIP_TARGETS);
      if (target && !target.contains(e.relatedTarget)) {
        hideTip();
        this.tipTarget = null;
        this.markReplied(null);
      }
      const next = e.relatedTarget;
      if (!this.touch) this.hold(Boolean(next instanceof Element && this.list.contains(next) && next.closest(HOLD_TARGETS)), 'pointer', HOLD_GRACE);
    });
    // Settings → Hold the chat anywhere under the pointer: while it moves over the chat, and a moment after.
    this.list.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.ctx.settings.holdAnywhere) return;
      this.hold(true, 'moving');
      this.hold(false, 'moving', HOLD_MOVING);
    }, { passive: true });
    // A touch screen has no pointer that hovers or leaves the chat: it holds still only while a finger is on it
    // (so what you tap doesn't slide away), not after a tap (its mouseover). Scrolling up yourself still stops it.
    this.list.addEventListener('pointerdown', (e) => {
      this.pressing = true;
      this.touch = e.pointerType === 'touch';
      if (this.touch) this.hold(true, 'finger');
    });
    this.list.addEventListener('pointerup', (e) => e.pointerType === 'touch' && this.hold(false, 'finger'));
    this.list.addEventListener('pointercancel', (e) => e.pointerType === 'touch' && this.holds.delete('finger')); // a scroll began: it says where you are
    this.onPointerUp = () => (this.pressing = false); // also let go of outside the list (a scrollbar drag)
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointercancel', this.onPointerUp);
    for (const type of ['wheel', 'keydown']) this.list.addEventListener(type, () => (this.scrolledAt = performance.now()), { passive: true });
    // Selecting text holds it too, so what you select doesn't slide away, till the selection's gone.
    this.onSelection = () => {
      const selection = document.getSelection();
      this.hold(Boolean(selection && !selection.isCollapsed && this.list.contains(selection.anchorNode)), 'selection');
    };
    document.addEventListener('selectionchange', this.onSelection);
    // Leaving the chat: back to the newest messages, however it was paused (held or scrolled up); still selecting
    // (the button down), it waits for that. Not when the pointer goes onto something of the chat's own: the user
    // card, a menu, a tooltip…
    this.list.addEventListener('mouseleave', (e) => {
      this.actions.remove();
      if (e.relatedTarget?.closest?.('.usercard, .thread-panel, .context-menu, .hover-tip, .emote-picker, .suggest, .feeds-pop')) return;
      hideTip();
      this.letGo(e.buttons & 1 ? ['pointer', 'moving'] : ['pointer', 'moving', 'selection']);
      if (!this.hovering && (!this.atBottom || this.unseen)) this.scrollToEnd();
    });
    this.list.addEventListener('contextmenu', (e) => {
      if (e.target.closest('a')) return; // links keep the browser's menu (copy link…)
      const node = e.target.closest('.msg');
      const line = node && this.lines.find((l) => l.node === node);
      if (!line?.message.user?.name) return;
      e.preventDefault();
      this.openMenu(e, line.message, line.feed);
    });
    // The message under the pointer gets a few buttons (one bar, moved from message to message). Not a deleted one:
    // you point at it to read what it said, and the bar would cover it (right-click still has everything).
    this.actions = el('div', 'msg-actions');
    this.list.addEventListener('mouseover', (e) => {
      const node = e.target.closest('.msg');
      if (node && node === this.actions.parentNode) return;
      const line = node && this.lines.find((l) => l.node === node);
      if (line?.message.user?.name && !node.classList.contains('deleted')) this.showActions(line);
      else this.actions.remove();
      if (!this.touch) this.hold(Boolean(e.target.closest(HOLD_TARGETS)), 'pointer', HOLD_GRACE); // again, now the message has its buttons (mods: it holds)
    });

    this.more = el('button', 'pane-more');
    this.more.type = 'button';
    this.more.hidden = true;
    this.more.addEventListener('click', () => this.scrollToEnd());

    this.card = el('div', 'usercard');
    this.card.setAttribute('role', 'dialog');
    this.card.hidden = true;
    // A conversation (showThread): a reply, what it answers and the other replies.
    this.thread = el('div', 'thread-panel');
    this.thread.setAttribute('role', 'dialog');
    this.thread.setAttribute('aria-label', 'Conversation');
    this.thread.hidden = true;

    this.inputForm = el('form', 'pane-input');
    this.inputForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send();
    });
    // The list and its "new messages" pill, which sits at the list's bottom edge.
    const body = el('div', 'pane-body');
    body.append(this.list, this.more);
    this.root.append(head, this.feedsPop, this.addRow, this.filterRow, body, this.inputForm, this.card, this.thread);
    host.append(this.root);
  }

  /**
   * The header. One feed: platform icon, name, live time and viewers. Several:
   * one line with their pictures, names and total viewers; click it for a
   * panel with each channel (live time, viewers, open, remove).
   */
  renderHead() {
    if (hoverTip?.dataset.kind === 'mode') hideTip(); // its mode is about to be replaced
    if (this.merged) {
      this.renderMergedHead();
    } else {
      const [feed] = this.feeds;
      const chip = el('span', 'feed-chip');
      chip.dataset.platform = feed.platform;
      chip.append(platformTile(feed.platform), el('span', 'pane-title', feed.label));
      if (feed.banned) chip.append(el('span', 'pane-flag', 'Banned'));
      const live = this.renderLive(feed.live);
      if (live) chip.append(live);
      const modes = this.renderModes(feed.modes);
      if (modes) chip.append(modes);
      this.feedsEl.replaceChildren(chip);
      this.feedsPop.hidden = true;
    }
    // Connecting / Reconnecting / Offline, for the first feed that has something to say.
    const busy = this.feeds.find((f) => f.status);
    this.statusEl.textContent = busy ? (this.merged ? `${busy.label}: ${busy.status}` : busy.status) : '';
    this.statusEl.dataset.tone = busy?.statusTone || '';
  }

  renderMergedHead() {
    const btn = el('button', 'feed-stack');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', String(!this.feedsPop.hidden));
    btn.setAttribute('aria-label', `Channels in this chat: ${this.feeds.map((f) => f.label).join(', ')}`);
    const pics = el('span', 'stack-pics');
    pics.append(...this.feeds.map((feed) => this.sourcePicture(feed, 'stack-pic', this.mixed)));
    btn.append(pics, el('span', 'pane-title', this.feeds.map((f) => f.label).join(', ')));
    if (this.feeds.some((f) => f.banned)) btn.append(el('span', 'pane-flag', 'Banned'));
    // Everyone watching, across the channels.
    if (this.feeds.some((f) => f.live)) {
      const total = this.feeds.reduce((n, f) => n + (f.live?.viewers ?? 0), 0);
      const live = el('span', 'pane-live');
      const viewers = el('span', 'viewers');
      viewers.setAttribute('aria-label', `${total.toLocaleString()} watching in all`);
      viewers.append(icon('user'), formatCount(total));
      live.append(viewers);
      btn.append(live);
    } else if (this.feeds.every((f) => f.live === null)) {
      btn.append(this.renderLive(null));
    }
    btn.append(icon('chevron-down', 'icon stack-chevron'));
    btn.addEventListener('click', () => {
      this.feedsPop.hidden = !this.feedsPop.hidden;
      this.renderHead();
    });
    this.feedsEl.replaceChildren(btn);
    if (!this.feedsPop.hidden) this.renderFeedsPop();
  }

  /** The merged header's panel: each channel with its live time and viewers, open and remove. */
  renderFeedsPop() {
    this.feedsPop.replaceChildren(
      ...this.feeds.map((feed) => {
        const info = el('div', 'pop-info');
        info.append(el('span', 'pop-name', feed.label));
        if (feed.banned) info.append(el('span', 'pane-flag', 'Banned'));
        const live = this.renderLive(feed.live);
        const modes = this.renderModes(feed.modes);
        if (live || modes) {
          const meta = el('div', 'pop-meta');
          meta.append(...[live, modes].filter(Boolean));
          info.append(meta);
        }
        const site = PLATFORM_NAMES[feed.platform];
        const row = el('div', 'pop-row');
        row.append(
          this.sourcePicture(feed, 'pop-pic', true),
          info,
          iconButton('external', `Open ${feed.label} on ${site}`, () => window.open(feed.pageUrl(), '_blank', 'noopener')),
          iconButton('x', `Remove ${feed.label} from this chat`, () =>
            this.changeChat(this.chat.filter((s) => sourceKey(s) !== feed.key)),
          ),
        );
        return row;
      }),
    );
  }

  /**
   * Chat modes (Twitch's or Kick's) as one small group of icons (with a short value where
   * there is one: "30s", "10m"), or null when none is on. Hover one for what it means.
   */
  renderModes(modes) {
    const span = (minutes) => (minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`);
    const slow = modes.slow >= 60 ? span(Math.round(modes.slow / 60)) : `${modes.slow}s`;
    const items = [
      modes.slow > 0 && ['clock', slow, 'Slow mode', `One message every ${slow}`],
      modes.followersOnly >= 0 && [
        'heart',
        modes.followersOnly ? span(modes.followersOnly) : '',
        'Followers-only',
        modes.followersOnly ? `Followed for at least ${span(modes.followersOnly)}` : 'Followers can chat',
      ],
      modes.subsOnly && ['star', '', 'Subscribers-only', 'Only subscribers can chat'],
      modes.emoteOnly && ['smile', '', 'Emote-only', 'Messages can only be emotes'],
      modes.unique && ['fingerprint', '', 'Unique chat', 'No repeating the same message (R9K)'],
    ].filter(Boolean);
    if (!items.length) return null;
    const wrap = el('span', 'pane-modes');
    for (const [name, value, title, text] of items) {
      const mode = el('span', 'mode');
      mode.setAttribute('aria-label', `${title}: ${text}`);
      mode.append(icon(name));
      if (value) mode.append(el('span', 'mode-value', value));
      mode.addEventListener('mouseenter', () => placeTip(mode, 'mode', [el('strong', '', title), el('span', 'tip-source', text)]));
      mode.addEventListener('mouseleave', hideTip);
      wrap.append(mode);
    }
    return wrap;
  }

  /** `info` is { startedAt, viewers } (either may be null), null when offline, undefined when not known yet. */
  renderLive(info) {
    if (info === undefined) return null;
    const live = el('span', 'pane-live');
    if (!info) {
      live.classList.add('offline');
      live.textContent = 'Offline';
      return live;
    }
    if (info.startedAt) live.append(el('span', 'uptime', formatUptime(Date.now() - info.startedAt)));
    if (info.viewers != null) {
      const viewers = el('span', 'viewers');
      viewers.setAttribute('aria-label', `${info.viewers.toLocaleString()} watching`);
      viewers.append(icon('user'), formatCount(info.viewers));
      live.append(viewers);
    }
    return live.children.length ? live : null;
  }

  /** The feed's channel picture (filled in when it arrives). */
  avatarImg(feed, className = '') {
    const img = el('img', `source-avatar ${className}`.trim());
    img.alt = '';
    img.dataset.feed = feed.key;
    if (feed.avatar) img.src = feed.avatar;
    return img;
  }

  /** A feed's channel picture, with a small Twitch / YouTube / Kick badge on its corner when `platform`. */
  sourcePicture(feed, className, platform) {
    const pic = el('span', `source-pic ${className}`);
    pic.append(this.avatarImg(feed));
    if (platform) pic.append(platformBadge(feed.platform));
    return pic;
  }

  /** The feed's picture arrived: fill it in on its lines and the send-to button. */
  updateAvatars(feed) {
    for (const img of this.root.querySelectorAll(`img.source-avatar[data-feed="${CSS.escape(feed.key)}"]`)) img.src = feed.avatar;
  }

  toggleRow(row, input) {
    row.hidden = !row.hidden;
    if (row.hidden) input.value = '';
    else input.focus();
    if (row === this.filterRow) this.applyFilter();
  }

  /* ---- Sending (Twitch and Kick) ---- */

  /** The message box: for the channels here you can write in (a picker when there are several). */
  renderInput() {
    const form = this.inputForm;
    this.picker = this.pickerBtn = null; // made again with the box (Ctrl/⌘+E checks for one)
    // Twitch and Kick take messages; YouTube chat is read-only here, so it links to YouTube's own.
    const writable = this.feeds.filter((f) => f.platform === 'twitch' || f.platform === 'kick');
    const sendable = writable.filter((f) => this.ctx.canWrite(f) && !f.banned);
    const youtube = this.feeds.filter((f) => f.platform === 'youtube');
    const draft = this.input?.value || ''; // kept when channels are added or removed
    this.input = null;
    this.replyTo = null;
    form.hidden = !writable.length && !youtube.length;
    if (!writable.length) return form.replaceChildren(...(youtube.length ? [this.youTubeLink(youtube)] : []));
    const unsigned = [...new Set(writable.filter((f) => !this.ctx.canWrite(f)).map((f) => PLATFORM_NAMES[f.platform]))];
    if (!sendable.length && unsigned.length) {
      const hint = el('button', 'link-btn', `Sign in to ${unsigned.join(' or ')} to chat`);
      hint.type = 'button';
      hint.addEventListener('click', () => chrome.runtime.openOptionsPage());
      return form.replaceChildren(hint);
    }
    if (!sendable.length) {
      // Twitch stops sending a chat to banned accounts, so it's read as a guest there.
      const guest = writable.some((f) => f.banned && f.platform === 'twitch');
      return form.replaceChildren(el('p', 'input-note', `You're banned from chatting here.${guest ? ' Reading as a guest.' : ''}`));
    }
    if (!sendable.includes(this.target)) this.target = sendable[0];

    const input = el('input', 'input');
    input.maxLength = 500;
    input.value = draft;
    const suggest = this.buildSuggest(input);
    // After the suggestion list's own keys (it handles them first when it's open).
    input.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && this.replyTo) this.setReply(null);
      else if (e.key === 'Tab' && !e.shiftKey) this.completeName(e);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.recallSent(e);
    });
    input.addEventListener('input', () => (this.recall = null)); // typing ends going through what you sent
    this.input = input;
    this.replyChip = el('div', 'reply-chip');
    this.replyChip.hidden = true;
    const row = el('div', 'input-row');
    this.targetBtn = null;
    if (sendable.length > 1) {
      // Which channel you're writing to: its picture; click for the others.
      this.targetBtn = el('button', 'target-btn');
      this.targetBtn.type = 'button';
      this.targetBtn.setAttribute('aria-haspopup', 'menu');
      this.targetBtn.addEventListener('click', () => {
        const r = this.targetBtn.getBoundingClientRect();
        const items = sendable.map((feed) => [feed.source.channel, () => this.setTarget(feed), this.avatarImg(feed, 'menu-avatar')]);
        showMenu(r.left, r.top, items, { above: true });
      });
      row.append(this.targetBtn);
      row.classList.add('compose'); // the picture sits inside the box, before the text
    }
    // Slow mode: how long until you can send here again.
    this.cooldownEl = el('span', 'cooldown');
    this.cooldownEl.hidden = true;
    this.pickerBtn = iconButton('smile', 'Emotes (Ctrl/⌘+E)', () => this.toggleEmotePicker());
    this.pickerBtn.classList.add('picker-btn');
    this.picker = el('div', 'emote-picker');
    this.picker.setAttribute('role', 'dialog');
    this.picker.setAttribute('aria-label', 'Emotes');
    this.picker.hidden = true;
    row.append(input, this.pickerBtn, this.cooldownEl);
    form.replaceChildren(this.replyChip, row, suggest, this.picker);
    this.setTarget(this.target);
  }

  /** "Write on YouTube": the stream's YouTube chat in a small window (a menu first when there are several). */
  youTubeLink(feeds) {
    const open = (feed) => {
      const url = feed.youTubeChatUrl;
      if (url) chrome.windows.create({ url, type: 'popup', width: 420, height: 720 });
      else window.open(feed.pageUrl(), '_blank', 'noopener'); // not live (yet): the channel
    };
    const link = el('button', 'link-btn', 'Write on YouTube');
    link.type = 'button';
    link.title = "Opens the stream's YouTube chat in a small window";
    link.append(icon('external'));
    link.addEventListener('click', () => {
      if (feeds.length === 1) return open(feeds[0]);
      const r = link.getBoundingClientRect();
      showMenu(r.left, r.top, feeds.map((feed) => [feed.label, () => open(feed), this.avatarImg(feed, 'menu-avatar')]), { above: true });
    });
    return link;
  }

  /**
   * Kick: through Kick's API. Your message comes back over the chat socket
   * like everyone's, so it isn't added here.
   */
  async sendKick(target) {
    const text = this.input.value.trim();
    if (!text || !target.roomId) return; // the channel isn't loaded yet
    const input = this.input;
    input.disabled = true;
    try {
      // Kick's own emotes as Kick writes them ("[emote:37226:KEKW]"), so kick.com shows them too.
      const content = text.replace(/\S+/g, (word) => (target.emotes.get(word)?.kickId ? `[emote:${target.emotes.get(word).kickId}:${word}]` : word));
      await kickSend(this.ctx.kickAuth, target.roomId, content, this.replyTo?.id);
      this.afterSend(text, target.emotes);
    } catch (error) {
      this.system(error.message, target);
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  setTarget(feed) {
    if (this.replyTo && this.replyTo.feed !== feed) this.setReply(null); // its message is in the other channel
    this.target = feed;
    if (this.picker) this.picker.hidden = true; // its emotes were the other channel's
    if (this.targetBtn) {
      this.targetBtn.replaceChildren(this.avatarImg(feed, 'target-avatar'), icon('chevron-down'));
      this.targetBtn.setAttribute('aria-label', `Sending to ${feed.source.channel}. Change`);
    }
    this.input.placeholder = `Message #${feed.source.channel}`;
    this.input.setAttribute('aria-label', `Message #${feed.source.channel}`);
    this.showCooldown();
  }

  /** The ☺ button: browse the emotes you can use in the channel you're writing to, and pick some. */
  async toggleEmotePicker() {
    const picker = this.picker;
    if (!picker.hidden) {
      picker.hidden = true;
      this.input.focus();
      return;
    }
    await this.renderPicker();
    picker.hidden = false;
    picker.querySelector('.picker-search').focus();
  }

  /**
   * The picker's contents. Drawn again when you star or unstar an emote, so
   * Favourites follows right away: `keep` holds the search, the scroll position
   * and the emote you right-clicked, which stays under the pointer.
   */
  async renderPicker(keep = null) {
    const picker = this.picker;
    const feed = this.target;
    const global = await this.ctx.globalEmotes();
    // Everything you can use here, for your favourites and recently used ones.
    const usable = new Map([...global, ...(feed.kickGlobalEmotes || []), ...feed.channelEmotes, ...feed.twitchEmotes]);
    const pick = (names) => new Map(names.filter((n) => usable.has(n)).map((n) => [n, usable.get(n)]));
    const favorites = this.ctx.settings.favoriteEmotes;
    const recent = Object.entries(this.ctx.emoteUse).sort((a, b) => b[1].at - a[1].at).map(([n]) => n).slice(0, 40);
    const favoriteEmotes = pick(favorites);
    const groups = [
      ['★ Favourites', favoriteEmotes],
      ['Recent', new Map([...pick(recent)].slice(0, 24))],
      ['Your Twitch emotes', feed.twitchEmotes],
      [`${feed.label}'s emotes`, feed.channelEmotes],
      ['Kick', feed.kickGlobalEmotes],
      ['Global', global],
    ].filter(([, map]) => map?.size);
    const search = el('input', 'input picker-search');
    search.type = 'search';
    search.placeholder = 'Search emotes';
    search.setAttribute('aria-label', 'Search emotes');
    const hovered = el('div', 'picker-hovered', ' ');
    const body = el('div', 'picker-body');
    const sections = groups.map(([title, map]) => {
      const grid = el('div', 'picker-grid');
      for (const [name, emote] of map) {
        const btn = el('button', 'picker-emote');
        btn.type = 'button';
        btn.dataset.name = name.toLowerCase();
        btn.setAttribute('aria-label', name);
        const img = el('img');
        img.src = emote.url;
        img.alt = '';
        img.loading = 'lazy';
        btn.append(img);
        // Starred, in the other sections (in Favourites itself it goes without saying).
        if (map !== favoriteEmotes && favorites.includes(name)) btn.classList.add('fav');
        btn.addEventListener('click', () => this.insertEmote(name));
        btn.addEventListener('mouseenter', () => (hovered.textContent = `${name} · right-click to ${favorites.includes(name) ? 'unstar' : '★ star'}`));
        // Right-click: star or unstar (favourites come first in the picker and in ":" suggestions).
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const starred = this.ctx.settings.favoriteEmotes;
          const on = !starred.includes(name);
          // Right away here (the saved settings reload a moment later).
          this.ctx.settings.favoriteEmotes = on ? [...starred, name] : starred.filter((n) => n !== name);
          saveSettings({ favoriteEmotes: this.ctx.settings.favoriteEmotes });
          this.renderPicker({ query: search.value, scroll: body.scrollTop, title, name, top: btn.getBoundingClientRect().top });
        });
        grid.append(btn);
      }
      const section = el('section', 'picker-section');
      section.dataset.title = title;
      section.append(el('h4', 'picker-title', title), grid);
      return section;
    });
    body.append(...sections);
    if (!sections.length) body.append(el('p', 'picker-empty', 'Emotes are still loading.'));
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      for (const section of sections) {
        let any = false;
        for (const btn of section.querySelectorAll('.picker-emote')) {
          btn.hidden = Boolean(q) && !btn.dataset.name.includes(q);
          any ||= !btn.hidden;
        }
        section.hidden = !any;
      }
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        picker.hidden = true;
        this.input.focus();
      } else if (e.key === 'Enter') {
        // The first emote the search leaves: into the message, picker closed.
        e.preventDefault();
        const first = shownEmotes()[0];
        if (!first) return;
        first.click();
        picker.hidden = true;
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        shownEmotes()[0]?.focus();
      }
    });
    // The keyboard in the grid: arrows move between emotes (up from the top row: back to the search), Enter picks.
    const shownEmotes = () => [...picker.querySelectorAll('.picker-emote')].filter((b) => !b.hidden && !b.closest('.picker-section').hidden);
    body.addEventListener('keydown', (e) => {
      const from = e.target.closest?.('.picker-emote');
      if (!from || !e.key.startsWith('Arrow')) return;
      e.preventDefault();
      const all = shownEmotes();
      const i = all.indexOf(from);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return all[i + (e.key === 'ArrowRight' ? 1 : -1)]?.focus();
      // Up or down: the nearest emote on the row above or below.
      const at = from.getBoundingClientRect();
      const rows = all.filter((b) => (e.key === 'ArrowDown' ? b.getBoundingClientRect().top > at.top + 4 : b.getBoundingClientRect().top < at.top - 4));
      const rowTop = e.key === 'ArrowDown' ? Math.min(...rows.map((b) => b.getBoundingClientRect().top)) : Math.max(...rows.map((b) => b.getBoundingClientRect().top));
      const row = rows.filter((b) => Math.abs(b.getBoundingClientRect().top - rowTop) < 4);
      const next = row.sort((a, b) => Math.abs(a.getBoundingClientRect().left - at.left) - Math.abs(b.getBoundingClientRect().left - at.left))[0];
      (next || (e.key === 'ArrowUp' ? search : null))?.focus();
    });
    picker.replaceChildren(search, body, hovered);
    if (!keep) return;
    search.value = keep.query;
    search.dispatchEvent(new Event('input'));
    body.scrollTop = keep.scroll;
    // Favourites grew or shrank above it: scroll by as much, so the emote you clicked doesn't move.
    const same = sections.find((sec) => sec.dataset.title === keep.title)?.querySelector(`.picker-emote[data-name="${CSS.escape(keep.name.toLowerCase())}"]`);
    if (same) body.scrollTop += same.getBoundingClientRect().top - keep.top;
    const on = this.ctx.settings.favoriteEmotes.includes(keep.name);
    hovered.textContent = `${keep.name} · right-click to ${on ? 'unstar' : '★ star'}`;
    // The emote you clicked is gone with the old contents: the search has the cursor (Esc, Enter work).
    search.focus();
  }

  /** An emote from the picker, at the caret (spaced from what's around it). */
  insertEmote(name) {
    const input = this.input;
    const before = input.value.slice(0, input.selectionStart);
    input.setRangeText(`${before && !/\s$/.test(before) ? ' ' : ''}${name} `, input.selectionStart, input.selectionEnd, 'end');
    input.focus();
  }

  /** Slow mode: the seconds left before you can send to the channel you're writing to. */
  showCooldown() {
    clearInterval(this.cooldownTimer);
    const tick = () => {
      const left = Math.ceil(((this.target?.cooldownUntil || 0) - Date.now()) / 1000);
      this.cooldownEl.hidden = left <= 0;
      this.cooldownEl.textContent = `Slow mode · ${left}s`;
      if (left <= 0) clearInterval(this.cooldownTimer);
    };
    tick();
    this.cooldownTimer = setInterval(tick, 250);
  }

  /** ↑ / ↓ in an empty box: go through what you've sent here (newest first). */
  recallSent(e) {
    const up = e.key === 'ArrowUp';
    if (this.recall == null) {
      if (!up || this.input.value || !this.sent.length) return;
      this.recall = this.sent.length;
    }
    e.preventDefault();
    this.recall = Math.max(0, Math.min(this.sent.length, this.recall + (up ? -1 : 1)));
    this.input.value = this.sent[this.recall] ?? '';
    if (this.recall === this.sent.length) this.recall = null; // back past the newest: empty again
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  /** Tab after a few letters of a name: the most recent chatter it fits. */
  completeName(e) {
    const before = this.input.value.slice(0, this.input.selectionStart);
    const word = /(@?)(\w+)$/.exec(before);
    const [user] = word ? this.findNames(word[2].toLowerCase()) : [];
    if (!user) return; // Tab moves on as usual
    e.preventDefault();
    this.input.setRangeText(`${word[1]}${mentionName(user)} `, before.length - word[0].length, this.input.selectionStart, 'end');
  }

  /** Up to 8 people chatting in the channel you're writing to whose name fits `query`: starts-with first, most recent first. */
  findNames(query) {
    const users = [...this.target.chatters.values()].reverse().filter((u) => !this.ctx.isOwn(u, this.target.platform));
    const fits = (u, how) => u.login[how](query) || u.name.toLowerCase()[how](query);
    return [...users.filter((u) => fits(u, 'startsWith')), ...users.filter((u) => !fits(u, 'startsWith') && fits(u, 'includes'))].slice(0, 8);
  }

  send() {
    if (!this.input) return;
    const target = this.target;
    if (Date.now() < target.cooldownUntil) {
      // Still in slow mode: keep the text, nudge the countdown.
      this.cooldownEl.classList.remove('nudge');
      void this.cooldownEl.offsetWidth;
      this.cooldownEl.classList.add('nudge');
      return;
    }
    if (target.platform === 'kick') return this.sendKick(target);
    try {
      const text = this.input.value.trim();
      const message = this.ctx.twitch().send(target.source.channel, text, this.replyTo);
      if (message) {
        this.add(message, target);
        this.afterSend(text, target.typable);
        if (target.slowFor) {
          target.cooldownUntil = Date.now() + target.slowFor * 1000;
          this.showCooldown();
        }
      }
    } catch (error) {
      this.system(error.message);
    }
  }

  /**
   * After sending `text`: its emotes (`known`) go to Recent and up the suggestions, it's ↑ in the box, and the box
   * empties. The box may have been made again meanwhile (Kick's sending waits for Kick): this works on the new one.
   */
  afterSend(text, known) {
    this.ctx.noteEmoteUse([...new Set(text.split(/\s+/).filter((w) => known.has(w)))]);
    if (text !== this.sent.at(-1)) this.sent = [...this.sent, text].slice(-30);
    if (this.input) this.input.value = '';
    this.recall = null;
    if (this.picker) this.picker.hidden = true;
    this.setReply(null);
  }

  /** Reply to `message` (from `feed`) with the next one you send (null: don't). */
  setReply(message, feed) {
    this.replyTo = message && { id: message.id, name: message.user.name, login: message.user.login, body: message.text, root: message.replyRoot || message.id, feed };
    this.replyChip.hidden = !message;
    if (!message) return;
    this.setTarget(feed);
    // Who, in their colour, and the start of what they said (with its emotes).
    const color = readableColor(message.user.color, message.user.login || message.user.name);
    const head = el('span', 'reply-chip-head', 'Replying to ');
    const name = el('strong', '', `@${message.user.name}`);
    name.style.color = color;
    head.append(name);
    const node = this.lines.find((l) => l.message === message)?.node.querySelector('.body');
    const body = node ? node.cloneNode(true) : el('span', '', message.text);
    body.className = 'reply-chip-body';
    const text = el('div', 'reply-chip-text');
    text.append(head, body);
    this.replyChip.style.borderLeftColor = color;
    this.replyChip.replaceChildren(text, iconButton('x', 'Cancel the reply', () => this.setReply(null)));
    this.input.focus();
  }

  /** You can write in `feed`'s chat now: reply and mention go there. */
  canType(feed) {
    return Boolean(this.input) && this.ctx.canWrite(feed) && !feed.banned;
  }

  canReply(message, feed) {
    return this.canType(feed) && !message.own && message.kind === 'chat';
  }

  /** You can delete, time out and ban `message`'s sender: a moderator or the broadcaster there, and not yourself. */
  canModerate(message, feed) {
    return Boolean(feed.isMod && message.user?.id && !message.own && !this.ctx.isOwn(message.user, feed.platform));
  }

  /** @them in the message box, to `feed`'s chat. */
  mention(message, feed) {
    this.setTarget(feed);
    this.input.setRangeText(`@${mentionName(message.user)} `, this.input.selectionStart, this.input.selectionEnd, 'end');
    this.input.focus();
  }

  /**
   * The buttons on the message under the pointer: the menu's most used items
   * (mention, reply; delete and a timeout for mods) and ⋯ for the whole menu.
   */
  showActions({ node, message, feed }) {
    const mod = this.canModerate(message, feed) && this.modTools(feed, message.user);
    const more = iconButton('more', 'More', () => {
      const r = more.getBoundingClientRect();
      this.openMenu({ clientX: r.left, clientY: r.bottom + 4 }, message, feed, { more: true });
    });
    this.actions.replaceChildren(
      ...[
        mod && message.kind === 'chat' && iconButton('trash', 'Delete message', () => this.modRun(() => mod.remove(message.id), feed)),
        mod && iconButton('clock', 'Timeout 10 minutes', () => this.modRun(() => mod.timeout(600), feed)),
        this.canType(feed) && iconButton('at', 'Mention', () => this.mention(message, feed)),
        this.canReply(message, feed) && iconButton('reply', 'Reply', () => this.setReply(message, feed)),
        more,
      ].filter(Boolean),
    );
    this.actions.classList.toggle('mod', Boolean(mod));
    node.prepend(this.actions); // first: a notice's last-child spacing stays as it is
    // On the top line it sits inside the message, not cut off above it.
    this.actions.classList.toggle('inside', node.getBoundingClientRect().top - this.list.getBoundingClientRect().top < 14);
  }

  /** Right-click on a message, or (`more`) ⋯ on its buttons: then without what the buttons beside it already do. */
  openMenu(event, message, feed, { more = false } = {}) {
    const items = [
      !more && this.canReply(message, feed) && ['Reply', () => this.setReply(message, feed)],
      !more && this.canType(feed) && ['Mention', () => this.mention(message, feed)],
      message.text && ['Copy message', () => navigator.clipboard.writeText(message.text)],
      ['Copy name', () => navigator.clipboard.writeText(message.user.name)],
      ['User info', () => this.openCard(message.user, event, feed)],
      ['Open channel', () => window.open(feed.profileUrl(message.user), '_blank', 'noopener')],
      message.user.login && [this.isFriend(message.user) ? 'Remove from friends' : 'Add to friends', () => this.toggleFriend(message.user)],
      message.user.login && ['Hide messages from them', () => this.hideUser(message.user)],
      ...this.modItems(message, feed, { more }),
    ];
    showMenu(event.clientX, event.clientY, items.filter(Boolean));
  }

  /** Friends' messages stand out in every chat (Settings lists them). */
  toggleFriend(user) {
    const login = user.login.toLowerCase().replace(/^@/, '');
    const friends = this.ctx.settings.friends;
    saveSettings({ friends: friends.includes(login) ? friends.filter((f) => f !== login) : [...friends, login] });
  }

  /** Hide someone's messages from now on (Settings → Hidden lists them; it's reversible there). */
  hideUser(user) {
    const login = user.login.toLowerCase();
    if (!this.ctx.settings.hiddenUsers.includes(login)) saveSettings({ hiddenUsers: [...this.ctx.settings.hiddenUsers, login] });
  }

  /** Delete, timeout and ban, where you're a moderator or the broadcaster (Twitch or Kick). */
  modItems(message, feed, { more = false } = {}) {
    const user = message.user;
    if (!this.canModerate(message, feed)) return [];
    const mod = this.modTools(feed, user);
    return [
      '-',
      !more && message.kind === 'chat' && ['Delete message', () => this.modRun(() => mod.remove(message.id), feed)],
      !more && ['Timeout 10 minutes', () => this.modRun(() => mod.timeout(600), feed)],
      ['Timeout 1 hour', () => this.modRun(() => mod.timeout(3600), feed)],
      ['Ban…', () => confirm(`Ban ${user.name} from ${feed.label}'s chat?`) && this.modRun(() => mod.ban(), feed), null, 'danger'],
    ].filter(Boolean);
  }

  /** A mod action; what goes wrong is said in the chat. */
  modRun(task, feed) {
    task().catch((error) => this.system(error.message, feed));
  }

  /** Delete, timeout (seconds) and ban, through Twitch's or Kick's API. */
  modTools(feed, user) {
    if (feed.platform === 'kick') {
      const auth = this.ctx.kickAuth;
      return {
        remove: (id) => kickDeleteMessage(auth, id),
        timeout: (seconds) => kickBan(auth, feed.roomId, user.id, Math.min(10_080, Math.max(1, Math.ceil(seconds / 60)))), // Kick counts minutes, 1 to 7 days
        ban: () => kickBan(auth, feed.roomId, user.id),
      };
    }
    const auth = this.ctx.auth;
    return {
      remove: (id) => twitchDeleteMessage(auth, feed.roomId, id),
      timeout: (seconds) => twitchBan(auth, feed.roomId, user.id, seconds),
      ban: () => twitchBan(auth, feed.roomId, user.id),
    };
  }

  /**
   * Suggestions above the box while you type ":lul" (emotes you can use here)
   * or "@na" (people chatting here): ↑/↓ to choose, Tab or Enter to put one in,
   * Esc to close.
   */
  buildSuggest(input) {
    const box = el('div', 'suggest');
    box.setAttribute('role', 'listbox');
    box.hidden = true;
    let matches = []; // { insert, row }
    let active = 0;
    // ":word" or "@word" right before the caret.
    const typed = () => /(?:^|\s)(:(\w{2,})|@(\w*))$/.exec(input.value.slice(0, input.selectionStart));

    const emoteItem = ([name, emote]) => {
      const img = el('img');
      img.src = emote.url;
      img.alt = '';
      return { insert: name, row: [img, el('span', 'suggest-name', name), el('span', 'suggest-source', emoteSource(emote.url))] };
    };
    const nameItem = (user) => {
      const name = el('span', 'suggest-name', user.name);
      name.style.color = readableColor(user.color, user.login);
      return { insert: `@${mentionName(user)}`, row: [el('span', 'suggest-at', '@'), name] };
    };

    const render = () => {
      box.hidden = !matches.length;
      box.replaceChildren(
        ...matches.map((item, i) => {
          const row = el('div', 'suggest-row');
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(i === active));
          row.append(...item.row);
          row.addEventListener('mousedown', (e) => {
            e.preventDefault(); // keep the focus in the box
            accept(i);
          });
          return row;
        }),
      );
      box.children[active]?.scrollIntoView({ block: 'nearest' });
    };
    const close = () => {
      matches = [];
      render();
    };
    const accept = (i) => {
      const match = typed();
      if (!match) return close();
      input.setRangeText(`${matches[i].insert} `, input.selectionStart - match[1].length, input.selectionStart, 'end');
      close();
    };

    input.addEventListener('input', () => {
      const match = typed();
      if (match?.[2]) matches = this.findEmotes(match[2].toLowerCase()).map(emoteItem);
      else if (match) matches = this.findNames(match[3].toLowerCase()).map(nameItem);
      else matches = [];
      active = 0;
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (!matches.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        render();
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        accept(active);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    input.addEventListener('blur', close);
    return box;
  }

  /** Up to 8 emotes you can type in the channel you're sending to, whose name contains `query`. */
  findEmotes(query) {
    const favorites = new Set(this.ctx.settings.favoriteEmotes);
    const uses = (name) => this.ctx.emoteUse[name]?.n || 0;
    const rank = ([name]) => (favorites.has(name) ? 0 : name.toLowerCase().startsWith(query) ? 1 : 2);
    return [...this.target.typable]
      .filter(([name]) => name.toLowerCase().includes(query))
      .sort((a, b) => rank(a) - rank(b) || uses(b[0]) - uses(a[0]) || a[0].length - b[0].length || a[0].localeCompare(b[0]))
      .slice(0, 8);
  }

  /* ---- Messages ---- */

  /**
   * What a line folds by into "×2", or '': plain chat lines (not your own,
   * replies, cheers or notices) by their text; timeouts and bans by who and how long.
   */
  foldable(message) {
    if (isModeration(message)) return `${message.event.type} ${message.user.login} ${message.event.duration || ''}`;
    return message.kind === 'chat' && !message.event && !message.replyTo && !message.own ? foldKey(message.text) : '';
  }

  /**
   * Where `message` folds into, or null: { line, similar }. The same message (or timeout) here within a minute of
   * its last repeat; a chat message also into a line close by (the last 80) one letter apart (a typo), or, with
   * Settings → Fold similar messages, into one that mostly says the same within 30 seconds (similar: true). A chat
   * message folds across a merged chat's channels (a simulcast's "W" from Twitch, Kick and YouTube is one line); a
   * timeout only within its channel.
   */
  foldTarget(message, feed) {
    const key = this.ctx.settings.foldRepeats && this.foldable(message);
    if (!key) return null;
    const anyFeed = !isModeration(message);
    // Not into a deleted (struck-through) line: what's said again isn't deleted.
    const near = (line, ms) =>
      (anyFeed || line.feed === feed) && line.foldKey && !line.gone && !line.node.classList.contains('deleted') && Math.abs(message.time - line.lastTime) <= ms;
    const words = this.ctx.settings.foldSimilar && message.kind === 'chat' && foldWords(key);
    const counts = words && this.noteWords(words, message.time);
    const same = this.recent.get(this.recentKey(message, feed, key));
    if (same && near(same, 60_000)) return { line: same, similar: false };
    if (isModeration(message)) return null;
    // A wave's word is enough between short reactions (WAVE_SHORT: "you need the key", "THE KEY PEA").
    const said = words && this.heat.said.length; // messages here in the last 30 s
    const wave = words && words.size <= WAVE_SHORT ? [...words].filter((word) => counts.get(word) >= Math.max(WAVE_WORD, said * WAVE_SHARE)) : [];
    const alike = (other) => similarWords(words, other) || (other.size <= WAVE_SHORT && wave.some((word) => other.has(word)));
    let similar = null;
    for (let i = this.lines.length - 1; i >= Math.max(0, this.lines.length - 80); i--) {
      const line = this.lines[i];
      if (line.message.kind !== 'chat' || !near(line, 60_000)) continue;
      if (nearlySame(key, line.foldKey)) return { line, similar: false };
      similar ??= words && near(line, 30_000) && line.wordSets.some(alike) ? line : null;
    }
    if (!similar) return null;
    // By a wave's word: the short lines with it close by fold in too (those from before it was one).
    const by = wave.find((word) => similar.wordSets.some((other) => other.size <= WAVE_SHORT && other.has(word)));
    return { line: similar, similar: true, wave: by || null };
  }

  /** Fold similar messages: count `words` (a message here at `time`), and how many of the last 30 s used each word. */
  noteWords(words, time) {
    const { heat } = this;
    while (heat.said.length && heat.said[0].time < time - 30_000) {
      for (const word of heat.said.shift().words) {
        const left = heat.counts.get(word) - 1;
        if (left) heat.counts.set(word, left);
        else heat.counts.delete(word);
      }
    }
    heat.said.push({ time, words });
    for (const word of words) heat.counts.set(word, (heat.counts.get(word) || 0) + 1);
    return heat.counts;
  }

  /** Where `recent` keeps a fold key: per chat for chat messages, per channel for timeouts and bans. */
  recentKey(message, feed, key) {
    return `${isModeration(message) ? feed.key : 'chat'} ${key}`;
  }

  /** Remember `line` for its repeats to fold into (under `key`, its own fold key unless it's a variant's). */
  noteFoldable(line, key = this.ctx.settings.foldRepeats && this.foldable(line.message)) {
    if (!key) return;
    line.foldKey ??= key;
    if (line.message.kind === 'chat') (line.wordSets ??= []).push(foldWords(key)); // what "similar" compares with
    this.recent.set(this.recentKey(line.message, line.feed, key), line);
    if (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value);
  }

  /**
   * Count `message` on `line` ("×12", or "×9 similar"; a short pop as it grows when `live`), with who sent what
   * (its tooltip: the senders, or each version of a similar one and who sent it).
   */
  foldInto(line, message, live, similar) {
    line.count = (line.count || 1) + 1;
    line.lastTime = Math.max(line.lastTime, message.time);
    line.similar ||= similar;
    (line.folded ??= []).push(message.id); // forgotten with the line (trim)
    line.senders ??= new Map(line.message.user?.name ? [[senderKey(sender(line.message)), sender(line.message)]] : []);
    if (message.user?.name) line.senders.set(senderKey(sender(message)), sender(message));
    if (line.message.kind === 'chat') {
      line.variants ??= new Map([[line.foldKey, versionOf(line.message)]]);
      const key = this.foldable(message);
      const variant = line.variants.get(key) || [...line.variants].find(([other]) => nearlySame(key, other))?.[1]; // a typo of one
      if (variant) {
        variant.senders.push(sender(message));
        // A similar group shows each version in its plainest wording ("the key", not "the key!!!!!!!!"); a repeat keeps its first sender.
        if (line.similar && noise(message.text) < noise(variant.text)) Object.assign(variant, { text: message.text, message });
      } else {
        line.variants.set(key, versionOf(message));
        if (line.wordSets.length < 8) this.noteFoldable(line, key); // its exact repeats fold here at once, and it's compared with too
      }
    }
    this.showFold(line, live);
  }

  /**
   * A wave's word took off: the short lines with it from the last 30 s (on their own so far) fold into `line`.
   * Not while the chat is held (nothing goes from under you).
   */
  gather(line, word) {
    if (this.hovering) return;
    for (const other of this.lines.slice(-80)) {
      if (other === line || other.gone || other.message.kind !== 'chat' || !other.foldKey) continue;
      if (other.node.classList.contains('deleted')) continue; // stays struck through, on its own
      if (Math.abs(other.lastTime - line.lastTime) > 30_000 || !other.wordSets.some((set) => set.size <= WAVE_SHORT && set.has(word))) continue;
      const versions = other.variants || new Map([[other.foldKey, versionOf(other.message)]]);
      for (const [key, version] of versions) {
        const mine = line.variants.get(key);
        if (mine) mine.senders.push(...version.senders);
        else line.variants.set(key, version);
        this.recent.set(this.recentKey(line.message, line.feed, key), line);
      }
      line.count = (line.count || 1) + (other.count || 1);
      line.folded = [...(line.folded || []), other.message.id, ...(other.folded || [])];
      for (const who of other.senders?.values() || [sender(other.message)]) if (who.user?.name) line.senders.set(senderKey(who), who);
      if (line.wordSets.length < 8) line.wordSets.push(...other.wordSets.slice(0, 8 - line.wordSets.length));
      other.gone = true;
      other.node.remove();
      this.lines.splice(this.lines.indexOf(other), 1);
    }
    this.showFold(line, false);
  }

  /** "×N" (or "×N similar") on `line`, louder as it grows, a pop when `live`; and its most-sent version as its face. */
  showFold(line, live) {
    // The line shows its most-sent version, as its first sender sent it (not while it's held: nothing changes under you).
    if (line.variants && !this.hovering) {
      const versions = [...line.variants.values()];
      const top = versions.reduce((a, b) => (b.senders.length > a.senders.length ? b : a));
      const face = versions.find((v) => v.message === line.message);
      if (top !== face && top.senders.length > (face?.senders.length || 0)) {
        line.message = top.message;
        this.redrawLine(line);
      }
    }
    let badge = line.node.querySelector('.fold-count');
    if (!badge) badge = (line.node.querySelector('.notice-head') || line.node).appendChild(el('span', 'fold-count'));
    badge.textContent = line.similar ? `×${line.count} similar` : `×${line.count}`;
    badge.dataset.level = foldLevel(line.count);
    badge.classList.toggle('similar', line.similar);
    if (live && !reducedMotion.matches) badge.animate([{ transform: 'scale(1.35)' }, { transform: 'none' }], { duration: 250, easing: 'ease-out' });
    if (this.tipTarget === badge) this.showFoldTip(badge); // its tooltip is open: keep it up to date
  }

  /**
   * The same message again within a minute (copypasta): count it on the line
   * that's already there ("×12") and move that line to the bottom. True if folded.
   */
  fold(message, feed, fragment) {
    const { line, similar, wave } = this.foldTarget(message, feed) || {};
    if (!line) return false;
    this.foldInto(line, message, true, similar);
    if (wave) this.gather(line, wave);
    line.node.classList.remove('history'); // said again just now
    if (this.hovering) return true; // held: the count goes up where it is (it could be what you're pointing at)
    if (this.actions.parentNode === line.node) this.actions.remove(); // it moves away from under the pointer
    this.lines.splice(this.lines.indexOf(line), 1);
    this.lines.push(line);
    fragment.append(line.node); // moves it
    return true;
  }

  /** Put `line` among the others by time (its last repeat's), or move it there. */
  place(line) {
    const at = this.lines.indexOf(line);
    if (at >= 0) this.lines.splice(at, 1);
    const i = this.lines.findIndex((l) => (l.lastTime ?? l.message.time) > line.lastTime);
    if (i < 0) {
      this.lines.push(line);
      this.list.append(line.node);
    } else {
      this.lines[i].node.before(line.node);
      this.lines.splice(i, 0, line);
    }
  }

  /** Someone mentioned you (or a highlight word): into the mentions inbox. */
  noteMention(message, feed) {
    const mine = message.own || this.ctx.isOwn(message.user, message.platform);
    // Not one you hid (by its sender or its words): hidden means you don't see it, also there.
    if (mine || message.kind !== 'chat' || !this.ctx.isHighlight(message.text || '') || this.ctx.isHidden(message)) return;
    addMention({
      id: message.id,
      source: feed.source,
      label: feed.label,
      user: { name: message.user.name, login: message.user.login, color: message.user.color },
      text: message.text,
      time: message.time,
    });
  }

  /** Remember who chats here, most recent last (for @ suggestions and Tab). */
  noteChatter(message, feed) {
    const { user } = message;
    if (!user?.login || message.own || isModeration(message)) return;
    feed.chatters.delete(user.login);
    feed.chatters.set(user.login, user);
    if (feed.chatters.size > 500) feed.chatters.delete(feed.chatters.keys().next().value);
  }

  add(message, feed) {
    if (this.seen.has(message.id)) return; // YouTube sends its backlog twice
    this.seen.add(message.id);
    this.noteChatter(message, feed);
    this.queue.push({ message, feed });
    // Bursts (YouTube delivers several seconds at once) render in one frame.
    this.frame ??= requestAnimationFrame(() => this.flush());
  }

  flush() {
    this.frame = null;
    const fragment = document.createDocumentFragment();
    const added = this.queue.splice(0);
    for (const { message, feed } of added) {
      if (this.awaySince) {
        this.list.querySelector('.unread-line')?.remove();
        fragment.append(el('div', 'unread-line', 'New since you left'));
        this.awaySince = false;
      }
      if (this.fold(message, feed, fragment)) continue;
      this.noteMention(message, feed); // once: a folded repeat isn't another mention
      const node = this.renderMessage(message, feed);
      const line = { message, node, feed, lastTime: message.time };
      this.lines.push(line);
      fragment.append(node);
      this.noteFoldable(line);
    }
    this.list.append(fragment);
    this.trim();
    this.applyFilter(this.lines.slice(-added.length)); // new and folded lines are the last ones
    // Scrolled up to read, or held still under the pointer: stay put and count what arrived below.
    if (this.atBottom && !this.hovering) this.scrollToEnd();
    else this.setUnseen(this.unseen + added.length);
  }

  /**
   * Earlier messages (recent messages when the chat opens: greyed a little; or those missed while the connection
   * was down: new, so their mentions count) placed by time among what's arrived live since.
   */
  addHistory(messages, feed, { greyed = true } = {}) {
    const fresh = messages.filter((m) => !this.seen.has(m.id));
    if (!fresh.length) return;
    for (const m of fresh) {
      this.seen.add(m.id);
      this.noteChatter(m, feed);
      // Copypasta among them folds too (a later repeat moves its line to that time), also into a line already here.
      const { line: into, similar, wave } = this.foldTarget(m, feed) || {};
      if (into) {
        this.foldInto(into, m, false, similar);
        if (wave) this.gather(into, wave);
        if (into.lastTime === m.time) this.place(into);
        continue;
      }
      const node = this.renderMessage(m, feed);
      if (greyed) node.classList.add('history');
      else this.noteMention(m, feed);
      const line = { message: m, node, feed, lastTime: m.time };
      this.place(line);
      this.noteFoldable(line);
    }
    this.trim();
    this.applyFilter();
    if (this.atBottom && !this.hovering) this.scrollToEnd();
  }

  /** Drop the oldest lines over MAX_LINES; while it's held or you read back, only over twice that (nothing moves under you). */
  trim() {
    const max = this.hovering || !this.atBottom ? MAX_LINES * 2 : MAX_LINES;
    while (this.lines.length > max) {
      const line = this.lines.shift();
      line.node.remove();
      line.gone = true; // not to fold into any more
      this.seen.delete(line.message.id);
      for (const id of line.folded || []) this.seen.delete(id);
    }
  }

  /** Draw every line again (after going between one feed and several, or a theme change). */
  rerender() {
    this.redrawUser(() => true);
    this.applyFilter();
  }

  /** Where a line came from, in a merged chat: platform (when they're mixed) and channel picture. */
  renderSource(feed) {
    const pic = this.sourcePicture(feed, 'msg-source', this.mixed);
    pic.dataset.tip = feed.label;
    pic.dataset.tipSource = `${PLATFORM_NAMES[feed.platform]} channel`;
    return pic;
  }

  /** A name that opens the person's user card, in their colour. */
  nameButton(user, feed, text = user.name) {
    const name = el('button', 'name', text);
    name.type = 'button';
    name.style.color = readableColor(user.color, user.login || user.name);
    name.addEventListener('click', (e) => this.openCard(user, e, feed));
    return name;
  }

  renderMessage(m, feed) {
    const line = el('div', 'msg');
    const text = m.text || '';
    const mine = this.ctx.isOwn(m.user, m.platform);
    if (m.kind === 'notice' || m.event) line.classList.add('notice');
    if (m.action) line.classList.add('action');
    if (m.first) line.classList.add('first');
    if (!mine && this.ctx.isHighlight(text)) line.classList.add('hl');
    if (m.user.id) line.dataset.uid = m.user.id; // to redraw it when their 7TV paint or badge arrives
    const friend = this.isFriend(m.user);
    if (friend) line.classList.add('friend');

    const notice = m.event && this.renderNotice(m, line, feed);
    if (notice) line.append(notice);
    else if (m.system) line.append(el('div', 'system-line', m.system));
    if (m.first) {
      const first = el('div', 'first-line');
      first.append(icon('sparkles'), 'First message');
      line.append(first);
    }
    if (m.replyTo) {
      line.classList.add('reply');
      line.append(this.renderReply(m, feed));
    }
    if (m.kind === 'notice' && !text) return line;

    if (this.ctx.settings.timestamps) line.append(el('span', 'ts', formatClock(m.time)));
    if (this.merged) line.append(this.renderSource(feed));
    // A sub, Super Chat or cheer with a message: its headline names them already, so the message comes without
    // the name (an announcement's headline doesn't, so it keeps it).
    const named = notice && m.event.type !== 'announcement';
    if (!named) {
      const cosmetics = m.platform === 'twitch' && this.ctx.settings.cosmetics ? this.ctx.cosmetics : null;
      // Twitch's badges, then 7TV / BTTV / FFZ ones (Settings → Cosmetics).
      const extra = cosmetics?.badgesFor(m.user.id) || [];
      if (this.ctx.settings.badges && (m.user.badges.length || extra.length)) line.append(this.renderBadges(m.user.badges, feed, extra));
      if (friend) line.append(icon('star', 'icon friend-star'));

      const name = this.nameButton(m.user, feed);
      // A 7TV name paint: a gradient or image clipped to the letters (the colour stays as a fallback).
      const paint = cosmetics?.paintFor(m.user.id);
      if (paint) {
        name.classList.add('painted');
        name.style.backgroundImage = paint.backgroundImage;
        name.style.filter = paint.filter;
      }
      line.append(name, el('span', 'sep', m.action ? ' ' : ': '));
    }

    const body = el('span', 'body');
    // Your own messages come with no Twitch emote positions (Twitch doesn't echo
    // them back), so your Twitch emotes are matched by name like the others.
    const byName = m.own ? feed.typable : feed.emotes;
    let parts = m.nativeEmotes ? twitchParts(text, m.nativeEmotes, byName, m.platform === 'kick' ? kickEmoteUrl : twitchEmoteUrl) : m.parts || [];
    if (m.event?.type === 'cheer') parts = cheerParts(parts, feed.cheermotes);
    // Twitch starts a reply with "@name": the line above says it already.
    if (m.replyTo && parts[0]?.type === 'mention' && parts[0].text.toLowerCase() === `@${m.replyTo}`.toLowerCase()) {
      parts.shift();
      if (parts[0]?.type === 'text') parts[0] = { ...parts[0], text: parts[0].text.trimStart() };
    }
    this.renderParts(body, parts);
    line.append(body);
    return line;
  }

  /**
   * The headline of a sub, gift, raid, announcement, Super Chat or membership:
   * an icon, who did what, and the details as pills. Sets the line's accent.
   * Null for notices it doesn't know (their system text is shown instead).
   */
  renderNotice(m, line, feed) {
    const e = m.event;
    const style = NOTICE_STYLE[e.type];
    if (!style) return null;
    const strong = (text) => el('strong', '', text);
    // Names open their user card, as in a chat line.
    const person = (user, text) => this.nameButton(user, feed, text);
    const who = person(m.user);
    const title = [];
    const pills = [];
    switch (e.type) {
      case 'sub':
        title.push(who, e.plan === 'Prime' ? ' subscribed with Prime' : ' subscribed');
        if (e.plan !== 'Prime') pills.push(e.plan);
        break;
      case 'resub':
        title.push(who, ' resubscribed');
        pills.push(e.plan, e.months && `${e.months} months`, e.streak && `🔥 ${e.streak}-month streak`);
        break;
      case 'gift':
        title.push(who, ' gifted a sub to ', e.recipientLogin ? person({ id: e.recipientId || '', login: e.recipientLogin, name: e.recipient, color: '', badges: [] }) : strong(e.recipient));
        pills.push(e.plan);
        break;
      case 'gifts':
        title.push(who, ` is gifting ${e.count} sub${e.count === 1 ? '' : 's'}`);
        pills.push(e.plan, e.total > e.count && `${e.total.toLocaleString()} gifted in total`);
        break;
      case 'upgrade':
        title.push(who, ' continued their sub');
        pills.push(e.plan);
        break;
      case 'raid':
        title.push(person(m.user, e.raider || m.user.name), ' is raiding');
        pills.push(`${formatCount(e.viewers)} viewer${e.viewers === 1 ? '' : 's'}`);
        break;
      case 'announcement':
        title.push(strong('Announcement'));
        break;
      case 'streak':
        title.push(who, ' is on a watch streak');
        pills.push(`${e.streams} streams`);
        break;
      case 'superchat':
        title.push(who, ' sent a Super Chat');
        pills.push(e.amount);
        break;
      case 'member':
        title.push(who);
        pills.push(e.text);
        break;
      case 'timeout':
        title.push(who, ' was timed out');
        pills.push(formatDuration(e.duration));
        break;
      case 'ban':
        title.push(who, ' was banned');
        break;
      case 'kicks':
        title.push(who, ' sent KICKs');
        pills.push(kicks(e.amount), e.gift);
        break;
      case 'cheer':
        title.push(who, ` cheered ${e.bits.toLocaleString()} bit${e.bits === 1 ? '' : 's'}`);
        break;
    }
    const color =
      (e.type === 'announcement' && ANNOUNCEMENT_COLORS[e.color]) ||
      (e.type === 'superchat' && e.color) ||
      (e.type === 'cheer' && cheerColor(e.bits)) ||
      style[1];
    line.style.setProperty('--notice', color);
    line.dataset.event = e.type;
    const badge = el('span', 'notice-icon');
    badge.append(icon(style[0]));
    const head = el('div', 'notice-head');
    const text = el('span', 'notice-title');
    text.append(...title);
    head.append(badge, text, ...pills.filter(Boolean).map((p) => el('span', 'notice-pill', p)));
    return head;
  }

  /** Above a reply: who and what it answers. Hover for all of it; click to go to it, if it's still here. */
  renderReply(m, feed) {
    const reply = el('div', 'reply-line');
    reply.dataset.parent = m.replyId;
    const parent = this.lines.find((l) => l.message.id === m.replyId);
    const to = el('span', 'reply-to', `@${m.replyTo}`);
    to.style.color = this.repliedColor(m, feed);
    reply.append(to);
    // What they said, with its emotes: as its line shows it, or from the quote that came with the reply.
    let body = parent?.node.querySelector('.body')?.cloneNode(true);
    if (!body && m.replyBody) {
      body = el('span');
      this.renderParts(body, twitchParts(m.replyBody, [], feed.emotes, twitchEmoteUrl));
    }
    if (body) {
      body.className = 'reply-body';
      reply.append(body);
    }
    reply.addEventListener('click', (e) => this.showThread(m, feed, e));
    return reply;
  }

  /** The colour of whom reply `m` answers: from their message, or (gone from the chat) from their chatting here lately; '' unknown. */
  repliedColor(m, feed) {
    const who = this.lines.find((l) => l.message.id === m.replyId)?.message.user || feed.chatters.get(m.replyLogin) || [...feed.chatters.values()].find((u) => u.name === m.replyTo);
    return who ? readableColor(who.color, who.login || who.name) : '';
  }

  /** The message `reply` (a reply's line above it) answers glows while you point at it, if it's on screen; null: none. */
  markReplied(reply) {
    this.replied?.classList.remove('replied');
    this.replied = reply && this.lines.find((l) => l.message.id === reply.dataset.parent)?.node;
    this.replied?.classList.add('replied');
  }

  /**
   * The conversation a reply belongs to, in a panel: the message it started with (or its quote, gone from the chat)
   * and every reply in the chat to it or to one of them, in order, the one you clicked marked. Click one: go to it.
   */
  showThread(m, feed, event) {
    hideTip();
    const { root, lines } = this.conversation(m, feed);
    const items = lines.map((line) => {
      const node = this.renderMessage(line.message, line.feed);
      node.querySelector('.reply-line')?.remove(); // in here, what it answers is right above
      if (!node.querySelector('.ts')) node.prepend(el('span', 'ts', formatClock(line.message.time)));
      node.classList.add('thread-msg');
      node.classList.toggle('current', line.message === m);
      node.classList.toggle('deleted', line.node.classList.contains('deleted'));
      node.title = 'Go to this message';
      node.addEventListener('click', (e) => {
        if (e.target.closest('.name, a')) return; // a name opens its card, a link opens
        this.thread.hidden = true;
        this.jumpTo(line);
      });
      return node;
    });
    // The first message gone from the chat: its quote, from the first reply to it.
    if (!lines.some((l) => l.message.id === root)) {
      const first = lines.find((l) => l.message.replyId === root)?.message || m;
      const gone = el('div', 'msg thread-msg thread-gone');
      gone.append(el('strong', '', `@${first.replyTo}: `), first.replyBody || '…', el('span', 'thread-note', ' (no longer in the chat)'));
      items.unshift(gone);
    }
    const head = el('div', 'thread-head');
    head.append(el('strong', '', 'Conversation'), el('span', 'thread-count', `${items.length} message${items.length === 1 ? '' : 's'}`), iconButton('x', 'Close', () => (this.thread.hidden = true)));
    const list = el('div', 'thread-list');
    list.append(...items);
    this.thread.replaceChildren(head, list);
    this.thread.hidden = false;
    this.placeNear(this.thread, { x: event.clientX, y: event.clientY });
    list.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * The conversation reply `m` is in: { root (the id of the message it started with), lines (those in the chat, in
   * order) }. Twitch says which conversation a reply is in (replyRoot); Kick doesn't, so it's followed reply by reply.
   */
  conversation(m, feed) {
    let root = m.replyRoot;
    if (!root) {
      root = m.replyId;
      for (let up = this.lines.find((l) => l.message.id === root); up?.message.replyId; up = this.lines.find((l) => l.message.id === root)) root = up.message.replyId;
    }
    const ids = new Set([root]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const { message } of this.lines) {
        if (ids.has(message.id) || !(ids.has(message.replyRoot) || ids.has(message.replyId))) continue;
        ids.add(message.id);
        grew = true;
      }
    }
    return { root, lines: this.lines.filter((l) => l.feed === feed && ids.has(l.message.id)).sort((a, b) => a.message.time - b.message.time) };
  }

  /** Put `node` (the user card, a conversation) just below and a little left of `anchor` ({ x, y }), inside the pane. */
  placeNear(node, anchor) {
    const box = this.root.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(anchor.x - box.left - 24, box.width - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(anchor.y - box.top + 8, box.height - node.offsetHeight - 8))}px`;
  }

  /**
   * Over a reply's quote, a preview of its conversation: the message it started with (or its quote, gone from the
   * chat) and the two replies up to the one you point at, marked; "+N more", and that a click shows it all.
   */
  showReplyTip(target) {
    const line = this.lines.find((l) => l.node.contains(target));
    if (!line) return;
    const m = line.message;
    const { root, lines } = this.conversation(m, line.feed);
    const row = (name, color, body, current) => {
      const text = el('p', current ? 'tip-reply current' : 'tip-reply');
      const who = el('strong', '', `${name}: `);
      who.style.color = color;
      text.append(who, body);
      return text;
    };
    const lineRow = (l) => row(l.message.user.name, readableColor(l.message.user.color, l.message.user.login || l.message.user.name), l.node.querySelector('.body')?.cloneNode(true) || el('span', '', l.message.text), l === line);
    const first = lines.find((l) => l.message.id === root);
    // The first message: its line, or the quote the first reply to it came with.
    const quoted = lines.find((l) => l.message.replyId === root)?.message || m;
    const rows = [first ? lineRow(first) : row(quoted.replyTo, this.repliedColor(quoted, line.feed), el('span', '', quoted.replyBody || '…'), false)];
    const replies = lines.filter((l) => l !== first);
    const shown = replies.slice(0, replies.indexOf(line) + 1).slice(-2);
    rows.push(...shown.map(lineRow));
    const more = replies.length - shown.length;
    const hint = el('span', 'tip-source', `${more > 0 ? `+${more} more · ` : ''}Click for the conversation`);
    placeTip(target, 'reply', [el('span', 'tip-source', 'Conversation'), ...rows, hint]);
  }

  /** Over a name or a timestamp: when exactly the message was sent. */
  showTimeTip(target) {
    const line = this.lines.find((l) => l.node.contains(target));
    if (!line?.message.time) return;
    placeTip(target, 'time', [el('strong', '', formatFullTime(line.message.time)), el('span', 'tip-source', formatAgo(line.message.time))]);
  }

  /** A YouTube video or Twitch clip link: its thumbnail, title and channel. */
  async showLinkTip(link) {
    const preview = await linkPreview(link.href);
    if (!preview || this.tipTarget !== link) return; // nothing to show, or the pointer moved on
    const text = el('div', 'tip-link');
    text.append(el('strong', '', preview.title), el('span', 'tip-source', [preview.by, preview.meta].filter(Boolean).join(' · ')));
    if (!preview.thumbnail) return placeTip(link, 'link', [text]); // none (a video of a stream still going)
    const thumb = el('img', preview.round ? 'tip-thumb round' : 'tip-thumb'); // round: a channel's picture
    thumb.alt = '';
    thumb.addEventListener('error', () => thumb.remove()); // a picture that won't load: the text alone
    thumb.src = preview.thumbnail;
    placeTip(link, 'link', [thumb, text]);
  }

  /** Scroll to a line and flash it. */
  jumpTo(line) {
    hideTip();
    this.atBottom = false; // reading back now: don't let the chat pull down mid-scroll
    line.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    line.node.classList.remove('flash');
    void line.node.offsetWidth; // restart the animation
    line.node.classList.add('flash');
  }

  renderParts(body, parts) {
    let lastEmote = null;
    for (const part of parts) {
      if (part.type === 'cheer') {
        // The cheermote for that amount, then the amount in its tier colour.
        const stack = el('span', 'emote-stack');
        const img = el('img', 'emote');
        img.src = cheermoteUrl(part.cheermote, part.amount);
        img.alt = part.name;
        stack.append(img);
        const amount = el('span', 'cheer-amount', String(part.amount));
        amount.style.color = cheerColor(part.amount);
        body.append(stack, amount);
        lastEmote = null;
        continue;
      }
      if (part.type === 'emote') {
        const img = el('img', 'emote');
        img.src = part.url;
        img.alt = part.name;
        img.loading = 'lazy';
        if (part.zeroWidth && lastEmote) {
          // 7TV/FFZ zero-width emotes are drawn on top of the previous one.
          img.classList.add('zero-width');
          lastEmote.append(img);
          continue;
        }
        const stack = el('span', 'emote-stack');
        stack.append(img);
        body.append(stack);
        lastEmote = stack;
        continue;
      }
      if (part.type === 'text' && /^\s*$/.test(part.text)) {
        body.append(part.text);
        continue;
      }
      lastEmote = null;
      if (part.type === 'link') {
        const a = el('a', 'link', part.text);
        a.href = part.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        body.append(a);
      } else if (part.type === 'mention') {
        body.append(el('span', 'mention', part.text));
      } else {
        body.append(part.text);
      }
    }
  }

  /** Twitch's badges (images, or letters without a sign-in), then `extra` ones ({ url, title, source }: 7TV, BTTV, FFZ). */
  renderBadges(badges, feed, extra = []) {
    const wrap = el('span', 'badges');
    for (const badge of badges) {
      const key = badge.set ? `${badge.set}/${badge.version}` : '';
      const image = feed.badgeImages.get(key) || (badge.url ? { url: badge.url, title: badge.title } : null);
      if (image) {
        const img = el('img', 'badge');
        img.src = image.url;
        img.alt = image.title;
        img.dataset.tip = image.title;
        wrap.append(img);
        continue;
      }
      const pill = BADGE_PILLS[badge.set || badge.type];
      if (!pill) continue;
      const span = el('span', 'badge-pill', pill[0]);
      span.dataset.kind = badge.set || badge.type;
      span.dataset.tip = pill[1];
      span.setAttribute('role', 'img'); // read as "Moderator", not "M"
      span.setAttribute('aria-label', pill[1]);
      wrap.append(span);
    }
    for (const badge of extra) {
      const img = el('img', 'badge');
      img.src = badge.url;
      img.alt = badge.title;
      img.dataset.tip = badge.title;
      img.dataset.tipSource = badge.source;
      if (badge.color) img.style.background = badge.color; // FFZ badges are drawn on a colour
      wrap.append(img);
    }
    return wrap;
  }

  isFriend(user) {
    return Boolean(user?.login && this.ctx.friends.has(user.login.toLowerCase().replace(/^@/, '')));
  }

  /** Draw someone's lines again (their 7TV paint or badge arrived, or they became a friend). */
  redrawUser(match) {
    for (const line of this.lines) if (line.message.user?.name && match(line.message.user)) this.redrawLine(line);
  }

  /** Draw a line again (its message changed, or how it's shown), keeping its state and its "×N". */
  redrawLine(line) {
    const node = this.renderMessage(line.message, line.feed);
    for (const keep of ['deleted', 'history', 'flash']) node.classList.toggle(keep, line.node.classList.contains(keep));
    const fold = line.node.querySelector('.fold-count');
    if (fold) (node.querySelector('.notice-head') || node).append(fold);
    node.hidden = line.node.hidden;
    if (this.actions.parentNode === line.node) this.actions.remove();
    line.node.replaceWith(node);
    line.node = node;
  }

  /** A grey line from the app or the chat service (`feed`: which channel, in a merged chat). */
  system(text, feed = null) {
    if (!text) return;
    const line = el('div', 'msg system');
    line.append(el('span', 'system-line', feed && this.merged ? `${feed.label}: ${text}` : text));
    this.lines.push({ message: { id: crypto.randomUUID(), user: {}, text }, node: line, feed });
    this.list.append(line);
    this.trim();
    if (this.atBottom && !this.hovering) this.scrollToEnd();
  }

  /**
   * Over "×12": how many times, and who sent it (the first eight, in their colours). Over "×9 similar": each
   * version (the first six, most sent first) and who sent it.
   */
  showFoldTip(target) {
    const line = this.lines.find((l) => l.node.contains(target));
    if (!line) return;
    // Who: each once, in their colour; with their platform's tile in a chat merging platforms.
    const names = (senders, max) => {
      const unique = [...new Map(senders.map((who) => [senderKey(who), who])).values()];
      const row = el('div', 'tip-names');
      unique.slice(0, max).forEach(({ user, platform }, i) => {
        const name = el('span', 'tip-name', user.name);
        name.style.color = readableColor(user.color, user.login || user.name);
        if (this.mixed) name.prepend(platformTile(platform));
        row.append(...(i ? [', ', name] : [name]));
      });
      const more = unique.length - max;
      if (more > 0) row.append(el('span', 'tip-source', ` and ${more} other${more === 1 ? '' : 's'}`));
      return row;
    };
    if (line.similar) {
      const variants = [...line.variants.values()].sort((a, b) => b.senders.length - a.senders.length);
      // "213 messages · 7 versions": one said 207 times reads as that, not as 213 different ones.
      const nodes = [el('strong', '', `${line.count} messages · ${variants.length} version${variants.length === 1 ? '' : 's'}`)];
      for (const { text, senders } of variants.slice(0, 6)) {
        const item = el('div', 'tip-variant');
        item.append(el('span', 'tip-variant-text', senders.length > 1 ? `${text} ×${senders.length}` : text), names(senders, 3));
        nodes.push(item);
      }
      if (variants.length > 6) nodes.push(el('span', 'tip-source', `and ${variants.length - 6} more`));
      return placeTip(target, 'fold', nodes);
    }
    const senders = [...(line.senders?.values() || [])];
    const nodes = [el('strong', '', line.message.kind === 'chat' ? `Sent ${line.count} times` : `${line.count} times`)];
    if (line.message.kind === 'chat' && senders.length) nodes.push(names(senders, 8));
    placeTip(target, 'fold', nodes);
  }


  /** Strike through the lines `match(message, feed)` picks. */
  markDeleted(match) {
    // Messages still waiting for the next frame first: spam deleted or its sender banned the moment it's sent.
    if (this.queue.length) {
      cancelAnimationFrame(this.frame);
      this.flush();
    }
    for (const { message, node, feed } of this.lines) if (message.user && !isModeration(message) && match(message, feed)) node.classList.add('deleted');
    if (this.actions.parentNode?.classList.contains('deleted')) this.actions.remove(); // deleted while you point at it
  }

  /** Ctrl/⌘+F: show the filter box and put the cursor in it. */
  openFilter() {
    if (this.filterRow.hidden) this.toggleRow(this.filterRow, this.filterInput);
    else this.filterInput.focus();
  }

  /** Alt+←/→ in the chat window: the cursor into this chat (its message box, else the chat itself). */
  focus() {
    if (this.input) return this.input.focus();
    this.list.tabIndex = -1;
    this.list.focus();
  }

  /** A 7TV paint or badge arrived for someone: redraw their lines. */
  watchCosmetics() {
    if (!this.ctx.cosmetics || this.watchingCosmetics) return;
    this.watchingCosmetics = true;
    this.ctx.cosmetics.addEventListener('change', this.onCosmetics);
  }

  /**
   * You looked away (another tab, the window hidden, the panel showing another
   * chat): the first message after this gets a "New since you left" line.
   */
  markAway() {
    if (!this.lines.length) return;
    this.awaySince = true;
  }

  /** Something holds the chat still: new messages wait below (counted on the "new messages" button). */
  get hovering() {
    return this.holds.size > 0;
  }

  /**
   * Hold the chat still for `reason`, or stop (`after` ms later: a pointer leaving a name gets a moment). Reasons:
   * 'pointer' (over a name, link, reply… HOLD_TARGETS), 'moving' (Settings → anywhere), 'finger' (touch),
   * 'selection' (selecting text). Once nothing holds it, it catches up (see resume).
   */
  hold(on, reason, after = 0) {
    clearTimeout(this.holdTimers.get(reason));
    if (on) return void this.holds.add(reason);
    if (!this.holds.has(reason)) return;
    if (after) return void this.holdTimers.set(reason, setTimeout(() => this.hold(false, reason), after));
    this.holds.delete(reason);
    if (!this.hovering) this.resume();
  }

  /** Stop holding for these reasons at once (no catching up: the caller does). */
  letGo(reasons) {
    for (const reason of reasons) {
      clearTimeout(this.holdTimers.get(reason));
      this.holds.delete(reason);
    }
  }

  /** Nothing holds the chat any more: the old lines kept meanwhile go, and if you were following, it's at the newest again. */
  resume() {
    this.trim();
    if (this.atBottom) this.scrollToEnd();
  }

  scrollToEnd() {
    this.list.scrollTop = this.list.scrollHeight;
    this.atBottom = true;
    this.setUnseen(0);
  }

  setUnseen(n) {
    this.unseen = n;
    this.more.hidden = n === 0;
    this.more.replaceChildren(icon('arrow-down'), el('span', 'count', n > 99 ? '99+' : String(n)), ` new message${n === 1 ? '' : 's'}`);
  }

  /* ---- Filter ---- */

  /** Hide lines from people or bots you hid, !commands (settings), and what the filter box leaves out. */
  applyFilter(lines = this.lines) {
    const term = this.filterInput.value.trim().toLowerCase();
    for (const { message, node } of lines) {
      node.hidden =
        this.ctx.isHidden(message) ||
        (Boolean(term) && !`${message.user?.name || ''} ${message.text || ''}`.toLowerCase().includes(term));
    }
  }

  /* ---- User card (lib/card.js) ---- */

  openCard(user, event, feed) {
    hideTip(); // a tap's tooltip (touch screens) would sit on the card
    openUserCard(this, user, event, feed);
  }

  close() {
    for (const feed of this.feeds) feed.stop();
    panes.delete(this);
    this.ctx.cosmetics?.removeEventListener('change', this.onCosmetics);
    this.cardResize?.disconnect();
    this.ctx.removeEventListener('reload', this.onReload);
    clearInterval(this.cooldownTimer);
    this.removeSuggest();
    document.removeEventListener('pointerdown', this.onOutside);
    document.removeEventListener('keydown', this.onOutside);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointercancel', this.onPointerUp);
    document.removeEventListener('selectionchange', this.onSelection);
    for (const timer of this.holdTimers.values()) clearTimeout(timer);
    cancelAnimationFrame(this.frame);
    hideTip();
    this.root.remove();
  }
}
