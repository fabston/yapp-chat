/*
 * Channel suggestions under a box where you type channels: live channels you
 * follow (signed in) and Twitch's and Kick's search as you type ("kick:…"
 * searches Kick only). ↑/↓ to choose, Enter or Tab to pick, Esc to close. The
 * box can hold several, separated by commas or spaces: the one at the caret is
 * replaced. Picking the only one opens it.
 */

import { formatCount } from './format.js';
import { kickSearchChannels } from './kick.js';
import { twitchFollowedLive, twitchSearchChannels } from './twitch.js';
import { el, platformBadge } from './ui.js';

const MAX = 8;

/** Kick results under Twitch's when you type a plain name. */
const KICK_MIX = 3;

/** The word being typed at the caret: { text, start, end }. */
function wordAtCaret(input) {
  const before = input.value.slice(0, input.selectionStart);
  const start = before.search(/[^\s,]*$/);
  const rest = input.value.slice(input.selectionStart).search(/[\s,]|$/);
  return { text: before.slice(start), start, end: input.selectionStart + rest };
}

/**
 * @param {HTMLInputElement} input
 * @param {{ auth, signedIn }} ctx (a ChatContext)
 * @param {{ exclude?: () => string[] }} options exclude: what not to suggest (already in the chat): Twitch logins, "kick:<name>"
 * @returns {() => void} removes the list (when the box goes away)
 */
export function channelSuggest(input, ctx, { exclude = () => [] } = {}) {
  const box = el('div', 'channel-suggest');
  box.id = `channel-suggest-${crypto.randomUUID()}`;
  box.setAttribute('role', 'listbox');
  box.hidden = true;
  document.body.append(box);
  // The box and its list, tied together for screen readers: the highlighted channel is read out as it changes.
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', box.id);
  input.setAttribute('aria-expanded', 'false');
  const showActive = () => {
    if (box.hidden || !items.length) input.removeAttribute('aria-activedescendant');
    else input.setAttribute('aria-activedescendant', `${box.id}-${active}`);
  };
  let items = [];
  let active = 0;
  let request = 0; // newest search wins
  let timer = null;

  // Also drops any search still on its way, so it can't open the list again.
  const close = () => {
    request++;
    clearTimeout(timer);
    box.hidden = true;
    items = [];
    input.setAttribute('aria-expanded', 'false');
    showActive();
  };

  const place = () => {
    const r = input.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.bottom + 4}px`;
    box.style.width = `${Math.max(r.width, 260)}px`;
  };

  const pick = (item) => {
    const word = wordAtCaret(input);
    input.setRangeText(item.login, word.start, word.end, 'end');
    input.setCustomValidity(''); // clears any "not a channel" message
    close();
    // The only channel in the box: open it right away.
    if (!/[\s,]/.test(input.value.trim())) input.form?.requestSubmit();
  };

  const render = (rows, note = '') => {
    if (document.activeElement !== input) return close(); // you've moved on (picked, opened, hidden)
    const skip = new Set(exclude());
    items = rows.filter((c) => !skip.has(c.login)).slice(0, MAX);
    // Enter takes what you typed if it's listed, else the top one.
    const word = wordAtCaret(input).text.toLowerCase();
    active = Math.max(0, items.findIndex((c) => c.login === word));
    box.replaceChildren();
    for (const [i, item] of items.entries()) {
      const row = el('div', 'cs-row');
      row.setAttribute('role', 'option');
      row.id = `${box.id}-${i}`;
      row.setAttribute('aria-selected', String(i === active));
      // The picture with its platform's badge on the corner, as on the chats' own pictures.
      const pic = el('span', 'source-pic cs-pic');
      const img = el('img', 'source-avatar cs-avatar');
      img.alt = '';
      if (item.avatar) img.src = item.avatar;
      pic.append(img, platformBadge(item.platform ?? 'twitch'));
      const text = el('div', 'cs-text');
      const name = el('span', 'cs-name', item.name);
      if (item.followed) name.append(el('span', 'cs-follow', 'Following'));
      text.append(name);
      if (item.game) text.append(el('span', 'cs-game', item.game));
      // Viewers when known; Kick's search only says who's live.
      const isLive = item.viewers != null || item.live;
      const live = el('span', isLive ? 'cs-live' : 'cs-offline', item.viewers != null ? formatCount(item.viewers) : isLive ? 'Live' : 'Offline');
      row.append(pic, text, live);
      row.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep the focus in the box
        pick(item);
      });
      box.append(row);
    }
    if (note) box.append(el('p', 'cs-note', note));
    box.hidden = !box.children.length;
    input.setAttribute('aria-expanded', String(!box.hidden));
    showActive();
    if (!box.hidden) place();
  };

  const setActive = (i) => {
    active = (i + items.length) % items.length;
    [...box.querySelectorAll('.cs-row')].forEach((row, n) => row.setAttribute('aria-selected', String(n === active)));
    showActive();
  };

  const update = async () => {
    const id = ++request;
    let word = wordAtCaret(input).text.toLowerCase();
    // "kick:…": Kick only. YouTube handles and links aren't searched.
    const kickOnly = word.startsWith('kick:');
    if (kickOnly) word = word.slice(5);
    if (/[@/.:]/.test(word)) return close();
    if (kickOnly) {
      if (word.length < 3) return render([]);
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const found = await kickSearchChannels(word).catch(() => []);
        if (id === request) render(found);
      }, 200);
      return;
    }

    let followed = [];
    let note = '';
    if (ctx.signedIn) {
      try {
        followed = await twitchFollowedLive(ctx.auth);
      } catch (error) {
        if (error.status === 401 && !word) note = 'Sign in to Twitch again in Settings to see live channels you follow.';
      }
    }
    const matches = followed
      .filter((c) => !word || c.login.includes(word) || c.name.toLowerCase().includes(word))
      .map((c) => ({ ...c, followed: true }));
    if (id !== request) return;
    render(matches, note);
    if (word.length < 2) return;

    // Then Twitch's search, live channels first, and a few from Kick's, after a short pause in typing.
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const [found, kick] = await Promise.all([twitchSearchChannels(word).catch(() => []), kickSearchChannels(word).catch(() => [])]);
      if (id !== request) return;
      const seen = new Set(matches.map((c) => c.login));
      const more = found.filter((c) => !seen.has(c.login)).sort((a, b) => (b.viewers ?? -1) - (a.viewers ?? -1));
      const kickRows = kick.slice(0, KICK_MIX);
      render([...matches, ...more.slice(0, Math.max(0, MAX - matches.length - kickRows.length)), ...kickRows], note);
    }, 200);
  };

  input.addEventListener('focus', update);
  input.addEventListener('input', update);
  input.addEventListener('blur', close);
  input.form?.addEventListener('submit', close);
  input.addEventListener('keydown', (e) => {
    if (box.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  addEventListener('resize', close);
  return () => {
    removeEventListener('resize', close);
    box.remove();
  };
}
