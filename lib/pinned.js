/*
 * Above the chat, as on Twitch, Kick and YouTube: a channel's hype train, its prediction, its poll and its pinned
 * message (Feed.pinned: { pin, poll, prediction, hype }, kept up to date by Feed.watchPinned and the chats' own
 * 'pin' events; the shapes are lib/twitch.js parseTwitchPinned's).
 * To look at. A vote or a prediction is made on its own site: neither Twitch nor Kick lets another app do it for
 * you (Twitch has no such request for apps, and both take it only from their own page's sign-in), so a running poll
 * or prediction has a button that opens the platform's chat in a small window, where it's one click.
 * Each has a ✕ that puts it away (the next one shows again) and folds to one line (pane.pinFolds). YouTube: its
 * pinned message.
 */

import { formatCount } from './format.js';
import { icon } from './icons.js';
import { PLATFORM_NAMES } from './sources.js';
import { button, el, iconButton } from './ui.js';
import { openBeside } from './window.js';

/** Milliseconds as "1:05". */
const clock = (ms) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** A part of the whole as a percentage (0 while there's nothing yet). */
const share = (part, total) => (total ? Math.round((part / total) * 100) : 0);

/** Time running down to `until` ("1:05 left"), then `after` ("Ended"): renderPinned's ticker keeps it going. */
function countdown(until, suffix, after) {
  const node = el('span', 'pin-state');
  Object.assign(node.dataset, { until, suffix, after });
  return node;
}

/**
 * A card: what it is (and whose, in a combined chat), its state, ⌄ to fold it to one line and ✕; `rows` under it.
 * Folded, its head also says `summary` (the question and what leads, what was pinned: text or nodes) and the rows
 * are hidden.
 */
function card(pane, feed, kind, thing, folded, { iconName, label, state, summary, rows }) {
  const box = el('div', `pin-card ${kind}${folded ? ' folded' : ''}`);
  const head = el('div', 'pin-head');
  if (pane.merged) head.append(pane.renderSource(feed));
  const fold = () => {
    pane.pinFolds.set(thing.id, !folded);
    renderPinned(pane);
  };
  const hide = iconButton('x', 'Hide', () => {
    pane.unpinned.add(thing.id);
    renderPinned(pane);
  });
  const toggle = iconButton('chevron-down', folded ? 'Show all of it' : 'Fold to one line', fold);
  toggle.classList.add('pin-fold');
  toggle.setAttribute('aria-expanded', String(!folded));
  const gist = el('span', 'pin-summary');
  gist.append(...[summary].flat());
  head.append(icon(iconName), el('strong', 'pin-kind', label), state, gist, toggle, hide);
  // Anywhere on its head folds and unfolds it, but on its buttons (the name of who pinned it too).
  head.addEventListener('click', (e) => !e.target.closest('button') && fold());
  box.append(head, ...rows);
  return box;
}

/**
 * To vote or predict: the platform's own chat in a small window (the poll or prediction is at its top there), as
 * "Write on YouTube" opens YouTube's.
 */
function goThere(feed, verb) {
  const go = button('link-btn pin-go', `${verb} on ${PLATFORM_NAMES[feed.platform]}`, () => openBeside(feed.ownChatUrl));
  go.title = `Opens ${PLATFORM_NAMES[feed.platform]}'s chat in a small window: ${verb.toLowerCase()} there`;
  go.append(icon('external'));
  return go;
}

/** One choice of a poll or outcome of a prediction: its name, how many, and its share as the row's fill. */
function bar(title, percent, detail, { color = '', won = false, lost = false } = {}) {
  const row = el('div', `pin-bar${won ? ' won' : ''}${lost ? ' lost' : ''}`);
  if (color) row.dataset.color = color;
  row.style.setProperty('--share', `${percent}%`);
  const name = el('span', 'pin-bar-title', title);
  if (won) name.prepend(icon('verified'));
  row.append(name, el('span', 'pin-bar-detail', detail), el('strong', 'pin-bar-share', `${percent}%`));
  return row;
}

/** A question and what leads (or won), for a folded card: "Next game? · Chess 75%". */
function leading(title, choices, total) {
  const top = choices.find((c) => c.won) || choices.reduce((a, b) => (b.amount > a.amount ? b : a));
  return total ? `${title} · ${top.title} ${share(top.amount, total)}%` : title;
}

function predictionCard(pane, feed, p, folded) {
  const total = p.outcomes.reduce((n, o) => n + o.points, 0);
  const state = p.status === 'active' ? countdown(p.locksAt, ' to predict', 'Locked') : el('span', 'pin-state', p.status === 'resolved' ? 'Result' : 'Locked');
  const rows = p.outcomes.map((o) => bar(o.title, share(o.points, total), `${formatCount(o.points)} points · ${formatCount(o.users)}`, { color: o.color, won: o.won, lost: p.status === 'resolved' && !o.won }));
  const summary = leading(p.title, p.outcomes.map((o) => ({ title: o.title, amount: o.points, won: o.won })), total);
  return card(pane, feed, 'prediction', p, folded, { iconName: 'trophy', label: 'Prediction', state, summary, rows: [el('div', 'pin-title', p.title), ...rows, ...(p.status === 'active' ? [goThere(feed, 'Predict')] : [])] });
}

function pollCard(pane, feed, p, folded) {
  const most = Math.max(...p.choices.map((c) => c.votes));
  const state = p.ended ? el('span', 'pin-state', 'Ended') : countdown(p.endsAt, ' left', 'Ended');
  const rows = p.choices.map((c) => bar(c.title, share(c.votes, p.total), `${formatCount(c.votes)} vote${c.votes === 1 ? '' : 's'}`, { won: p.ended && most > 0 && c.votes === most, lost: p.ended && c.votes !== most }));
  const summary = leading(p.title, p.choices.map((c) => ({ title: c.title, amount: c.votes })), p.total);
  return card(pane, feed, 'poll', p, folded, { iconName: 'chart', label: 'Poll', state, summary, rows: [el('div', 'pin-title', p.title), ...rows, ...(p.ended ? [] : [goThere(feed, 'Vote')])] });
}

/**
 * A pinned message: who pinned it in the head, as in the chat (badges, the name opening their card), and under it what
 * was said. Their own message: only its text (the head names them); someone else's: as its line of the chat.
 * Folded, its one line is the message itself, "name: what they said" (the pin says the rest), with its emotes.
 */
function pinCard(pane, feed, pin, folded) {
  const { by, message } = pin;
  const state = el('span', 'pin-state');
  if (by) {
    state.append('by ');
    if (pane.ctx.settings.badges && by.badges.length) state.append(pane.renderBadges(by.badges, feed));
    state.append(pane.nameButton(by, feed));
  }
  const body = () => {
    const span = el('span', 'body');
    pane.renderParts(span, pane.messageParts(message, feed));
    return span;
  };
  const said = el('div', 'pin-message');
  const own = by && (by.id ? by.id === message.user.id : by.login === message.user.login);
  said.append(own ? body() : pane.renderMessage(message, feed));
  return card(pane, feed, 'pin', pin, folded, { iconName: 'pin', label: 'Pinned', state, summary: folded ? [pane.nameButton(message.user, feed), ': ', body()] : '', rows: [said] });
}

/** A hype train: its level, how far along it is, and the time left to reach the next. */
function hypeCard(pane, feed, train, folded) {
  const percent = Math.min(100, share(train.points, train.goal));
  const summary = `Level ${train.level} · ${percent}%`;
  const rows = [bar(`Level ${train.level}`, percent, `${formatCount(train.points)} / ${formatCount(train.goal)}`)];
  return card(pane, feed, 'hype', train, folded, { iconName: 'flame', label: 'Hype Train', state: countdown(train.endsAt, ' left', 'Over'), summary, rows });
}

const CARDS = { hype: hypeCard, prediction: predictionCard, poll: pollCard, pin: pinCard };

/**
 * Draw what's above `pane`'s chat: for each of its channels the hype train, the prediction, the poll, the pinned
 * message, those not put away. Three or more: the pinned messages come folded to one line (they wait; the others
 * run), unless you chose.
 */
export function renderPinned(pane) {
  const things = []; // [feed, kind, thing]
  if (pane.ctx.settings.showPinned) {
    for (const feed of pane.feeds) {
      for (const kind of ['hype', 'prediction', 'poll', 'pin']) {
        const thing = feed.pinned[kind];
        if (thing && !pane.unpinned.has(thing.id)) things.push([feed, kind, thing]);
      }
    }
  }
  const cards = things.map(([feed, kind, thing]) => CARDS[kind](pane, feed, thing, pane.pinFolds.get(thing.id) ?? (things.length >= 3 && kind === 'pin')));
  pane.pinnedEl.replaceChildren(...cards);
  pane.pinnedEl.hidden = !cards.length;
  // The countdowns, every second while there's one.
  clearInterval(pane.pinnedTimer);
  const running = [...pane.pinnedEl.querySelectorAll('[data-until]')];
  const tick = () => {
    for (const node of running) {
      const left = Number(node.dataset.until) - Date.now();
      node.textContent = left > 0 ? `${clock(left)}${node.dataset.suffix}` : node.dataset.after;
    }
  };
  tick();
  if (running.length) pane.pinnedTimer = setInterval(tick, 1000);
}
