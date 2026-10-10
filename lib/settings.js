/*
 * Settings and private notes (synced), and the Twitch and Kick sign-ins (this
 * device only: they're credentials). Pure normalization is unit-tested.
 */

import { textMatcher } from './format.js';
import { isSource, uniqueSources } from './sources.js';

export const DEFAULTS = {
  /** Words that highlight a message (whole words, any case), or /regexes/. */
  highlightWords: [],
  /** Words that hide a message (as highlightWords). */
  hiddenWords: [],
  /** Also highlight messages that mention your Twitch name. */
  highlightName: true,
  /** The mentions inbox collects your highlight words too, not only messages with your name. */
  mentionWords: false,
  /** Moderators: timeout lengths in seconds (the first is the quick one, on a message's buttons and T), saved reasons. */
  modTimeouts: [600, 3600, 86400],
  modReasons: [],
  /** Delete, the quick timeout and ban at the start of every message in channels you moderate. */
  modButtons: false,
  /** Keys for the message under the pointer: D delete, T timeout, B ban. */
  modKeys: true,
  /** Who timed out or banned whom and why, what else moderators do, in the chat (channels you moderate). */
  modLog: true,
  /** A raid into a channel you moderate (Twitch): a bar offering followers-only for 10 minutes, Shield Mode, a shoutout. */
  raidProtect: true,
  /** First-time chatters whose Twitch account is under a month old: a tag on their line. */
  flagNewAccounts: true,
  emotes: { bttv: true, ffz: true, seventv: true },
  timestamps: false,
  badges: true,
  /** Open the side panel on your first click on a live stream (autoopen.js). */
  autoOpen: true,
  /** Show a Twitch chat's last messages when you open it (recent-messages.robotty.de). */
  recentMessages: true,
  /** User cards load the person's past messages from the public chat logs (logs.ivr.fi). */
  cardLogs: true,
  /** A chat of one channel offers to bring in its streamer's chats on the other platforms, when they're live there (lib/simulcast.js). */
  offerSimulcast: true,
  /** Message text size in px. */
  fontSize: 15,
  /** Emote height, relative to the text (EMOTE_SIZES). */
  emoteSize: 'Medium',
  /** Shade every other line. */
  altRows: false,
  /** The same message again within a minute: "×2" on the first instead of a new line. */
  foldRepeats: true,
  /** With foldRepeats: messages that mostly say the same within 30 seconds fold too ("×9 similar"). */
  foldSimilar: false,
  /** The chat holds still while the pointer moves anywhere over it (not only over names, links and replies). */
  holdAnywhere: false,
  /** A channel's pinned message, poll and prediction above its chat (Twitch and Kick). */
  showPinned: true,
  /** Hide "!command" messages (to chat bots). */
  hideCommands: false,
  /** Hide messages from common chat bots (COMMON_BOTS). */
  hideBots: false,
  /** Hide messages from these people (logins, lowercase). */
  hiddenUsers: [],
  /** Your friends (logins, lowercase): their messages stand out in every chat. */
  friends: [],
  /** Emotes you starred in the emote picker (names). */
  favoriteEmotes: [],
  /** 7TV name paints and 7TV / BTTV / FFZ badges. */
  cosmetics: true,
  /** A desktop notification when a channel you follow goes live (signed in). */
  liveNotify: false,
  /** A desktop notification for a mention in an open chat (what goes to the inbox: your name; words with mentionWords). */
  mentionNotify: false,
  /** A mention in an open chat: a short sound, and the chat's window asking for attention (taskbar, Dock) when it isn't in front. */
  mentionSound: false,
  mentionFlash: false,
  /** Your own names for people, shown in place of theirs: { login: nickname }. */
  nicknames: {},
  /** Which channels: all you follow (true) or none, but those in liveExcept (logins) the other way (see notifiesFor). */
  liveAll: true,
  liveExcept: [],
  /** 'dark' | 'light' | 'system'. */
  theme: 'dark',
  /** 'comfortable' | 'compact' (tighter lines). */
  density: 'comfortable',
  /** Message font (CHAT_FONTS). */
  chatFont: 'system',
  /** Chats open in the chat window, left to right; each a list of sources (several = merged). */
  splits: [],
};

// Medium matches Twitch's own chat.
export const FONT_SIZES = { Small: 13, Medium: 15, Large: 17 };

/** Message fonts. */
export const CHAT_FONTS = {
  system: ['System', 'var(--font)'],
  rounded: ['Rounded', 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif'],
  mono: ['Monospace', 'var(--mono)'],
};

/** Emote height as a multiple of the text size. */
export const EMOTE_SIZES = { Small: 1.6, Medium: 2.1, Large: 2.8 };

/** Chat bots hidden by "Hide common bots". */
export const COMMON_BOTS = ['streamelements', 'nightbot', 'fossabot', 'moobot', 'streamlabs', 'wizebot', 'sery_bot', 'soundalerts', 'botrixoficial'];

/**
 * A test for "don't show this message" from the hide settings: people you
 * hid, common bots, !commands, words or /regexes/ in it. Pure; unit-tested.
 */
export function hiddenBy(settings) {
  const people = new Set([...settings.hiddenUsers, ...(settings.hideBots ? COMMON_BOTS : [])]);
  const words = textMatcher(settings.hiddenWords);
  return (message) => {
    const login = (message.user?.login || '').toLowerCase(); // YouTube's start with "@"
    return (
      Boolean(login && (people.has(login) || people.has(login.replace(/^@/, '')))) ||
      (settings.hideCommands && /^\s*!\w/.test(message.text || '')) ||
      Boolean(words?.(message.text || ''))
    );
  };
}

/** Highlight or hide entries: trimmed, no repeats, 100 at most, each up to 200 characters (a regex too). */
const entries = (list) => [...new Set((Array.isArray(list) ? list : []).map((w) => String(w).trim()).filter((w) => w && w.length <= 200))].slice(0, 100);

/** A list of Twitch logins: trimmed, lowercase, no repeats. */
const logins = (list) => [...new Set((Array.isArray(list) ? list : []).map((u) => String(u).trim().replace(/^@/, '').toLowerCase()).filter(Boolean))].slice(0, 500);

/**
 * Whether a channel you follow notifies when it goes live: all do but those you turned off, or (after "All off")
 * none but those you turned on. Kept as a default and its exceptions, so it stays small however many you follow.
 */
export const notifiesFor = (settings, login) => settings.liveAll !== settings.liveExcept.includes(login);

/** liveExcept with a channel turned on or off: an exception when it differs from the default, else none. */
export function liveExceptWith(settings, login, on) {
  const others = settings.liveExcept.filter((l) => l !== login);
  return on === settings.liveAll ? others : [...others, login];
}

export function normalizeSettings(raw = {}) {
  return {
    highlightWords: entries(raw.highlightWords),
    hiddenWords: entries(raw.hiddenWords),
    highlightName: raw.highlightName !== false,
    mentionWords: raw.mentionWords === true,
    // Twitch takes 1 second to 2 weeks; Kick's minutes (rounded up) to a week.
    modTimeouts: (() => {
      const lengths = [...new Set((Array.isArray(raw.modTimeouts) ? raw.modTimeouts : []).map(Math.round).filter((s) => s >= 1 && s <= 1_209_600))].slice(0, 6);
      return lengths.length ? lengths : DEFAULTS.modTimeouts;
    })(),
    modReasons: [...new Set((Array.isArray(raw.modReasons) ? raw.modReasons : []).map((r) => String(r).trim().slice(0, 100)).filter(Boolean))].slice(0, 12),
    modButtons: raw.modButtons === true,
    modKeys: raw.modKeys !== false,
    modLog: raw.modLog !== false,
    raidProtect: raw.raidProtect !== false,
    flagNewAccounts: raw.flagNewAccounts !== false,
    emotes: {
      bttv: raw.emotes?.bttv !== false,
      ffz: raw.emotes?.ffz !== false,
      seventv: raw.emotes?.seventv !== false,
    },
    timestamps: raw.timestamps === true,
    autoOpen: raw.autoOpen !== false,
    recentMessages: raw.recentMessages !== false,
    cardLogs: raw.cardLogs !== false,
    offerSimulcast: raw.offerSimulcast !== false,
    badges: raw.badges !== false,
    fontSize: Object.values(FONT_SIZES).includes(raw.fontSize) ? raw.fontSize : DEFAULTS.fontSize,
    emoteSize: raw.emoteSize in EMOTE_SIZES ? raw.emoteSize : DEFAULTS.emoteSize,
    altRows: raw.altRows === true,
    foldRepeats: raw.foldRepeats !== false,
    foldSimilar: raw.foldSimilar === true,
    holdAnywhere: raw.holdAnywhere === true,
    showPinned: raw.showPinned !== false,
    hideCommands: raw.hideCommands === true,
    hideBots: raw.hideBots === true,
    hiddenUsers: logins(raw.hiddenUsers),
    friends: logins(raw.friends),
    favoriteEmotes: [...new Set((Array.isArray(raw.favoriteEmotes) ? raw.favoriteEmotes : []).map(String).filter(Boolean))].slice(0, 200),
    cosmetics: raw.cosmetics !== false,
    liveNotify: raw.liveNotify === true,
    mentionNotify: raw.mentionNotify === true,
    mentionSound: raw.mentionSound === true,
    mentionFlash: raw.mentionFlash === true,
    // Up to 200, a name each (they share one synced item of 8 KB).
    nicknames: Object.fromEntries(
      Object.entries(raw.nicknames && typeof raw.nicknames === 'object' ? raw.nicknames : {})
        .map(([login, nick]) => [String(login).trim().toLowerCase().replace(/^@/, '').slice(0, 40), String(nick).trim().slice(0, 30)])
        .filter(([login, nick]) => login && nick)
        .slice(0, 200),
    ),
    liveAll: raw.liveAll !== false,
    liveExcept: logins(raw.liveExcept),
    theme: ['dark', 'light', 'system'].includes(raw.theme) ? raw.theme : 'dark',
    density: raw.density === 'compact' ? 'compact' : 'comfortable',
    chatFont: raw.chatFont in CHAT_FONTS ? raw.chatFont : 'system',
    // Before merged chats, each split was a single source.
    splits: (Array.isArray(raw.splits) ? raw.splits : [])
      .map((chat) => uniqueSources([].concat(chat).filter(isSource)))
      .filter((chat) => chat.length)
      .slice(0, 12),
  };
}

export async function loadSettings() {
  return normalizeSettings(await chrome.storage.sync.get(DEFAULTS));
}

export const saveSettings = (partial) => chrome.storage.sync.set(partial);

/** Your nickname for `login` (settings.nicknames), or '': only one you gave (a login like "constructor" has none). */
export const nicknameOf = (settings, login) => (login && Object.hasOwn(settings.nicknames, login.toLowerCase()) ? settings.nicknames[login.toLowerCase()] : '');

/** Your Twitch sign-in: { clientId, token, refreshToken, expiresAt, login, userId }, or {} signed out. */
export async function loadTwitchAuth() {
  const { twitchAuth } = await chrome.storage.local.get('twitchAuth');
  return twitchAuth || {};
}

export const saveTwitchAuth = (twitchAuth) => chrome.storage.local.set({ twitchAuth });

/** This extension's sign-in return address, for the Twitch and Kick apps' redirect URL. */
export const signInRedirectUrl = () => chrome.identity.getRedirectURL();

/**
 * A sign-in change that changes who you are (signed in, out, or as someone
 * else): pages start over. A renewed token (Kick's, every few hours) isn't one.
 */
export function signInChanged(change) {
  return Boolean(change) && (Boolean(change.oldValue?.token) !== Boolean(change.newValue?.token) || change.oldValue?.userId !== change.newValue?.userId);
}

/** Your Kick sign-in (lib/kick.js kickSignIn): the tokens, your name, user ID and picture, or {} signed out. */
export async function loadKickAuth() {
  const { kickAuth } = await chrome.storage.local.get('kickAuth');
  return kickAuth || {};
}

export const saveKickAuth = (kickAuth) => chrome.storage.local.set({ kickAuth });

/* ---- Private notes: synced, so they follow your browser profile like the settings ---- */

/**
 * Notes ({ login: text }) as JSON, split over notes0, notes1… with notesParts saying how many: synced storage
 * takes 8 KB an item (and 100 KB in all, the settings included). 2,000 characters an item stays under 8 KB
 * even when every one is a 4-byte emoji; split by whole characters (the u flag), as half an emoji would be
 * stored as "�". If they don't fit, all of them stay on this device instead (local storage, notesOverflow:
 * then that's the whole set). Versions before 1.0.6 kept them on the device too (local storage, notes): those
 * are merged with the synced ones until the next save moves them.
 */
const NOTE_PART = 2000;

/** A synced key holding notes, not settings (the chats don't redraw when one changes). */
export const isNotesKey = (key) => key === 'notesParts' || /^notes\d+$/.test(key);

/** Your notes, or null if the synced copy is half-arrived from another device (then don't save over it). */
export async function loadNotes() {
  const [{ notesParts = 0 }, { notes: here = {}, notesOverflow }] = await Promise.all([chrome.storage.sync.get('notesParts'), chrome.storage.local.get(['notes', 'notesOverflow'])]);
  if (notesOverflow) return notesOverflow;
  const keys = Array.from({ length: notesParts }, (_, i) => `notes${i}`);
  const parts = keys.length ? await chrome.storage.sync.get(keys) : {};
  try {
    return { ...(keys.length ? JSON.parse(keys.map((k) => parts[k] ?? '').join('')) : {}), ...here };
  } catch {
    return null;
  }
}

/** Save all notes: synced if they fit, else on this device. */
export async function saveNotes(notes) {
  const parts = JSON.stringify(notes).match(new RegExp(`[\\s\\S]{1,${NOTE_PART}}`, 'gu')) || [];
  const items = Object.fromEntries(parts.map((part, i) => [`notes${i}`, part]));
  const stale = Object.keys(await chrome.storage.sync.get(null)).filter((k) => /^notes\d+$/.test(k) && !(k in items));
  try {
    await chrome.storage.sync.set({ ...items, notesParts: parts.length });
    if (stale.length) await chrome.storage.sync.remove(stale);
    await chrome.storage.local.remove(['notes', 'notesOverflow']);
  } catch {
    await chrome.storage.local.set({ notesOverflow: notes }); // over the sync quota (or its write limit): this device for now
  }
}

/** One person's note (empty text removes it). Skipped while the synced notes are half-arrived. */
export async function saveNote(key, text) {
  const notes = await loadNotes();
  if (!notes) return;
  if (text) notes[key] = text;
  else delete notes[key];
  await saveNotes(notes);
}

export async function clearNotes() {
  await chrome.storage.sync.remove(Object.keys(await chrome.storage.sync.get(null)).filter(isNotesKey));
  await chrome.storage.local.remove(['notes', 'notesOverflow']);
}

/* ---- Backup: your settings, friends, notes and emote history in a file, for another device or browser ---- */

const BACKUP_KIND = 'yapp-chat-backup';

/** The backup file's text. Sign-ins aren't in it: tokens shouldn't travel, and signing in takes one click. */
export function backupText({ settings, notes, emoteUse }, now = new Date()) {
  return `${JSON.stringify({ kind: BACKUP_KIND, version: 1, saved: now.toISOString(), settings, notes, emoteUse }, null, 2)}\n`;
}

/** A backup file's contents, checked: { settings (complete and valid), notes, emoteUse }. Throws if it isn't one. */
export function readBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Yapp Chat backup.");
  }
  if (data?.kind !== BACKUP_KIND || !data.settings || typeof data.settings !== 'object') throw new Error("That file isn't a Yapp Chat backup.");
  const record = (value, ok) => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([k, v]) => k && ok(v)));
  return {
    settings: normalizeSettings(data.settings),
    notes: record(data.notes, (v) => typeof v === 'string' && v.trim()),
    emoteUse: record(data.emoteUse, (v) => v && Number.isFinite(v.n) && Number.isFinite(v.at)),
  };
}
