/*
 * Above the chat, as on Twitch and Kick: a channel's prediction, its poll and its pinned message (Feed.pinned:
 * { pin, poll, prediction }, kept up to date by Feed.watchPinned; the shapes are lib/twitch.js parseTwitchPinned's).
 * To look at: voting and predicting stay on their sites. Each has a ✕ that puts it away (the next one shows again).
 */

import { formatCount } from './format.js';
import { icon } from './icons.js';
import { el, iconButton } from './ui.js';

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

/** A card: what it is (and whose, in a merged chat), its state, a ✕; `rows` under it. */
function card(pane, feed, kind, id, iconName, label, state, rows) {
  const box = el('div', `pin-card ${kind}`);
  const head = el('div', 'pin-head');
  if (pane.merged) head.append(pane.renderSource(feed));
  const hide = iconButton('x', 'Hide', () => {
    pane.unpinned.add(id);
    renderPinned(pane);
  });
  head.append(icon(iconName), el('strong', 'pin-kind', label), state, hide);
  box.append(head, ...rows);
  return box;
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

function predictionCard(pane, feed, p) {
  const total = p.outcomes.reduce((n, o) => n + o.points, 0);
  const state = p.status === 'active' ? countdown(p.locksAt, ' to predict', 'Locked') : el('span', 'pin-state', p.status === 'resolved' ? 'Result' : 'Locked');
  const rows = p.outcomes.map((o) => bar(o.title, share(o.points, total), `${formatCount(o.points)} points · ${formatCount(o.users)}`, { color: o.color, won: o.won, lost: p.status === 'resolved' && !o.won }));
  return card(pane, feed, 'prediction', p.id, 'trophy', 'Prediction', state, [el('div', 'pin-title', p.title), ...rows]);
}

function pollCard(pane, feed, p) {
  const most = Math.max(...p.choices.map((c) => c.votes));
  const state = p.ended ? el('span', 'pin-state', 'Ended') : countdown(p.endsAt, ' left', 'Ended');
  const rows = p.choices.map((c) => bar(c.title, share(c.votes, p.total), `${formatCount(c.votes)} vote${c.votes === 1 ? '' : 's'}`, { won: p.ended && most > 0 && c.votes === most, lost: p.ended && c.votes !== most }));
  return card(pane, feed, 'poll', p.id, 'chart', 'Poll', state, [el('div', 'pin-title', p.title), ...rows]);
}

function pinCard(pane, feed, pin) {
  const said = el('div', 'pin-message');
  said.append(pane.renderMessage(pin.message, feed)); // as a line of the chat: its emotes, the name opening their card
  return card(pane, feed, 'pin', pin.id, 'pin', 'Pinned', el('span', 'pin-state', pin.by ? `by ${pin.by}` : ''), [said]);
}

/** Draw what's above `pane`'s chat: for each of its channels the prediction, the poll, the pinned message, those not put away. */
export function renderPinned(pane) {
  const cards = [];
  const shown = (thing) => thing && !pane.unpinned.has(thing.id);
  if (pane.ctx.settings.showPinned) {
    for (const feed of pane.feeds) {
      const { pin, poll, prediction } = feed.pinned;
      if (shown(prediction)) cards.push(predictionCard(pane, feed, prediction));
      if (shown(poll)) cards.push(pollCard(pane, feed, poll));
      if (shown(pin)) cards.push(pinCard(pane, feed, pin));
    }
  }
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
