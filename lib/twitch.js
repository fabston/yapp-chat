/*
 * Twitch chat: one IRC-over-WebSocket connection per page, shared by every
 * Twitch chat on it. Anonymous (read only) unless you signed in, then it can
 * send too. Also the Twitch account (sign in / out) and badge images.
 */

import { ircNick, parseBadges, parseEmoteTag, parseIrc } from './irc.js';
import { TWITCH_CLIENT_ID, TWITCH_TOKEN_SERVICE } from './apps.js';
import { loadTwitchAuth, saveTwitchAuth, signInRedirectUrl } from './settings.js';
import { renewTokens, requestTokens, tokenFields } from './tokens.js';

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
// user:read:emotes: your emotes (subs, follower emotes) for typing them.
// user:read:follows: live channels you follow, suggested where you type a channel.
// moderator:manage:*: delete, timeout and ban, where you're a moderator.
// moderator:read:followers: since when someone follows, in user cards where you're a moderator.
const SCOPES = 'chat:read chat:edit user:read:emotes user:read:follows moderator:manage:banned_users moderator:manage:chat_messages moderator:read:followers';

export const twitchEmoteUrl = (id) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;

/* ---- IRC lines → chat events (pure; unit-tested) ---- */

const channelOf = (msg) => (msg.params[0] || '').replace(/^#/, '');

const PLANS = { Prime: 'Prime', 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3' };

/**
 * What a USERNOTICE is about, from its tags (msg-id and msg-param-*):
 *   { type: 'sub' | 'resub' | 'gift' | 'gifts' | 'upgrade' | 'raid' | 'announcement' | 'other', … }
 * Pure; unit-tested.
 */
export function twitchNotice(tags) {
  const param = (k) => tags[`msg-param-${k}`] || '';
  const count = (k) => Number(param(k)) || 0;
  const plan = PLANS[param('sub-plan')] || '';
  switch (tags['msg-id']) {
    case 'sub':
      return { type: 'sub', plan };
    case 'resub':
      return { type: 'resub', plan, months: count('cumulative-months'), streak: param('should-share-streak') === '1' ? count('streak-months') : 0 };
    case 'subgift':
      return {
        type: 'gift',
        plan,
        recipient: param('recipient-display-name') || param('recipient-user-name'),
        recipientLogin: param('recipient-user-name'),
        recipientId: param('recipient-id'),
        inBatch: Boolean(param('community-gift-id')),
      };
    case 'submysterygift':
      return { type: 'gifts', plan, count: count('mass-gift-count'), total: count('sender-count') };
    case 'giftpaidupgrade':
    case 'anongiftpaidupgrade':
    case 'primepaidupgrade':
      return { type: 'upgrade', plan };
    case 'raid':
      return { type: 'raid', raider: param('displayName') || param('login'), viewers: count('viewerCount') };
    case 'announcement':
      return { type: 'announcement', color: param('color').toLowerCase() };
    case 'viewermilestone':
      // "watched 3 consecutive streams and sparked a watch streak!"
      return param('category') === 'watch-streak' ? { type: 'streak', streams: count('value') } : { type: 'other' };
    default:
      return { type: 'other' };
  }
}

/** A chat message from a PRIVMSG or USERNOTICE (sub, raid…). */
function twitchMessage(msg, kind) {
  const { tags } = msg;
  let text = msg.params[1] || '';
  // "/me" messages arrive wrapped in \u0001ACTION … \u0001.
  const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
  if (action) text = action[1];
  const login = tags.login || ircNick(msg.prefix);
  return {
    id: tags.id || crypto.randomUUID(),
    platform: 'twitch',
    channel: channelOf(msg),
    time: Number(tags['tmi-sent-ts']) || Date.now(),
    kind,
    action: Boolean(action),
    system: kind === 'notice' ? tags['system-msg'] || '' : '',
    // Subs, raids… (USERNOTICE); a chat message with bits is a cheer.
    event: kind === 'notice' ? twitchNotice(tags) : Number(tags.bits) > 0 ? { type: 'cheer', bits: Number(tags.bits) } : null,
    first: tags['first-msg'] === '1',
    replyTo: tags['reply-parent-display-name'] || '',
    replyLogin: tags['reply-parent-user-login'] || '',
    replyBody: tags['reply-parent-msg-body'] || '',
    replyId: tags['reply-parent-msg-id'] || '',
    replyRoot: tags['reply-thread-parent-msg-id'] || '', // the message the conversation started with
    user: {
      id: tags['user-id'] || login,
      login,
      name: tags['display-name'] || login,
      color: tags.color || '',
      badges: parseBadges(tags.badges),
      // badge-info has the exact months (the badge itself only shows a tier of them).
      months: Number(parseBadges(tags['badge-info']).find((b) => b.set === 'subscriber' || b.set === 'founder')?.version) || 0,
    },
    text,
    nativeEmotes: parseEmoteTag(tags.emotes),
  };
}

/**
 * Chat modes in a ROOMSTATE (the first has all; later ones only what changed):
 * { emoteOnly, subsOnly, unique, slow (seconds), followersOnly (-1 off, else minutes) }.
 * Pure; unit-tested.
 */
export function roomModes(tags) {
  const modes = {};
  if ('emote-only' in tags) modes.emoteOnly = tags['emote-only'] === '1';
  if ('subs-only' in tags) modes.subsOnly = tags['subs-only'] === '1';
  if ('r9k' in tags) modes.unique = tags.r9k === '1';
  if ('slow' in tags) modes.slow = Number(tags.slow) || 0;
  if ('followers-only' in tags) modes.followersOnly = Number(tags['followers-only']);
  return modes;
}

/**
 * What an IRC line means for a chat, or null:
 *   message, clearUser (timeout/ban), clearAll, deleteMessage, room (ids),
 *   userState (your colour and badges), notice.
 */
export function twitchEvent(msg) {
  const channel = channelOf(msg);
  switch (msg.command) {
    case 'PRIVMSG':
      return { type: 'message', channel, message: twitchMessage(msg, 'chat') };
    case 'USERNOTICE': {
      const message = twitchMessage(msg, 'notice');
      // "X is gifting 50 subs" says it; the 50 "X gifted a sub to Y" lines after it would flood the chat.
      if (message.event.type === 'gift' && message.event.inBatch) return null;
      return { type: 'message', channel, message };
    }
    case 'CLEARCHAT':
      return msg.params[1]
        ? {
            type: 'clearUser',
            channel,
            userId: msg.tags['target-user-id'],
            login: msg.params[1],
            duration: Number(msg.tags['ban-duration']) || 0, // seconds; 0 = a ban
            time: Number(msg.tags['tmi-sent-ts']) || Date.now(),
          }
        : { type: 'clearAll', channel };
    case 'CLEARMSG':
      return { type: 'deleteMessage', channel, id: msg.tags['target-msg-id'] };
    case 'ROOMSTATE':
      return msg.tags['room-id'] ? { type: 'room', channel, roomId: msg.tags['room-id'], modes: roomModes(msg.tags) } : null;
    case 'USERSTATE':
      return { type: 'userState', channel, tags: msg.tags };
    case 'NOTICE':
      return { type: 'notice', channel, text: msg.params[1] || '', id: msg.tags['msg-id'] || '' };
    default:
      return null;
  }
}

/* ---- The connection ---- */

/**
 * Events (EventTarget): "event" (detail: twitchEvent), "status" (detail:
 * { connected, authFailed? }).
 */
export class TwitchClient extends EventTarget {
  constructor(auth = null) {
    super();
    this.auth = auth;
    this.channels = new Map(); // channel → how many chats on this page read it
    this.socket = null;
    this.retry = 0;
    this.closed = false;
    this.userStates = new Map();
  }

  get canSend() {
    return Boolean(this.auth?.token && this.socket?.readyState === WebSocket.OPEN);
  }

  connect() {
    this.closed = false;
    // A sign-in that renews itself gets a fresh token first; if that fails, Twitch says so and the chat goes on
    // anonymously (handle: authentication failed).
    if (this.auth?.refreshToken && Date.now() > this.auth.expiresAt - 60_000) {
      freshTwitchAuth(this.auth)
        .catch(() => {})
        .then(() => !this.closed && this.open());
      return;
    }
    this.open();
  }

  open() {
    const socket = new WebSocket(IRC_URL);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.retry = 0;
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      if (this.auth?.token) {
        socket.send(`PASS oauth:${this.auth.token}`);
        socket.send(`NICK ${this.auth.login}`);
      } else {
        // Anonymous, read-only login Twitch allows for any "justinfan" name.
        socket.send('PASS SCHMOOPIIE');
        socket.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      }
      for (const channel of this.channels.keys()) socket.send(`JOIN #${channel}`);
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: true } }));
    });
    socket.addEventListener('message', (e) => {
      for (const line of String(e.data).split('\r\n')) if (line) this.handle(parseIrc(line));
    });
    socket.addEventListener('close', () => {
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: false } }));
      if (this.closed || this.socket !== socket) return;
      // Back off 1, 2, 4… up to 30 s.
      const delay = Math.min(30, 2 ** this.retry++) * 1000;
      setTimeout(() => !this.closed && this.connect(), delay);
    });
  }

  handle(msg) {
    if (msg.command === 'PING') return this.socket.send(`PONG :${msg.params[0] || 'tmi.twitch.tv'}`);
    if (msg.command === 'RECONNECT') return this.socket.close();
    if (msg.command === 'NOTICE' && /authentication failed|improperly formatted auth/i.test(msg.params[1] || '')) {
      // Token expired or revoked: carry on anonymously.
      this.auth = null;
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: false, authFailed: true } }));
      return this.socket.close();
    }
    const event = twitchEvent(msg);
    if (!event) return;
    if (event.type === 'userState') this.userStates.set(event.channel, event.tags);
    this.dispatchEvent(new CustomEvent('event', { detail: event }));
  }

  /** A chat reads `channel`: joined the first time (the connection is shared by every chat on the page). */
  join(channel) {
    const readers = this.channels.get(channel) || 0;
    this.channels.set(channel, readers + 1);
    if (!readers && this.socket?.readyState === WebSocket.OPEN) this.socket.send(`JOIN #${channel}`);
  }

  /** A chat stops reading `channel`: left once no other chat here reads it. */
  part(channel) {
    const readers = (this.channels.get(channel) || 0) - 1;
    if (readers > 0) return void this.channels.set(channel, readers);
    this.channels.delete(channel);
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(`PART #${channel}`);
  }

  /**
   * Send a message (as a reply to `reply` = { id, name, body } if given); Twitch
   * doesn't echo it back, so it's returned for showing.
   */
  send(channel, text, reply = null) {
    if (!this.canSend) throw new Error('Not signed in to Twitch.');
    let clean = text.replace(/[\r\n]+/g, ' ').trim();
    if (!clean) return null;
    // Twitch dropped IRC chat commands in 2023; only /me still works, as an action.
    const me = /^\/me\s+(.+)/i.exec(clean);
    if (me) clean = `\u0001ACTION ${me[1]}\u0001`;
    else if (clean.startsWith('/')) throw new Error('Only /me works here. Use twitch.tv for other chat commands.');
    this.socket.send(`${reply ? `@reply-parent-msg-id=${reply.id} ` : ''}PRIVMSG #${channel} :${clean}`);
    const tags = this.userStates.get(channel) || {};
    const message = twitchMessage(
      {
        tags: {
          ...tags,
          login: this.auth.login,
          'tmi-sent-ts': String(Date.now()),
          id: crypto.randomUUID(),
          emotes: '',
          ...(reply && {
            'reply-parent-display-name': reply.name,
            'reply-parent-user-login': reply.login || '',
            'reply-parent-msg-body': reply.body || '',
            'reply-parent-msg-id': reply.id,
            'reply-thread-parent-msg-id': reply.root || reply.id,
          }),
        },
        prefix: this.auth.login,
        params: [`#${channel}`, clean],
      },
      'chat',
    );
    message.own = true; // shown here only: Twitch doesn't know this id
    return message;
  }

  close() {
    this.closed = true;
    this.socket?.close();
  }
}

/* ---- Account: sign in (a code through Yapp Chat's token service), renew, validate, sign out ---- */

/**
 * { login, user_id, scopes } for a valid token, or null for one Twitch refuses (401: the sign-in is gone).
 * Throws when Twitch can't be asked (offline, 5xx): that says nothing about the sign-in.
 */
export async function validateToken(token) {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } });
  if (res.status === 401) return null;
  if (!res.ok) throw Object.assign(new Error(`Twitch answered ${res.status}`), { status: res.status });
  return res.json();
}

/**
 * Sign in with Yapp Chat's Twitch app (lib/apps.js): Twitch hands over a code, which its token service trades
 * for tokens that renew themselves (freshTwitchAuth). `onApproved`: Twitch's window has closed with your
 * answer, and the rest (a moment) begins.
 */
export async function twitchSignIn(onApproved) {
  const state = crypto.randomUUID();
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: signInRedirectUrl(),
    scope: SCOPES,
    state,
  });
  const back = new URL(await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true })).searchParams;
  onApproved?.();
  if (back.get('state') !== state) throw new Error('Sign-in was interrupted. Try again.');
  if (!back.get('code')) throw new Error(back.get('error_description') || "Twitch didn't accept the sign-in.");
  const tokens = tokenFields(await requestTokens(TWITCH_TOKEN_SERVICE, { grant_type: 'authorization_code', code: back.get('code'), redirect_uri: signInRedirectUrl() }, 'Twitch'));
  const info = await validateToken(tokens.token);
  if (!info) throw new Error("Twitch didn't accept the sign-in.");
  return { clientId: TWITCH_CLIENT_ID, ...tokens, login: info.login, userId: info.user_id };
}

/** The sign-in with a fresh token when this one is (nearly) out (lib/tokens.js renewTokens). */
export const freshTwitchAuth = (auth) => renewTokens(auth, { url: TWITCH_TOKEN_SERVICE, platform: 'Twitch', load: loadTwitchAuth, save: saveTwitchAuth });

/** The headers for Twitch's API as you, with a token renewed first if it needs it. */
async function apiHeaders(auth) {
  await freshTwitchAuth(auth);
  return { 'Client-Id': auth.clientId, Authorization: `Bearer ${auth.token}` };
}

export async function twitchSignOut(auth) {
  await fetch('https://id.twitch.tv/oauth2/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: auth.clientId, token: auth.token }),
  }).catch(() => {});
}

/* ---- Badge images (Twitch's API needs a signed-in account) ---- */

const badgeCache = new Map();

/** Map of "set/version" → image URL, global plus the channel's own. */
export async function twitchBadges(auth, roomId) {
  if (!auth?.token) return new Map();
  const key = roomId || 'global';
  if (!badgeCache.has(key)) {
    const load = async (path) => (await helix(auth, 'GET', `chat/badges${path}`)).data || [];
    const promise = Promise.all([load('/global'), roomId ? load(`?broadcaster_id=${roomId}`) : []]);
    badgeCache.set(
      key,
      promise.then(([global, channel]) => {
        const map = new Map();
        for (const set of [...global, ...channel]) {
          for (const v of set.versions) map.set(`${set.set_id}/${v.id}`, { url: v.image_url_2x, title: v.title });
        }
        return map;
      }, () => {
        badgeCache.delete(key); // try again next time; letters meanwhile
        return new Map();
      }),
    );
  }
  return badgeCache.get(key);
}

/* ---- Emotes you can type ---- */

const usableCache = new Map(); // roomId → Promise

/**
 * The Twitch emotes you can use in this channel (Map name → { url }): yours,
 * including subs and its follower emotes. A sign-in from before Yapp Chat asked
 * for user:read:emotes can't list them, so the global emotes stand in.
 */
export function twitchUsableEmotes(auth, roomId) {
  if (!auth?.token) return Promise.resolve(new Map());
  if (!usableCache.has(roomId)) {
    const get = (path) => helix(auth, 'GET', `chat/emotes${path}`);
    const load = async () => {
      const list = [];
      try {
        let after = '';
        do {
          const page = await get(`/user?user_id=${auth.userId}&broadcaster_id=${roomId}${after ? `&after=${after}` : ''}`);
          list.push(...page.data);
          after = page.pagination?.cursor;
        } while (after && list.length < 5000);
      } catch (error) {
        if (error.status !== 401 && error.status !== 403) throw error; // a hiccup: asked again next time
        list.push(...(await get('/global')).data);
      }
      return new Map(list.map((e) => [e.name, { url: twitchEmoteUrl(e.id) }]));
    };
    usableCache.set(
      roomId,
      load().catch(() => {
        usableCache.delete(roomId);
        return new Map();
      }),
    );
  }
  return usableCache.get(roomId);
}

/* ---- Live now: start time and viewers ---- */

// Twitch's own web client ID: its GraphQL API answers this without a sign-in.
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

/** { startedAt (ms), viewers } while live, null when offline. Pure; unit-tested. */
export function parseTwitchStream(json) {
  const stream = json?.data?.user?.stream;
  return stream ? { startedAt: Date.parse(stream.createdAt), viewers: stream.viewersCount } : null;
}

async function gql(query, variables) {
  const res = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Client-Id': GQL_CLIENT_ID },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Twitch answered ${res.status}`);
  return res.json();
}

export async function twitchLiveInfo(login) {
  return parseTwitchStream(await gql('query($login: String!) { user(login: $login) { stream { createdAt viewersCount } } }', { login }));
}

/* ---- User cards: profile ---- */

/**
 * { photo, banner, bio, createdAt, followers, role, liveViewers } (times in
 * ms; liveViewers null when offline), or null if there's no such user. Pure; unit-tested.
 */
export function parseTwitchProfile(json) {
  const u = json?.data?.user;
  if (!u) return null;
  return {
    photo: u.profileImageURL || '',
    banner: u.bannerImageURL || '',
    bio: (u.description || '').trim(),
    createdAt: Date.parse(u.createdAt) || null,
    followers: u.followers?.totalCount ?? null,
    role: u.roles?.isStaff ? 'Twitch staff' : u.roles?.isPartner ? 'Partner' : u.roles?.isAffiliate ? 'Affiliate' : '',
    liveViewers: u.stream ? u.stream.viewersCount : null,
  };
}

const profiles = new Map(); // login → Promise, kept for the page's life

export function twitchProfile(login) {
  if (!profiles.has(login)) {
    const query = `query($login: String!) { user(login: $login) {
      profileImageURL(width: 150) bannerImageURL description createdAt followers { totalCount }
      roles { isPartner isAffiliate isStaff } stream { viewersCount } } }`;
    const promise = gql(query, { login }).then(parseTwitchProfile);
    promise.catch(() => profiles.delete(login)); // try again next time
    profiles.set(login, promise);
  }
  return profiles.get(login);
}

/* ---- Channel suggestions (where you type a channel) ---- */

/**
 * Channel search results: [{ login, name, avatar, viewers, game }]; viewers is
 * null when offline. Pure; unit-tested.
 */
export function parseChannelSearch(json) {
  return (json?.data?.searchFor?.channels?.items || []).map((c) => ({
    login: c.login,
    name: c.displayName || c.login,
    avatar: c.profileImageURL || '',
    viewers: c.stream ? c.stream.viewersCount : null,
    game: c.stream?.game?.displayName || '',
  }));
}

/** Twitch's own channel search (no sign-in needed). */
export async function twitchSearchChannels(query) {
  const search = `query($q: String!) { searchFor(userQuery: $q, platform: "web", options: { targets: [{ index: CHANNEL }] }) {
    channels { items { login displayName profileImageURL(width: 50) stream { viewersCount game { displayName } } } } } }`;
  return parseChannelSearch(await gql(search, { q: query }));
}

let followedCache = null; // { at, promise }

/** Channels' pictures: user id → profile picture, asked 100 at a time (`get`: a Helix GET). */
async function pictures(get, ids) {
  const avatars = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const query = ids.slice(i, i + 100).map((id) => `id=${id}`).join('&');
    for (const u of (await get(`users?${query}`).catch(() => ({ data: [] }))).data) avatars.set(u.id, u.profile_image_url);
  }
  return avatars;
}

/**
 * Live channels you follow, most watched first, as channel search results.
 * Kept for a minute. Needs user:read:follows: a sign-in from before Yapp Chat
 * asked for it fails with error.status 401.
 */
export function twitchFollowedLive(auth) {
  if (followedCache && Date.now() - followedCache.at < 60_000) return followedCache.promise;
  const get = (path) => helix(auth, 'GET', path);
  const load = async () => {
    const streams = [];
    let after = '';
    do {
      const page = await get(`streams/followed?user_id=${auth.userId}&first=100${after ? `&after=${after}` : ''}`);
      streams.push(...page.data);
      after = page.pagination?.cursor;
    } while (after && streams.length < 300);
    const avatars = await pictures(get, streams.map((s) => s.user_id));
    return streams
      .map((s) => ({ login: s.user_login, name: s.user_name, avatar: avatars.get(s.user_id) || '', viewers: s.viewer_count, game: s.game_name }))
      .sort((a, b) => b.viewers - a.viewers);
  };
  const promise = load();
  promise.catch(() => (followedCache = null)); // try again next time
  followedCache = { at: Date.now(), promise };
  return promise;
}

/**
 * Every channel you follow (up to 2,000), live or not, for Settings → Notifications: [{ login, name, avatar }] by
 * name. Needs user:read:follows (a sign-in without it fails with error.status 401).
 */
export async function twitchFollowedChannels(auth) {
  const get = (path) => helix(auth, 'GET', path);
  const follows = [];
  let after = '';
  do {
    const page = await get(`channels/followed?user_id=${auth.userId}&first=100${after ? `&after=${after}` : ''}`);
    follows.push(...page.data);
    after = page.pagination?.cursor;
  } while (after && follows.length < 2000);
  const avatars = await pictures(get, follows.map((f) => f.broadcaster_id));
  return follows
    .map((f) => ({ login: f.broadcaster_login, name: f.broadcaster_name, avatar: avatars.get(f.broadcaster_id) || '' }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/* ---- Cheers (bits) ---- */

/**
 * Cheermotes from Twitch's cheer config (global, or a channel's own):
 * Map lowercase prefix → { prefix, tiers: [bits…] ascending, template }.
 * Pure; unit-tested.
 */
export function parseCheermotes(groups = []) {
  const map = new Map();
  for (const group of groups || []) {
    for (const node of group.nodes || []) {
      const tiers = (node.tiers || []).map((t) => t.bits).sort((a, b) => a - b);
      if (node.prefix && tiers.length) map.set(node.prefix.toLowerCase(), { prefix: node.prefix, tiers, template: group.templateURL });
    }
  }
  return map;
}

/** The image for `amount` bits of a cheermote: its highest tier at or under the amount. */
export function cheermoteUrl(cheermote, amount) {
  const tier = cheermote.tiers.filter((t) => t <= amount).at(-1) ?? cheermote.tiers[0];
  return cheermote.template
    .replace('PREFIX', cheermote.prefix.toLowerCase())
    .replace('BACKGROUND', 'dark')
    .replace('ANIMATION', 'animated')
    .replace('TIER', tier)
    .replace('SCALE', '2')
    .replace('EXTENSION', 'gif');
}

/** Twitch's colour for a number of bits (grey 1, purple 100, teal 1000, blue 5000, red 10000, gold 100000). */
export function cheerColor(bits) {
  const tiers = [[100000, '#f3a71a'], [10000, '#f43021'], [5000, '#0099fe'], [1000, '#1db2a5'], [100, '#9c3ee8'], [1, '#979797']];
  return tiers.find(([min]) => bits >= min)?.[1] || '#979797';
}

let globalCheers = null;

/** Global cheermotes plus the channel's own (no sign-in needed). */
export async function twitchCheermotes(login) {
  globalCheers ??= gql('query { cheerConfig { groups { templateURL nodes { prefix tiers { bits } } } } }')
    .then((j) => parseCheermotes(j?.data?.cheerConfig?.groups))
    .catch(() => {
      globalCheers = null;
      return new Map();
    });
  const channel = await gql('query($login: String!) { user(login: $login) { cheer { cheerGroups { templateURL nodes { prefix tiers { bits } } } } } }', { login })
    .then((j) => parseCheermotes(j?.data?.user?.cheer?.cheerGroups))
    .catch(() => new Map());
  return new Map([...(await globalCheers), ...channel]);
}

/* ---- Recent messages (before you opened the chat) ---- */

/**
 * The channel's last messages as raw IRC lines, from the public
 * recent-messages service (recent-messages.robotty.de).
 */
export async function twitchRecentMessages(channel, limit = 100) {
  const res = await fetch(`https://recent-messages.robotty.de/api/v2/recent-messages/${channel}?limit=${limit}`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`recent-messages answered ${res.status}`);
  return (await res.json()).messages || [];
}

/* ---- Twitch's API as you, and moderating (where you're a moderator or the broadcaster) ---- */

/** A request to Twitch's API (Helix) as you; a failure carries Twitch's status. */
async function helix(auth, method, path, body) {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
    method,
    headers: { ...(await apiHeaders(auth)), 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    // 401: the sign-in is gone, or is from before Yapp Chat asked for this permission.
    const message = res.status === 401 ? 'Sign in to Twitch again in Settings.' : error.message || `Twitch answered ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

/** Time someone out for `seconds`, or ban them (no seconds). */
export function twitchBan(auth, roomId, userId, seconds = 0, reason = '') {
  const data = { user_id: userId, ...(seconds && { duration: seconds }), ...(reason && { reason }) };
  return helix(auth, 'POST', `moderation/bans?broadcaster_id=${roomId}&moderator_id=${auth.userId}`, { data });
}

export function twitchDeleteMessage(auth, roomId, messageId) {
  return helix(auth, 'DELETE', `moderation/chat?broadcaster_id=${roomId}&moderator_id=${auth.userId}&message_id=${messageId}`);
}

/**
 * When someone followed the channel (ms), or 0 if they don't follow it.
 * Twitch only tells the broadcaster and moderators with moderator:read:followers;
 * anyone else gets no one back, which would read as "not following".
 */
export async function twitchFollowedAt(auth, roomId, userId) {
  const { data } = await helix(auth, 'GET', `channels/followers?broadcaster_id=${roomId}&user_id=${userId}`);
  return Date.parse(data[0]?.followed_at) || 0;
}

/* ---- Clips, videos and channels (link previews) ---- */

/** { title, thumbnail, channel, views, seconds } for a clip, or null. Pure; unit-tested. */
export function parseClip(json) {
  const c = json?.data?.clip;
  return c ? { title: c.title, thumbnail: c.thumbnailURL, channel: c.broadcaster?.displayName || '', views: c.viewCount, seconds: c.durationSeconds } : null;
}

export async function twitchClip(slug) {
  return parseClip(await gql('query($slug: ID!) { clip(slug: $slug) { title thumbnailURL viewCount durationSeconds broadcaster { displayName } } }', { slug }));
}

/**
 * { title, thumbnail, channel, views, seconds, game, kind } for a video (twitch.tv/videos/…: a past broadcast,
 * highlight or upload), or null. A stream still going has a "processing" picture: none then. Pure; unit-tested.
 */
export function parseTwitchVideo(json) {
  const v = json?.data?.video;
  if (!v) return null;
  const thumbnail = v.previewThumbnailURL || '';
  return {
    title: v.title || '',
    thumbnail: thumbnail.includes('/_404/') ? '' : thumbnail,
    channel: v.owner?.displayName || '',
    views: v.viewCount || 0,
    seconds: v.lengthSeconds || 0,
    game: v.game?.displayName || '',
    kind: { ARCHIVE: 'past broadcast', HIGHLIGHT: 'highlight', UPLOAD: 'upload' }[v.broadcastType] || 'video',
  };
}

export async function twitchVideo(id) {
  const query = 'query($id: ID!) { video(id: $id) { title previewThumbnailURL(width: 320, height: 180) lengthSeconds viewCount broadcastType owner { displayName } game { displayName } } }';
  return parseTwitchVideo(await gql(query, { id }));
}

/**
 * A channel's page (twitch.tv/name): { name, avatar, title, game, viewers (null offline), thumbnail (live), followers },
 * or null if there's no such channel. Offline, the title and game are its last ones. Pure; unit-tested.
 */
export function parseTwitchChannel(json) {
  const u = json?.data?.user;
  if (!u) return null;
  return {
    name: u.displayName || '',
    avatar: u.profileImageURL || '',
    title: u.broadcastSettings?.title || '',
    game: (u.stream?.game || u.broadcastSettings?.game)?.displayName || '',
    viewers: u.stream ? u.stream.viewersCount : null,
    thumbnail: u.stream?.previewImageURL || '',
    followers: u.followers?.totalCount ?? 0,
  };
}

export async function twitchChannel(login) {
  const query = `query($login: String!) { user(login: $login) { displayName profileImageURL(width: 150) followers { totalCount }
    broadcastSettings { title game { displayName } } stream { viewersCount previewImageURL(width: 320, height: 180) game { displayName } } } }`;
  return parseTwitchChannel(await gql(query, { login }));
}

