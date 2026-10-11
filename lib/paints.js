/*
 * Yapp Chat's own cosmetics: what people who use Yapp Chat show each other on their names (7TV's, lib/cosmetics.js,
 * are 7TV's users'). A name paint, a gradient through the letters, which anyone picks in Settings → Accounts for
 * their Twitch or Kick name; and a badge before the name, for those it's given to (the founders: the first 420
 * accounts that signed in, each of which joins the service's members, once). yapp.chat's cosmetics service
 * (lib/apps.js COSMETICS_SERVICE) keeps who has what. A chat asks it about the people chatting there, a batch at a time, as 7TV's clients ask 7TV: so the
 * service sees those accounts' ids (not stored or logged), and there's no list of everyone to hand out. Parsing is
 * pure and unit-tested.
 * What there is (PAINTS, BADGES, EVENTS below) is what this version ships with, plus what the service's catalogue
 * has that it doesn't: the newest version's, which a Yapp Chat fetches about once a day (refreshCatalog) and adds
 * to its own (useCatalog), so a new badge, paint or event needs no update of the extension.
 */

import { COSMETICS_SERVICE } from './apps.js';

/**
 * The paints there are: { id (what the service keeps), name, image (the CSS behind the letters), flow (it moves
 * through the name: its colours end where they begin, so it goes round without a seam), only (whose it is, when
 * it isn't everyone's: 'founders' (the service's FOUNDER_PAINTS: one, "Founder", the only one of theirs that's
 * shipped for now: Sunset, Aurora, Ember and Rainbow were before it), or 'given': by a season's event or by hand
 * (its onlyGiven); in an account's offers.paint when it's theirs, and Settings lists it only then) }. Readable on
 * both themes.
 */
export const PAINTS = [
  { id: 'founder', name: 'Founder', image: 'linear-gradient(90deg, #c77700, #f5a700, #ffc933, #f5a700, #c77700)', flow: true, only: 'founders' }, // the crown's gold, with a gleam going through it
  { id: 'ocean', name: 'Ocean', image: 'linear-gradient(90deg, #00b4ff, #2f6bff)' },
  { id: 'candy', name: 'Candy', image: 'linear-gradient(90deg, #ff5fa2, #a26bff)' },
  { id: 'mint', name: 'Mint', image: 'linear-gradient(90deg, #00c781, #00a8cc)' },
  { id: 'grape', name: 'Grape', image: 'linear-gradient(90deg, #8e5bff, #e04fd0)' },
  { id: 'lime', name: 'Lime', image: 'linear-gradient(90deg, #6fbf00, #00a86b)' },
  { id: 'rose', name: 'Rose', image: 'linear-gradient(90deg, #ff6b6b, #e0559c)' },
  { id: 'ice', name: 'Ice', image: 'linear-gradient(90deg, #38bdf8, #818cf8)' },
  { id: 'duck', name: 'Duck', image: 'linear-gradient(90deg, #f5a700, #ff7a1a)' },
  { id: 'forge', name: 'Team', image: 'linear-gradient(90deg, #ff3d2e, #ff9f1c, #ff3d2e)', flow: true, only: 'given' }, // the team's, named as their badge and given by hand as it is (the service keeps it as "forge")
  { id: 'boost', name: 'Boost', image: 'linear-gradient(90deg, #ff5fd2, #a56bff, #5865f2, #ff5fd2)', flow: true, only: 'given' }, // for boosting Yapp Chat's Discord server, while it lasts
];

const byId = new Map(PAINTS.map((p) => [p.id, p]));
const PLATFORMS = ['twitch', 'kick'];

const badge = (file, title, shine = false) => ({ title, source: 'Yapp Chat badge', url: new URL(`../assets/badges/${file}.png`, import.meta.url).href, shine });
/**
 * The badges there are, by the name the service keeps: { title (its name: in Settings' dropdown and its tooltip, over
 * source, which says whose it is, so the title doesn't), url (its picture, in assets/badges/: made by
 * scripts/badges.mjs), shine (a reflection crosses it every few seconds: lib/ui.js shiny) }, as lib/cosmetics.js's
 * badges. Founder: the duck with a crown, for the first 420 accounts. A season's (Halloween 2026: the duck as a
 * ghost; Christmas 2026: as a snowman; Christmas 2027: as a reindeer): for every account signed in while its event
 * ran (EVENTS). The boosters' (a gem over the duck): theirs while they boost Yapp Chat's Discord server (linkDiscord).
 * The team's (the duck in a hard hat): given by hand, to those who make Yapp Chat. The founders' and the team's
 * shine. One the catalogue added has its picture as a data: URL.
 */
export const BADGES = {
  founder: badge('founder', 'Founder', true),
  'halloween-2026': badge('halloween-2026', 'Halloween 2026'),
  'xmas-2026': badge('xmas-2026', 'Christmas 2026'),
  'xmas-2027': badge('xmas-2027', 'Christmas 2027'),
  booster: badge('booster', 'Booster'),
  team: badge('team', 'Team', true),
};

/**
 * The seasons' events, as the service has them (server/cosmetics-service.mjs EVENTS: it's the one that gives what
 * they give, a badge, a paint or both; a test holds the two to each other): while one runs, a sign-in checks in
 * with the service once more (joinOnce), to be given it.
 */
export const EVENTS = {
  'halloween-2026': { from: Date.UTC(2026, 9, 1), until: Date.UTC(2026, 10, 3, 12), badge: 'halloween-2026' },
  'xmas-2026': { from: Date.UTC(2026, 11, 1), until: Date.UTC(2027, 0, 1, 12), badge: 'xmas-2026' },
  'xmas-2027': { from: Date.UTC(2027, 11, 1), until: Date.UTC(2028, 0, 1, 12), badge: 'xmas-2027' },
};

const DAY = 864e5;
/** How many badges, paints or events a catalogue (or what's yours of them) may hold: it's kept in the browser's storage, pictures and all. */
const MOST_LISTED = 60;
const NAME = /^[a-z0-9-]{1,32}$/; // a badge's, a paint's, an event's: as the service keeps them
const PICTURE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
const GRADIENT = /^linear-gradient\(\d{1,3}deg(, #[0-9a-f]{6}){2,8}\)$/; // a paint's colours, and nothing else that CSS could be
/** What this version ships with ("badge:founder", "paint:ocean", "event:xmas-2026"): the catalogue adds to it, and doesn't change it. */
const OWN = new Set([...Object.keys(BADGES).map((id) => `badge:${id}`), ...PAINTS.map((p) => `paint:${p.id}`), ...Object.keys(EVENTS).map((id) => `event:${id}`)]);

/**
 * What this version ships with, for the service to hand to the others (server/cosmetics-service.mjs builds it when
 * it starts): { badges: { id: { title, shine, picture } }, paints: PAINTS, events: EVENTS }. `picture(badge)`: its
 * picture as a data: URL.
 */
export const catalog = (picture) => ({ badges: Object.fromEntries(Object.entries(BADGES).map(([id, b]) => [id, { title: b.title, shine: b.shine, picture: picture(b) }])), paints: PAINTS, events: EVENTS });

/**
 * The service's catalogue, only what reads as one: names as the service keeps them, short titles, a PNG's data,
 * colours in a gradient, an event's two times; and `discord`, the id of Yapp Chat's Discord application when
 * linking Discord is set up there ('' when not). Anything else in it is left out. Pure; unit-tested.
 */
export function parseCatalog(json) {
  const text = (value, most) => typeof value === 'string' && value.length > 0 && value.length <= most;
  const named = (value) => typeof value === 'string' && NAME.test(value);
  const entries = (value) => (value && typeof value === 'object' ? Object.entries(value) : []);
  const badges = {};
  for (const [id, b] of entries(json?.badges).slice(0, MOST_LISTED)) {
    if (named(id) && text(b?.title, 40) && text(b.picture, 100_000) && PICTURE.test(b.picture)) badges[id] = { title: b.title, shine: b.shine === true, picture: b.picture };
  }
  const paints = (Array.isArray(json?.paints) ? json.paints : [])
    .slice(0, MOST_LISTED)
    .filter((p) => named(p?.id) && text(p.name, 24) && typeof p.image === 'string' && GRADIENT.test(p.image) && [undefined, 'founders', 'given'].includes(p.only))
    .map((p) => ({ id: p.id, name: p.name, image: p.image, ...(p.flow === true && { flow: true }), ...(p.only && { only: p.only }) }));
  const events = {};
  for (const [id, e] of entries(json?.events).slice(0, MOST_LISTED)) {
    if (named(id) && Number.isFinite(e?.from) && Number.isFinite(e.until) && [e.badge, e.paint].every((gives) => gives === undefined || named(gives))) events[id] = { from: e.from, until: e.until, ...(e.badge && { badge: e.badge }), ...(e.paint && { paint: e.paint }) };
  }
  return { badges, paints, events, discord: typeof json?.discord === 'string' && /^\d{5,25}$/.test(json.discord) ? json.discord : '' };
}

/**
 * Add a catalogue (parseCatalog's) to what there is: the badges, paints and events this version doesn't ship with
 * (those it does stay as they are here: this may be the newer of the two, and what you see is what's in this
 * code). One the catalogue added before is as the catalogue has it now.
 */
export function applyCatalog({ badges = {}, paints = [], events = {}, discord = '' } = {}) {
  discordClient = discord;
  for (const [id, b] of Object.entries(badges)) if (!OWN.has(`badge:${id}`)) BADGES[id] = { title: b.title, source: 'Yapp Chat badge', url: b.picture, shine: b.shine };
  for (const paint of paints) {
    if (OWN.has(`paint:${paint.id}`)) continue;
    const at = PAINTS.findIndex((p) => p.id === paint.id);
    PAINTS.splice(at < 0 ? PAINTS.length : at, at < 0 ? 0 : 1, paint);
    byId.set(paint.id, paint);
  }
  for (const [id, event] of Object.entries(events)) if (!OWN.has(`event:${id}`)) EVENTS[id] = event;
}

let discordClient = '';
/**
 * Yapp Chat's Discord application's id (public, as every sign-in page shows it), when linking Discord is set up on
 * the service: the catalogue says. '' until then: linking isn't offered.
 */
export const discordLinking = () => discordClient;

/** Add the catalogue kept here (chrome.storage.local cosmeticsCatalog: { at, badges, paints, events, discord }) to what there is. */
export const loadCatalog = async () => applyCatalog((await chrome.storage.local.get('cosmeticsCatalog')).cosmeticsCatalog);

/** Use the catalogue kept here, now and whenever a newer one is kept; `changed()` after each. Once per page. */
export function useCatalog(changed) {
  const read = () => loadCatalog().then(changed);
  chrome.storage.onChanged.addListener((changes, area) => area === 'local' && changes.cosmeticsCatalog && read());
  return read();
}

/**
 * Fetch the service's catalogue and keep it, if what's kept is a day old (or there's none; `old`: sooner than a
 * day, for Settings, where what's new should show when you look): the pages that use it learn of it by themselves
 * (useCatalog). No answer: what's kept stays, and the next page tries again.
 */
export async function refreshCatalog(now = Date.now(), old = DAY) {
  const { cosmeticsCatalog } = await chrome.storage.local.get('cosmeticsCatalog');
  if (cosmeticsCatalog && now - cosmeticsCatalog.at < old) return;
  const res = await fetch(`${COSMETICS_SERVICE}?catalog=1`, { credentials: 'omit' }).catch(() => null);
  const json = res?.ok && (await res.json().catch(() => null));
  if (json) await chrome.storage.local.set({ cosmeticsCatalog: { at: now, ...parseCatalog(json) } });
}

/** The events that run now. */
const eventsNow = (now = Date.now()) => Object.keys(EVENTS).filter((event) => now >= EVENTS[event].from && now < EVENTS[event].until);
/** The kinds this version draws, and for each which values it knows. */
const KNOWN = { paint: (value) => byId.has(value), badge: (value) => Object.hasOwn(BADGES, value) };
const KINDS = Object.keys(KNOWN);
/** What's news of an account, of a kind (an array: badges, as it was first kept). */
const newsOf = (mine, kind) => (Array.isArray(mine?.news) ? (kind === 'badge' ? mine.news : []) : mine?.news?.[kind] || []);

/**
 * A paint as a name's style, { backgroundImage, filter } (as lib/cosmetics.js paintStyle's) and flow (it moves:
 * chat.css .name.flowing), or null for one this version doesn't know.
 */
export const yappPaintStyle = (id) => (byId.has(id) ? { backgroundImage: byId.get(id).image, filter: '', flow: Boolean(byId.get(id).flow) } : null);

/**
 * The service's answer ({ twitch: { "<user id>": { paint, badge, … } }, kick: { … } }) → Map "twitch:<user id>" →
 * { paint, badge } ('' for one they don't have, or that this version doesn't know). Pure; unit-tested.
 */
export function parseCosmetics(json) {
  const map = new Map();
  for (const platform of PLATFORMS) {
    for (const [id, theirs] of Object.entries(json?.[platform] || {})) {
      map.set(`${platform}:${id}`, Object.fromEntries(KINDS.map((kind) => [kind, KNOWN[kind](theirs?.[kind]) ? theirs[kind] : ''])));
    }
  }
  return map;
}

/** The address that asks about these accounts ("twitch:<id>" keys): "…?twitch=1,2&kick=3". Pure; unit-tested. */
export function lookupUrl(keys) {
  const ids = (platform) => keys.filter((k) => k.startsWith(`${platform}:`)).map((k) => k.slice(platform.length + 1));
  return `${COSMETICS_SERVICE}?${PLATFORMS.filter((p) => ids(p).length).map((p) => `${p}=${ids(p).join(',')}`).join('&')}`;
}

const BATCH = 200; // accounts in one question (the service's MAX_IDS)
const GATHER = 500; // ms: the chatters that come within this go in one question
const KEEP = 10 * 60_000; // an answer holds this long; then, when they chat again, they're asked about again
const RETRY = 30_000; // no questions for this long after one that got no answer
const MOST = 50_000; // answers kept; past that, the old ones go
const NONE = Object.fromEntries(KINDS.map((kind) => [kind, '']));

/**
 * You, as the service knows each account you're signed in with, kept here too (chrome.storage.local cosmeticsMine:
 * { "twitch:<id>": { paint, badge ('' none), offers: { badge: [yours to wear], paint: [the founders' and the given
 * ones, if yours] }, asked (the events it checked in for), news ({ badge: [], paint: [] }: just given, not seen to
 * yet: givenNews), discord (a Discord account is linked: linkDiscord), discordName (its username, when the service
 * has it) and boosting (its boost's badge and paint are yours now), at (when the service said so, or you set one) } }).
 * Settings draws from it at once; a chat shows what you just set before the service's answer
 * has it (while it's fresh: KEEP; after that the answer speaks, also for one set elsewhere since); and a sign-in
 * that's in it has joined (joinOnce).
 */
export const loadMine = async () => (await chrome.storage.local.get('cosmeticsMine')).cosmeticsMine || {};
let writing = Promise.resolve(); // one change at a time: each reads what's kept, then writes it back
const changeMine = (change) => (writing = writing.catch(() => {}).then(async () => chrome.storage.local.set({ cosmeticsMine: change(await loadMine()) })));
const keepMine = (key, change) => changeMine((all) => ({ ...all, [key]: { ...NONE, ...all[key], ...change, at: Date.now() } }));

/** A request to the service as the account `token` signs in to; its answer, or an error with the service's words. */
async function asYou(url, token, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } }).catch(() => null);
  const json = res && (await res.json().catch(() => null));
  if (!res?.ok) throw new Error(json?.error_description || "Couldn't reach Yapp Chat. Try again.");
  return json;
}

/**
 * Set the paint or badge (`kind`) of the account `token` signs in to ('' takes it off), and keep it here too
 * (cosmeticsMine, above): others' chats learn of it when they next ask about you (within KEEP). Throws with the
 * service's words when it refuses.
 */
export async function saveCosmetic(platform, userId, token, kind, value) {
  await asYou(COSMETICS_SERVICE, token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform, kind, value }) });
  await keepMine(`${platform}:${userId}`, { [kind]: value });
}

/**
 * Join the service's members as the account `token` signs in to (it numbers them as they come: the first 420 are
 * founders; joining again changes nothing; while a season's event runs it gives what that gives), and keep what it says
 * is yours there (cosmeticsMine, above): your paint and badge, what you may wear, and which of that is new (a chat
 * shows it until you've seen to it: givenNews).
 */
export async function joinCosmetics(platform, userId, token, now = Date.now()) {
  await keepYou(platform, userId, await asYou(`${COSMETICS_SERVICE}?me=${platform}`, token, { method: 'POST' }), now);
}

/** Keep what the service says of an account (`you`: its answer to joining or linking), and note what's new in it. */
async function keepYou(platform, userId, you, now) {
  const key = `${platform}:${userId}`;
  const before = (await loadMine())[key];
  // What's theirs to wear, as lists of names and nothing else (pages go through them: anything else there, and
  // Settings wouldn't draw).
  const offers = Object.fromEntries(KINDS.map((kind) => [kind, (Array.isArray(you?.offers?.[kind]) ? you.offers[kind] : []).filter((id) => typeof id === 'string' && NAME.test(id)).slice(0, MOST_LISTED)]));
  const had = (kind) => (Array.isArray(before?.offers?.[kind]) ? before.offers[kind] : []);
  const added = (kind) => offers[kind].filter((id) => !had(kind).includes(id));
  await keepMine(key, {
    ...parseCosmetics({ [platform]: { [userId]: you?.has } }).get(key),
    offers,
    asked: [...new Set([...(before?.asked || []), ...eventsNow(now)])],
    news: Object.fromEntries(KINDS.map((kind) => [kind, [...new Set([...newsOf(before, kind), ...added(kind)])]])),
    discord: Boolean(you?.discord),
    discordName: typeof you?.discordName === 'string' ? you.discordName.slice(0, 32) : '',
    boosting: Boolean(you?.boosting),
  });
}

/**
 * Sign in to Discord, for who you are there and nothing else (Yapp Chat's Discord application, discordLinking, in
 * a window as Twitch's sign-in, with this extension's redirect as theirs): the sign-in, to hand to linkDiscord.
 * Throws with what went wrong, or when its window is closed.
 */
export async function discordSignIn(clientId = discordClient) {
  const state = crypto.randomUUID();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({ response_type: 'token', client_id: clientId, redirect_uri: chrome.identity.getRedirectURL(), scope: 'identify', state });
  const came = new URL(await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true }));
  const back = new URLSearchParams(came.hash.slice(1) || came.search); // the sign-in comes after a #, a refusal after a ?
  if (back.get('error')) throw new Error(back.get('error') === 'access_denied' ? 'Sign-in cancelled.' : back.get('error_description') || "Discord didn't accept the sign-in.");
  if (back.get('state') !== state || !back.get('access_token')) throw new Error('Sign-in was interrupted. Try again.');
  return back.get('access_token');
}

/**
 * Link the account `token` signs in to with a Discord account (`discordToken`: discordSignIn's; '' unlinks it), so
 * boosting Yapp Chat's Discord server gives it the Booster badge and the Boost paint for as long as the boost
 * lasts (the service looks every ten minutes). The service's answer ({ discord, discordName, boosting, … }), kept here as
 * joinCosmetics keeps its own. Throws with the service's words when it refuses.
 */
export async function linkDiscord(platform, userId, token, discordToken, now = Date.now()) {
  const you = await asYou(`${COSMETICS_SERVICE}?link=${platform}`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discord: discordToken }) });
  await keepYou(platform, userId, you, now);
  return you;
}

/**
 * Join for a sign-in that hasn't yet (background.js: every sign-in does, once), and once more for each season's
 * event while it runs, to be given its badge (so someone signed in long before gets it too, the next time the
 * browser starts). One with Discord linked asks each time: a boost may have begun or ended since. `fresh` renews
 * its token first, if it needs it. `now`: the time (the tests' own).
 */
export async function joinOnce(platform, account, fresh, now = Date.now()) {
  if (!account?.token || !account.userId) return;
  const mine = (await loadMine())[`${platform}:${account.userId}`];
  if (mine && !mine.discord && eventsNow(now).every((event) => mine.asked?.includes(event))) return;
  await fresh(account);
  await joinCosmetics(platform, account.userId, account.token, now);
}

/**
 * The badges and paints just given to you that you haven't worn or put away yet, in what's kept of you (`all`:
 * cosmeticsMine): [{ kind, id }], badges first. One this version doesn't know waits for a version that does.
 */
export const givenNews = (all) => ['badge', 'paint'].flatMap((kind) => [...new Set(Object.values(all).flatMap((mine) => newsOf(mine, kind)))].filter(KNOWN[kind]).map((id) => ({ kind, id })));

/** They're seen to: no news any more (but of what this version doesn't know). */
export const clearGivenNews = () => changeMine((all) => Object.fromEntries(Object.entries(all).map(([key, mine]) => [key, { ...mine, news: Object.fromEntries(KINDS.map((kind) => [kind, newsOf(mine, kind).filter((id) => !KNOWN[kind](id))])) }])));

/**
 * The paints and badges of the people a page's chats show: one per page, shared by its panes. idFor / paintFor /
 * badgeFor answer from what's known and ask the service about who isn't (or was, a while ago), a batch at a time.
 * Events: "change" (detail: a user id) when something of someone's comes, changes or goes, so panes redraw their
 * lines (as lib/cosmetics.js Cosmetics'); "news" when what was just given to you (`news`) changes.
 */
export class Paints extends EventTarget {
  constructor() {
    super();
    this.known = new Map(); // "twitch:<id>" → { paint, badge ('' none), at (when asked; 0: to ask again) }
    this.queue = new Set(); // to ask about, in the next question
    this.own = {}; // you (cosmeticsMine): what you just set shows at once
    this.rest = 0; // no questions until then (the service didn't answer)
    this.readOwn();
    chrome.storage.onChanged.addListener((changes, area) => area === 'local' && changes.cosmeticsMine && this.readOwn());
    // The catalogue: what it adds may be something a chatter has, or was just given to you. Asked about again.
    useCatalog(() => {
      this.known.clear();
      this.dispatchEvent(new Event('news'));
    });
    refreshCatalog().catch(() => {});
  }

  /** You, read again: what changed is announced. */
  async readOwn() {
    const before = this.own;
    this.own = await loadMine().catch(() => before);
    for (const key of new Set([...Object.keys(before), ...Object.keys(this.own)])) if (KINDS.some((kind) => before[key]?.[kind] !== this.own[key]?.[kind])) this.changed(key);
    if (JSON.stringify(givenNews(before)) !== JSON.stringify(this.news)) this.dispatchEvent(new Event('news'));
  }

  /** The badges and paints just given to you, not seen to yet (givenNews). */
  get news() {
    return givenNews(this.own);
  }

  /** Announce a change for the account of a key ("twitch:<id>"). */
  changed(key) {
    this.dispatchEvent(new CustomEvent('change', { detail: key.slice(key.indexOf(':') + 1) }));
  }

  /** Ask the service about the next batch of the queue; what it says is kept, and announced where it's news. */
  async ask() {
    this.timer = null;
    const keys = [...this.queue].slice(0, BATCH);
    for (const key of keys) this.queue.delete(key);
    if (this.queue.size) this.timer = setTimeout(() => this.ask(), GATHER);
    const answer = await fetch(lookupUrl(keys), { credentials: 'omit' })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(parseCosmetics, () => null);
    if (!answer) {
      // The service is away: no more questions for a while. Who waited is asked about when they next chat after it.
      this.rest = Date.now() + RETRY;
      keys.push(...this.queue);
      this.queue.clear();
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const key of keys) {
      const was = this.known.get(key) || NONE;
      const now = answer ? answer.get(key) || NONE : was;
      this.known.set(key, { ...now, at: answer ? Date.now() : 0 });
      if (KINDS.some((kind) => now[kind] !== was[kind])) this.changed(key);
    }
    if (this.known.size > MOST) for (const [key, was] of this.known) if (Date.now() - was.at > KEEP) this.known.delete(key);
  }

  /** What someone has of a kind ('' for none, or not known yet: then it's asked, and a "change" follows if they have something). */
  get(platform, userId, kind) {
    const key = `${platform}:${userId}`;
    const mine = this.own[key];
    if (mine && Date.now() - mine.at < KEEP) return mine[kind] || '';
    const known = this.known.get(key);
    if ((!known || Date.now() - known.at > KEEP) && Date.now() > this.rest && PLATFORMS.includes(platform) && /^\d+$/.test(userId)) {
      this.known.set(key, { ...(known || NONE), at: Date.now() }); // asked: not again for a while
      this.queue.add(key);
      this.timer ??= setTimeout(() => this.ask(), GATHER);
    }
    return known?.[kind] || '';
  }

  /** The paint id someone has ('' for none). */
  idFor(platform, userId) {
    return this.get(platform, userId, 'paint');
  }

  /** The paint for someone's name ({ backgroundImage, filter, flow }), or null. */
  paintFor(platform, userId) {
    return yappPaintStyle(this.idFor(platform, userId));
  }

  /** Their Yapp Chat badge ({ url, title, source, shine }), or null. */
  badgeFor(platform, userId) {
    return BADGES[this.get(platform, userId, 'badge')] || null;
  }
}
