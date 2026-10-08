/*
 * Mentions inbox: messages that mention you (or your highlight words), from
 * every open chat, kept for this browser session (chrome.storage.session, so
 * the side panel and the chat window share it). background.js shows the
 * unread count on the toolbar icon.
 */

import { formatClock, readableColor } from './format.js';
import { icon } from './icons.js';
import { el } from './ui.js';

const MAX = 100;

let saving = Promise.resolve(); // one read-and-write at a time: two mentions at once both count

/** Record a mention: { id, source, label, user: { name, login, color }, text, time }. */
export function addMention(entry) {
  saving = saving.then(async () => {
    const { mentions = [], unread = 0 } = await chrome.storage.session.get(['mentions', 'unread']);
    if (mentions.some((m) => m.id === entry.id)) return; // the same chat open in two places
    await chrome.storage.session.set({ mentions: [entry, ...mentions].slice(0, MAX), unread: unread + 1 });
  }).catch(() => {});
  return saving;
}

/**
 * The 🔔 button for a header: the unread count on it, and a list of your
 * mentions under it. `onOpen(source)` opens the chat a mention came from.
 */
export function mentionsButton({ onOpen }) {
  const btn = el('button', 'btn btn-ghost btn-sm btn-icon mentions-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Mentions');
  btn.setAttribute('aria-haspopup', 'dialog');
  const count = el('span', 'mentions-count');
  count.hidden = true;
  btn.append(icon('bell'), count);

  const pop = el('div', 'mentions-pop');
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Mentions');
  document.body.append(pop);
  btn.setAttribute('aria-expanded', 'false');
  /** Open or close the list (and say so to screen readers). */
  const setOpen = (open) => {
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };

  const render = async () => {
    const { mentions = [], unread = 0 } = await chrome.storage.session.get(['mentions', 'unread']);
    count.hidden = !unread;
    count.textContent = unread > 99 ? '99+' : String(unread);
    btn.setAttribute('aria-label', unread ? `Mentions, ${unread} new` : 'Mentions');
    if (pop.hidden) return;
    const head = el('div', 'mentions-head');
    head.append(el('strong', '', 'Mentions'));
    if (mentions.length) {
      const clear = el('button', 'link-btn', 'Clear');
      clear.type = 'button';
      clear.addEventListener('click', () => chrome.storage.session.set({ mentions: [], unread: 0 }));
      head.append(clear);
    }
    const list = el('div', 'mentions-list');
    for (const m of mentions) {
      const row = el('button', 'mention-row');
      row.type = 'button';
      const top = el('div', 'mention-top');
      const name = el('strong', '', m.user.name);
      name.style.color = readableColor(m.user.color, m.user.login || m.user.name);
      top.append(name, el('span', 'mention-where', `in ${m.label} · ${formatClock(m.time)}`));
      row.append(top, el('div', 'mention-text', m.text));
      row.addEventListener('click', () => {
        setOpen(false);
        onOpen(m.source);
      });
      list.append(row);
    }
    if (!mentions.length) list.append(el('p', 'mentions-empty', 'When someone mentions you (or one of your highlight words), it shows up here.'));
    pop.replaceChildren(head, list);
  };

  btn.addEventListener('click', () => {
    setOpen(pop.hidden);
    if (!pop.hidden) {
      const r = btn.getBoundingClientRect();
      pop.style.top = `${r.bottom + 6}px`;
      pop.style.right = `${Math.max(8, innerWidth - r.right)}px`;
      chrome.storage.session.set({ unread: 0 }); // seen
    }
    render();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && (changes.mentions || changes.unread)) render();
  });
  render();
  return btn;
}
