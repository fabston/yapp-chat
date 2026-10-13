/*
 * The emote picker of a chat pane (lib/chat.js ChatPane: its ☺ button and Ctrl/⌘+E): the emotes you can use in the
 * channel you're writing to, by where they're from, with a search, your favourites and the ones you used lately.
 * These take the pane, as lib/card.js's do.
 */

import { saveSettings } from './settings.js';
import { button, el } from './ui.js';

/** The ☺ button: browse the emotes you can use in the channel you're writing to, and pick some. */
export async function toggleEmotePicker(pane) {
  const picker = pane.picker;
  if (!picker.hidden) {
    picker.hidden = true;
    pane.input.focus();
    return;
  }
  await renderPicker(pane);
  picker.hidden = false;
  picker.querySelector('.picker-search').focus();
}

/**
 * The picker's contents. Drawn again when you star or unstar an emote, so
 * Favourites follows right away: `keep` holds the search, the scroll position
 * and the emote you right-clicked, which stays under the pointer.
 */
async function renderPicker(pane, keep = null) {
  const picker = pane.picker;
  const feed = pane.target;
  const global = await pane.ctx.globalEmotes();
  // Everything you can use here, for your favourites and recently used ones.
  const usable = new Map([...global, ...(feed.kickGlobalEmotes || []), ...feed.channelEmotes, ...feed.twitchEmotes]);
  const pick = (names) => new Map(names.filter((n) => usable.has(n)).map((n) => [n, usable.get(n)]));
  const favorites = pane.ctx.settings.favoriteEmotes;
  const recent = Object.entries(pane.ctx.emoteUse).sort((a, b) => b[1].at - a[1].at).map(([n]) => n).slice(0, 40);
  const favoriteEmotes = pick(favorites);
  const groups = [
    ['★ Favourites', favoriteEmotes],
    ['Recent', new Map([...pick(recent)].slice(0, 24))],
    ['Your Twitch emotes', feed.twitchEmotes],
    [`${feed.label}'s emotes`, feed.channelEmotes],
    ['Kick', feed.kickGlobalEmotes],
    ['Global', global],
  ].filter(([, map]) => map?.size);
  const search = el('input', 'input picker-search');
  search.type = 'search';
  search.placeholder = 'Search emotes';
  search.setAttribute('aria-label', 'Search emotes');
  const hovered = el('div', 'picker-hovered', ' ');
  const body = el('div', 'picker-body');
  const sections = groups.map(([title, map]) => {
    const grid = el('div', 'picker-grid');
    for (const [name, emote] of map) {
      const btn = button('picker-emote', '', () => insertEmote(pane, name));
      btn.dataset.name = name.toLowerCase();
      btn.setAttribute('aria-label', name);
      const img = el('img');
      img.src = emote.url;
      img.alt = '';
      img.loading = 'lazy';
      btn.append(img);
      // Starred, in the other sections (in Favourites itself it goes without saying).
      if (map !== favoriteEmotes && favorites.includes(name)) btn.classList.add('fav');
      btn.addEventListener('mouseenter', () => (hovered.textContent = `${name} · right-click to ${favorites.includes(name) ? 'unstar' : '★ star'}`));
      // Right-click: star or unstar (favourites come first in the picker and in ":" suggestions).
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const starred = pane.ctx.settings.favoriteEmotes;
        const on = !starred.includes(name);
        // Right away here (the saved settings reload a moment later).
        pane.ctx.settings.favoriteEmotes = on ? [...starred, name] : starred.filter((n) => n !== name);
        saveSettings({ favoriteEmotes: pane.ctx.settings.favoriteEmotes });
        renderPicker(pane, { query: search.value, scroll: body.scrollTop, title, name, top: btn.getBoundingClientRect().top });
      });
      grid.append(btn);
    }
    const section = el('section', 'picker-section');
    section.dataset.title = title;
    section.append(el('h4', 'picker-title', title), grid);
    return section;
  });
  body.append(...sections);
  if (!sections.length) body.append(el('p', 'picker-empty', 'Emotes are still loading.'));
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const section of sections) {
      let any = false;
      for (const btn of section.querySelectorAll('.picker-emote')) {
        btn.hidden = Boolean(q) && !btn.dataset.name.includes(q);
        any ||= !btn.hidden;
      }
      section.hidden = !any;
    }
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      picker.hidden = true;
      pane.input.focus();
    } else if (e.key === 'Enter') {
      // The first emote the search leaves: into the message, picker closed.
      e.preventDefault();
      const first = shownEmotes()[0];
      if (!first) return;
      first.click();
      picker.hidden = true;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      shownEmotes()[0]?.focus();
    }
  });
  // The keyboard in the grid: arrows move between emotes (up from the top row: back to the search), Enter picks.
  const shownEmotes = () => [...picker.querySelectorAll('.picker-emote')].filter((b) => !b.hidden && !b.closest('.picker-section').hidden);
  body.addEventListener('keydown', (e) => {
    const from = e.target.closest?.('.picker-emote');
    if (!from || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const all = shownEmotes();
    const i = all.indexOf(from);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return all[i + (e.key === 'ArrowRight' ? 1 : -1)]?.focus();
    // Up or down: the nearest emote on the row above or below.
    const at = from.getBoundingClientRect();
    const rows = all.filter((b) => (e.key === 'ArrowDown' ? b.getBoundingClientRect().top > at.top + 4 : b.getBoundingClientRect().top < at.top - 4));
    const rowTop = e.key === 'ArrowDown' ? Math.min(...rows.map((b) => b.getBoundingClientRect().top)) : Math.max(...rows.map((b) => b.getBoundingClientRect().top));
    const row = rows.filter((b) => Math.abs(b.getBoundingClientRect().top - rowTop) < 4);
    const next = row.sort((a, b) => Math.abs(a.getBoundingClientRect().left - at.left) - Math.abs(b.getBoundingClientRect().left - at.left))[0];
    (next || (e.key === 'ArrowUp' ? search : null))?.focus();
  });
  picker.replaceChildren(search, body, hovered);
  if (!keep) return;
  search.value = keep.query;
  search.dispatchEvent(new Event('input'));
  body.scrollTop = keep.scroll;
  // Favourites grew or shrank above it: scroll by as much, so the emote you clicked doesn't move.
  const same = sections.find((sec) => sec.dataset.title === keep.title)?.querySelector(`.picker-emote[data-name="${CSS.escape(keep.name.toLowerCase())}"]`);
  if (same) body.scrollTop += same.getBoundingClientRect().top - keep.top;
  const on = pane.ctx.settings.favoriteEmotes.includes(keep.name);
  hovered.textContent = `${keep.name} · right-click to ${on ? 'unstar' : '★ star'}`;
  // The emote you clicked is gone with the old contents: the search has the cursor (Esc, Enter work).
  search.focus();
}

/** An emote from the picker, at the caret (spaced from what's around it). */
function insertEmote(pane, name) {
  const input = pane.input;
  const before = input.value.slice(0, input.selectionStart);
  input.setRangeText(`${before && !/\s$/.test(before) ? ' ' : ''}${name} `, input.selectionStart, input.selectionEnd, 'end');
  input.focus();
}
