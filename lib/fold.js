/*
 * Folding repeated and similar messages into one line ("×12", "×9 similar") in a chat pane (lib/chat.js ChatPane):
 * what a message folds by and into, the wave of a word that takes off, the count on the line and its tooltip. The
 * pane keeps the state (its lines, `recent`, `heat`); these take the pane, as lib/card.js's do. The words
 * themselves (foldKey, foldWords, nearlySame, similarWords) are lib/format.js's.
 */

import { foldKey, foldWords, nearlySame, readableColor, similarWords, visibleLength } from './format.js';
import { isModeration } from './notices.js';
import { placeTip } from './tips.js';
import { el, platformTile } from './ui.js';

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

/**
 * What a line folds by into "×2", or '': plain chat lines (not your own,
 * replies, cheers or notices) by their text; timeouts and bans by who and how long.
 */
function foldable(message) {
  if (isModeration(message)) return `${message.event.type} ${message.user.login} ${message.event.duration || ''}`;
  return message.kind === 'chat' && !message.event && !message.replyTo && !message.own && !message.highlighted && !message.rewardId ? foldKey(message.text) : '';
}

/**
 * Where `message` folds into, or null: { line, similar }. The same message (or timeout) here within a minute of
 * its last repeat; a chat message also into a line close by (the last 80) one letter apart (a typo), or, with
 * Settings → Fold similar messages, into one that mostly says the same within 30 seconds (similar: true). A chat
 * message folds across a merged chat's channels (a simulcast's "W" from Twitch, Kick and YouTube is one line); a
 * timeout only within its channel.
 */
export function foldTarget(pane, message, feed) {
  const key = pane.ctx.settings.foldRepeats && foldable(message);
  if (!key) return null;
  const anyFeed = !isModeration(message);
  // Not into a deleted (struck-through) line: what's said again isn't deleted.
  const near = (line, ms) =>
    (anyFeed || line.feed === feed) && line.foldKey && !line.gone && !line.node.classList.contains('deleted') && Math.abs(message.time - line.lastTime) <= ms;
  const words = pane.ctx.settings.foldSimilar && message.kind === 'chat' && foldWords(key);
  const counts = words && noteWords(pane, words, message.time);
  const same = pane.recent.get(recentKey(message, feed, key));
  if (same && near(same, 60_000)) return { line: same, similar: false };
  if (isModeration(message)) return null;
  // A wave's word is enough between short reactions (WAVE_SHORT: "you need the key", "THE KEY PEA").
  const said = words && pane.heat.said.length; // messages here in the last 30 s
  const wave = words && words.size <= WAVE_SHORT ? [...words].filter((word) => counts.get(word) >= Math.max(WAVE_WORD, said * WAVE_SHARE)) : [];
  const alike = (other) => similarWords(words, other) || (other.size <= WAVE_SHORT && wave.some((word) => other.has(word)));
  let similar = null;
  for (let i = pane.lines.length - 1; i >= Math.max(0, pane.lines.length - 80); i--) {
    const line = pane.lines[i];
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
function noteWords(pane, words, time) {
  const { heat } = pane;
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
function recentKey(message, feed, key) {
  return `${isModeration(message) ? feed.key : 'chat'} ${key}`;
}

/** Remember `line` for its repeats to fold into (under `key`, its own fold key unless it's a variant's). */
export function noteFoldable(pane, line, key = pane.ctx.settings.foldRepeats && foldable(line.message)) {
  if (!key) return;
  line.foldKey ??= key;
  if (line.message.kind === 'chat') (line.wordSets ??= []).push(foldWords(key)); // what "similar" compares with
  pane.recent.set(recentKey(line.message, line.feed, key), line);
  if (pane.recent.size > 500) pane.recent.delete(pane.recent.keys().next().value);
}

/**
 * Count `message` on `line` ("×12", or "×9 similar"; a short pop as it grows when `live`), with who sent what
 * (its tooltip: the senders, or each version of a similar one and who sent it).
 */
export function foldInto(pane, line, message, live, similar) {
  line.count = (line.count || 1) + 1;
  line.lastTime = Math.max(line.lastTime, message.time);
  line.similar ||= similar;
  (line.folded ??= []).push(message.id); // forgotten with the line (trim)
  line.senders ??= new Map(line.message.user?.name ? [[senderKey(sender(line.message)), sender(line.message)]] : []);
  if (message.user?.name) line.senders.set(senderKey(sender(message)), sender(message));
  if (line.message.kind === 'chat') {
    line.variants ??= new Map([[line.foldKey, versionOf(line.message)]]);
    const key = foldable(message);
    const variant = line.variants.get(key) || [...line.variants].find(([other]) => nearlySame(key, other))?.[1]; // a typo of one
    if (variant) {
      variant.senders.push(sender(message));
      // A similar group shows each version in its plainest wording ("the key", not "the key!!!!!!!!"); a repeat keeps its first sender.
      if (line.similar && noise(message.text) < noise(variant.text)) Object.assign(variant, { text: message.text, message });
    } else {
      line.variants.set(key, versionOf(message));
      if (line.wordSets.length < 8) noteFoldable(pane, line, key); // its exact repeats fold here at once, and it's compared with too
    }
  }
  showFold(pane, line, live);
}

/**
 * A wave's word took off: the short lines with it from the last 30 s (on their own so far) fold into `line`.
 * Not while the chat is held (nothing goes from under you).
 */
export function gather(pane, line, word) {
  if (pane.hovering) return;
  for (const other of pane.lines.slice(-80)) {
    if (other === line || other.gone || other.message.kind !== 'chat' || !other.foldKey) continue;
    if (other.node.classList.contains('deleted')) continue; // stays struck through, on its own
    if (Math.abs(other.lastTime - line.lastTime) > 30_000 || !other.wordSets.some((set) => set.size <= WAVE_SHORT && set.has(word))) continue;
    const versions = other.variants || new Map([[other.foldKey, versionOf(other.message)]]);
    for (const [key, version] of versions) {
      const mine = line.variants.get(key);
      if (mine) mine.senders.push(...version.senders);
      else line.variants.set(key, version);
      pane.recent.set(recentKey(line.message, line.feed, key), line);
    }
    line.count = (line.count || 1) + (other.count || 1);
    line.folded = [...(line.folded || []), other.message.id, ...(other.folded || [])];
    for (const who of other.senders?.values() || [sender(other.message)]) if (who.user?.name) line.senders.set(senderKey(who), who);
    if (line.wordSets.length < 8) line.wordSets.push(...other.wordSets.slice(0, 8 - line.wordSets.length));
    other.gone = true;
    other.node.remove();
    pane.lines.splice(pane.lines.indexOf(other), 1);
  }
  showFold(pane, line, false);
}

/** "×N" (or "×N similar") on `line`, louder as it grows, a pop when `live`; and its most-sent version as its face. */
function showFold(pane, line, live) {
  // The line shows its most-sent version, as its first sender sent it (not while it's held: nothing changes under you).
  if (line.variants && !pane.hovering) {
    const versions = [...line.variants.values()];
    const top = versions.reduce((a, b) => (b.senders.length > a.senders.length ? b : a));
    const face = versions.find((v) => v.message === line.message);
    if (top !== face && top.senders.length > (face?.senders.length || 0)) {
      line.message = top.message;
      pane.redrawLine(line);
    }
  }
  let badge = line.node.querySelector('.fold-count');
  if (!badge) badge = (line.node.querySelector('.notice-head') || line.node).appendChild(el('span', 'fold-count'));
  badge.textContent = line.similar ? `×${line.count} similar` : `×${line.count}`;
  badge.dataset.level = foldLevel(line.count);
  badge.classList.toggle('similar', line.similar);
  if (live && !reducedMotion.matches) badge.animate([{ transform: 'scale(1.35)' }, { transform: 'none' }], { duration: 250, easing: 'ease-out' });
  if (pane.tipTarget === badge) showFoldTip(pane, badge); // its tooltip is open: keep it up to date
}

/**
 * The same message again within a minute (copypasta): count it on the line
 * that's already there ("×12") and move that line to the bottom. True if folded.
 */
export function fold(pane, message, feed, fragment) {
  const { line, similar, wave } = foldTarget(pane, message, feed) || {};
  if (!line) return false;
  foldInto(pane, line, message, true, similar);
  if (wave) gather(pane, line, wave);
  line.node.classList.remove('history'); // said again just now
  if (pane.hovering) return true; // held: the count goes up where it is (it could be what you're pointing at)
  if (pane.actions.parentNode === line.node) pane.actions.remove(); // it moves away from under the pointer
  pane.lines.splice(pane.lines.indexOf(line), 1);
  pane.lines.push(line);
  fragment.append(line.node); // moves it
  return true;
}

/**
 * Over "×12": how many times, and who sent it (the first eight, in their colours). Over "×9 similar": each
 * version (the first six, most sent first) and who sent it.
 */
export function showFoldTip(pane, target) {
  const line = pane.lineOf(target);
  if (!line) return;
  // Who: each once, in their colour; with their platform's tile in a chat merging platforms.
  const names = (senders, max) => {
    const unique = [...new Map(senders.map((who) => [senderKey(who), who])).values()];
    const row = el('div', 'tip-names');
    unique.slice(0, max).forEach(({ user, platform }, i) => {
      const name = el('span', 'tip-name', user.name);
      name.style.color = readableColor(user.color, user.login || user.name);
      if (pane.mixed) name.prepend(platformTile(platform));
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
