/*
 * The chat's tooltip (one, shared by every pane on the page): placing it, what it shows for an emote, a badge or
 * a channel's picture, and what a chat pane (lib/chat.js ChatPane) shows over a reply, a timestamp, a link and a
 * name (who it is, with their profile once the pointer has rested there). The pane's own listeners decide when;
 * these take the pane, as lib/card.js's do.
 */

import { formatAgo, formatCount, formatFullTime, formatMonth, readableColor } from './format.js';
import { kickCardUser } from './kick.js';
import { linkPreview } from './links.js';
import { twitchProfile } from './twitch.js';
import { el } from './ui.js';

/** Whose name a name's button is: its { user, feed } (ChatPane.nameButton), for what pointing at it shows. */
export const NAMED = new WeakMap();
/** The pointer rests on a name this long before their profile is asked for: moving across the chat asks nothing. */
const PEEK_AFTER = 300;
const kickPeeks = new Map(); // "channel:name" → Promise of who they are there, kept for the page's life

/**
 * Someone's public profile, for what pointing at their name shows: Twitch's (their picture, role, followers, when
 * they joined), or who they are in a Kick channel (their picture, how long they've subscribed and followed).
 * YouTube: none (their picture comes with their messages). Each asked once a page.
 */
function peekProfile(user, feed) {
  if (feed.platform === 'twitch' && user.login) return twitchProfile(user.login);
  if (feed.platform !== 'kick' || !user.name) return Promise.resolve(null);
  const key = `${feed.source.channel}:${user.name}`;
  if (!kickPeeks.has(key)) {
    const asked = kickCardUser(feed.source.channel, user.name, feed.kickChannel?.subBadges);
    asked.catch(() => kickPeeks.delete(key)); // try again next time
    kickPeeks.set(key, asked);
  }
  return kickPeeks.get(key);
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

export function emoteSource(url) {
  const { host } = new URL(url);
  return EMOTE_SOURCES[host] || (host.endsWith('.ggpht.com') ? 'YouTube' : '');
}

/** What a tooltip can be shown for, inside a chat list. */
export const TIP_TARGETS = '.emote-stack, .badge, .badge-pill, .msg-source, .reply-line, .thread-mark, a.link, .msg .name, .msg .ts, .fold-count';


let hoverTip = null;


/** Where the pointer is across the window (tooltips over wide things follow it). */
let pointerX = 0;
document.addEventListener('pointermove', (e) => (pointerX = e.clientX), { passive: true });
/** The pointer's place, as an event that came before the move was heard has it (a hover's). */
export function notePointer(x) {
  pointerX = x;
}

/**
 * Show `nodes` in the tooltip, above `target` (below it near the top), inside
 * the window: centred on small targets (emotes, badges), at the pointer over
 * wide ones (a reply line or a long link across a wide window).
 */
export function placeTip(target, kind, nodes) {
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
export function showTip(target) {
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

/** Away with the tooltip (`kind`: only if it's one of that kind). */
export function hideTip(kind) {
  if (hoverTip && (!kind || hoverTip.dataset.kind === kind)) hoverTip.hidden = true;
}

/**
 * Over a reply's quote, a preview of its conversation: the message it started with (or its quote, gone from the
 * chat) and the two replies up to the one you point at, marked; "+N more", and that a click shows it all.
 * Over an answered message's mark (.thread-mark): the same, with the two newest replies.
 */
export function showReplyTip(pane, target) {
  const line = pane.lineOf(target);
  if (!line) return;
  const m = line.message;
  const { root, lines } = pane.conversation(m, line.feed);
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
  const rows = [first ? lineRow(first) : row(quoted.replyTo, pane.repliedColor(quoted, line.feed), el('span', '', quoted.replyBody || '…'), false)];
  const replies = lines.filter((l) => l !== first);
  const shown = replies.slice(0, target.classList.contains('thread-mark') ? replies.length : replies.indexOf(line) + 1).slice(-2);
  rows.push(...shown.map(lineRow));
  const more = replies.length - shown.length;
  const hint = el('span', 'tip-source', `${more > 0 ? `+${more} more · ` : ''}Click for the thread`);
  placeTip(target, 'reply', [el('span', 'tip-source', 'Thread'), ...rows, hint]);
}

/** Over a timestamp: when exactly the message was sent. */
export function showTimeTip(pane, target) {
  const line = pane.lineOf(target);
  if (!line?.message.time) return;
  placeTip(target, 'time', [el('strong', '', formatFullTime(line.message.time)), el('span', 'tip-source', formatAgo(line.message.time))]);
}

/**
 * Over a name: who it is. At once what the chat knows (their name as it shows here with its badges, their real
 * one behind a nickname, how much they've written lately, when this message was sent); and once the pointer rests
 * there, their picture and what their profile says (peekProfile).
 */
export function showNameTip(pane, target) {
  const { user, feed } = NAMED.get(target) || {};
  if (!user) return;
  const line = pane.lineOf(target);
  placeTip(target, 'name', namePeek(pane, user, feed, line, null));
  clearTimeout(pane.peekTimer);
  pane.peekTimer = setTimeout(async () => {
    if (pane.tipTarget !== target) return;
    const profile = await peekProfile(user, feed).catch(() => null);
    if (profile && pane.tipTarget === target) placeTip(target, 'name', namePeek(pane, user, feed, line, profile));
  }, PEEK_AFTER);
}

/** What showNameTip shows of `user`, the name pointed at being in `line` (if in one); `profile`: peekProfile's, once it's there. */
function namePeek(pane, user, feed, line, profile) {
  const photo = profile?.photo || user.photo;
  const picture = el(photo ? 'img' : 'span', 'peek-photo', photo ? null : (user.name || '?')[0].toUpperCase());
  if (photo) Object.assign(picture, { src: photo, alt: '' });
  const name = pane.nameButton(user, feed);
  pane.paintName(name, feed.platform, user.id);
  const names = el('div', 'peek-name');
  const badges = pane.ctx.settings.badges ? pane.renderBadges(user.badges || [], feed, pane.cosmeticBadges(feed.platform, user.id)) : null;
  names.append(...(badges?.childElementCount ? [badges] : []), name);
  // Their real name behind your nickname for them; else their login, when it reads differently (a name in another script).
  const login = user.login && user.login !== user.name.toLowerCase() ? `@${user.login}` : '';
  const also = name.title || login;
  const months = (n) => `${n} month${n === 1 ? '' : 's'}`;
  const facts = [
    pane.isFriend(user) && 'Friend',
    profile?.role,
    profile?.followers != null && `${formatCount(profile.followers)} followers`,
    profile?.createdAt && `Joined ${formatMonth(profile.createdAt)}`,
    profile?.subMonths > 0 && `Subscribed ${months(profile.subMonths)}`,
    profile?.followingSince && `Following since ${formatMonth(profile.followingSince)}`,
  ].filter(Boolean);
  // Each fact whole: the line breaks between them.
  const told = el('span', 'peek-facts');
  told.append(...facts.flatMap((fact, i) => [...(i ? [' · '] : []), el('span', '', fact)]));
  const who = el('div', 'peek-who');
  who.append(names, ...(also ? [el('span', 'tip-source', also)] : []), ...(facts.length ? [told] : []));
  const head = el('div', 'peek-head');
  head.append(picture, who);
  const written = pane.lines.filter((l) => l.feed === feed && (user.id ? l.message.user.id === user.id : l.message.user.login === user.login)).length;
  const rows = [
    line?.message.time && `${formatFullTime(line.message.time)} · ${formatAgo(line.message.time)}`,
    written > 1 && `${written} messages here lately`,
  ].filter(Boolean);
  return [head, ...rows.map((text) => el('span', 'tip-source', text))];
}

/** A YouTube video or Twitch clip link: its thumbnail, title and channel. */
export async function showLinkTip(pane, link) {
  const preview = await linkPreview(link.href);
  if (!preview || pane.tipTarget !== link) return; // nothing to show, or the pointer moved on
  const text = el('div', 'tip-link');
  text.append(el('strong', '', preview.title), el('span', 'tip-source', [preview.by, preview.meta].filter(Boolean).join(' · ')));
  if (!preview.thumbnail) return placeTip(link, 'link', [text]); // none (a video of a stream still going)
  const thumb = el('img', preview.round ? 'tip-thumb round' : 'tip-thumb'); // round: a channel's picture
  thumb.alt = '';
  thumb.addEventListener('error', () => thumb.remove()); // a picture that won't load: the text alone
  thumb.src = preview.thumbnail;
  placeTip(link, 'link', [thumb, text]);
}
