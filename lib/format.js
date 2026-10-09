/*
 * Message text into parts (text, emotes, links, mentions), readable name
 * colours, and highlights. Pure; unit-tested.
 *
 * Part: { type: 'text', text } | { type: 'emote', name, url, zeroWidth? }
 *     | { type: 'link', text, href } | { type: 'mention', text }
 */

const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/**
 * Split text into words and turn each into an emote (from `emotes`, a Map of
 * name → { url, zeroWidth }), a link, a mention, or plain text. Whitespace is
 * kept as text so spacing survives.
 */
export function tokenize(text, emotes = new Map()) {
  const parts = [];
  const pushText = (t) => {
    const last = parts.at(-1);
    if (last?.type === 'text') last.text += t;
    else parts.push({ type: 'text', text: t });
  };
  for (const piece of text.split(/(\s+)/)) {
    if (!piece) continue;
    if (/^\s+$/.test(piece)) {
      pushText(piece);
      continue;
    }
    const emote = emotes.get(piece);
    if (emote) parts.push({ type: 'emote', name: piece, url: emote.url, zeroWidth: Boolean(emote.zeroWidth) });
    else if (/^@\w+/.test(piece)) parts.push({ type: 'mention', text: piece });
    else if (URL_RE.test(piece) && /[a-z]/i.test(piece.split('.').pop())) {
      parts.push({ type: 'link', text: piece, href: /^https?:\/\//i.test(piece) ? piece : `https://${piece}` });
    } else pushText(piece);
  }
  return parts;
}

/**
 * Twitch text with its native emotes (ranges in code points) replaced, the
 * rest tokenized. `emoteUrl(id)` gives a native emote's image.
 */
export function twitchParts(text, nativeEmotes, thirdParty, emoteUrl) {
  const chars = [...text];
  const parts = [];
  let pos = 0;
  for (const { id, start, end } of nativeEmotes) {
    if (start < pos || end >= chars.length) continue;
    if (start > pos) parts.push(...tokenize(chars.slice(pos, start).join(''), thirdParty));
    parts.push({ type: 'emote', name: chars.slice(start, end + 1).join(''), url: emoteUrl(id) });
    pos = end + 1;
  }
  if (pos < chars.length) parts.push(...tokenize(chars.slice(pos).join(''), thirdParty));
  return parts;
}

/**
 * "Cheer100"-style words (a cheermote prefix and an amount) in text parts
 * become { type: 'cheer', name, amount, cheermote }. `cheermotes`: Map
 * lowercase prefix → cheermote (lib/twitch.js parseCheermotes).
 */
export function cheerParts(parts, cheermotes) {
  if (!cheermotes?.size) return parts;
  const out = [];
  const pushText = (text) => {
    const last = out.at(-1);
    if (last?.type === 'text') last.text += text;
    else out.push({ type: 'text', text });
  };
  for (const part of parts) {
    if (part.type !== 'text') {
      out.push(part);
      continue;
    }
    for (const piece of part.text.split(/(\s+)/)) {
      const m = /^([a-z]+)(\d+)$/i.exec(piece);
      const cheermote = m && cheermotes.get(m[1].toLowerCase());
      if (cheermote) out.push({ type: 'cheer', name: piece, amount: Number(m[2]), cheermote });
      else if (piece) pushText(piece);
    }
  }
  return out;
}

// Characters that show as nothing, which some chat apps add so Twitch takes the same message twice in a row (U+E0000),
// and other zero-width ones.
const INVISIBLE = /[\u00ad\u034f\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2060-\u2064\u206a-\u206f\u3164\ufeff\uffa0\u{e0000}-\u{e007f}]/gu;

/**
 * A word as folding compares it: stretched letters once ("deadddd", "GOOOO", "😂😂😂"; not digits: 1000 isn't 10),
 * and without a plural s ("stairs").
 */
const foldWord = (word) => word.replace(/(\P{N})\1{2,}/gu, '$1').replace(/^(.{3,})s$/u, '$1');

/**
 * Messages that count as "the same" for folding repeats: case, spacing, punctuation and invisible characters
 * don't matter, nor stretched letters or a plural s, and a word over and over is one run however long ("KEKW KEKW
 * KEKW" is "KEKW KEKW"). Punctuation counts when it's all there is ("???"); a word spelled out is the word ("k e y").
 */
export function foldKey(text) {
  const clean = String(text || '').replace(INVISIBLE, '').toLowerCase();
  const bare = clean.replace(/\p{P}+/gu, ' ');
  const runs = (list) => list.filter((word, i) => word !== list[i - 1]);
  let words = runs((bare.trim() ? bare : clean).split(/\s+/).filter(Boolean));
  if (words.length > 1 && words.every((word) => [...word].length === 1)) words = [words.join('')];
  return runs(words.map(foldWord)).join(' ');
}

/** How long a message looks: its characters without the invisible ones and surrounding space. */
export const visibleLength = (text) => [...String(text || '').replace(INVISIBLE, '').trim()].length;

/**
 * Two fold keys one letter apart (one typed wrong, missing or extra: "all 3 are ther"), in longer messages only.
 * Not a digit: "rank 1" and "rank 2" say different things.
 */
export function nearlySame(a, b) {
  if (a === b || Math.min(a.length, b.length) < 8 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (a[i] === b[i]) i++;
  if (/\d/.test(a[i] || '') || /\d/.test(b[i] || '')) return false;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
}

// Little words that don't say what a message is about, left out when comparing messages for "similar".
// (As foldKey leaves them: "this" is "thi" there, and "it's" is "it" and "s".)
const SMALL_WORDS = new Set('a an the is are was were be been it its s this that i im you u ur your we they he she me my to of in on at and or so but just'.split(' ').map(foldWord));

/** The words of a fold key that say something, for "Fold similar messages" (all of them if that's all it has). */
export function foldWords(key) {
  const words = key.split(' ').filter(Boolean);
  const meaningful = words.filter((word) => !SMALL_WORDS.has(word));
  return new Set(meaningful.length ? meaningful : words);
}

/**
 * Messages that mostly say the same ("all 3 dead", "ALL 3 DED", "all 3 on stairs"): two or more words in common,
 * and at least half of all their words, or every word of the shorter one. One word in common isn't enough: a
 * one-word reaction ("sums") would pull in anything with that word ("sum is right"). `a` and `b` from foldWords.
 */
export function similarWords(a, b) {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  if (shared === 1 && a.size === 1 && b.size === 1) return true; // the same one word ("sums", "the sum")
  if (shared < 2) return false;
  return shared / (a.size + b.size - shared) >= 0.5 || shared === Math.min(a.size, b.size);
}

/* ---- Name colours ---- */

/** Twitch's colours for users who never picked one. */
const DEFAULT_COLORS = [
  '#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57',
  '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F',
];

function hashName(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

let lightTheme = false;

/** Name colours for the light theme (darkened) or the dark one (lightened). */
export function setNameTheme(light) {
  lightTheme = light;
}

/**
 * The user's colour, made readable on the background: on dark, dark colours
 * (navy, dark red…) are lightened; on light, light ones
 * (yellow, lime…) are darkened.
 */
export function readableColor(color, name, light = lightTheme) {
  const hex = /^#[0-9a-f]{6}$/i.test(color || '') ? color : DEFAULT_COLORS[hashName(name || '') % DEFAULT_COLORS.length];
  const [h, s, l] = hexToHsl(hex);
  const lightness = light ? Math.min(l, 0.4) : Math.max(l, 0.62);
  return `hsl(${Math.round(h)} ${Math.round(Math.min(s, 0.9) * 100)}% ${Math.round(lightness * 100)}%)`;
}

/* ---- Highlights ---- */

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A test for "this message is for you": your name (if signed in) and your
 * highlight words, as whole words, any case. Null when there's nothing to match.
 */
export function highlighter(words) {
  const list = words.map((w) => w.trim()).filter(Boolean);
  if (!list.length) return null;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])(${list.map(escapeRe).join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'iu');
  return (text) => re.test(text);
}

/* ---- Live info ---- */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** Viewer counts: 834, 1.1K, 26.5K, 1.2M. */
export const formatCount = (n) => (n < 1000 ? String(n) : compact.format(n));

/** How long a stream has been live: "45m", "2h 14m", "6d 2h". */
export function formatUptime(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/* ---- Time ---- */

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS = [
  ['year', 365 * 864e5],
  ['month', 30 * 864e5],
  ['day', 864e5],
  ['hour', 36e5],
  ['minute', 6e4],
];

/** "7 years ago", "last month", "yesterday", "5 minutes ago", "just now". */
export function formatAgo(ms, now = Date.now()) {
  const elapsed = now - ms;
  const unit = UNITS.find(([, size]) => elapsed >= size);
  return unit ? relative.format(-Math.floor(elapsed / unit[1]), unit[0]) : 'just now';
}

/** A day heading in a list of older messages: "Today", "Yesterday", "Tue, Sep 29", "Sep 29, 2025". */
export function formatDay(ms, now = Date.now()) {
  const day = new Date(ms).setHours(0, 0, 0, 0);
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (day === today) return 'Today';
  if (day === today - 864e5 || day === new Date(today - 864e5).setHours(0, 0, 0, 0)) return 'Yesterday';
  return new Date(ms).getFullYear() === new Date(now).getFullYear() ? weekdayDay.format(ms) : dayMonthYear.format(ms);
}
const weekdayDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const fullTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
/** A message's exact time: "Tue, Oct 7, 11:42:05". */
export const formatFullTime = (ms) => fullTime.format(ms);

/** A timeout's length: "30 seconds", "10 minutes", "1 hour", "7 days". */
export function formatDuration(seconds) {
  const [n, unit] =
    seconds < 60 ? [seconds, 'second'] : seconds < 3600 ? [Math.round(seconds / 60), 'minute'] : seconds < 86400 ? [Math.round(seconds / 3600), 'hour'] : [Math.round(seconds / 86400), 'day'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

const dayMonthYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const month = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
/** "Aug 2015". */
export const formatMonth = (ms) => month.format(ms);

// 24-hour "09:16": short enough for a chat column.
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const formatClock = (ms) => clock.format(ms);
