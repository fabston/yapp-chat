/*
 * Small DOM helpers shared by the chat (lib/chat.js), its user card
 * (lib/card.js), the mentions inbox, the channel suggestions and Settings.
 */

import { icon } from './icons.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A platform's mark on a small coloured circle, for a picture's corner (YouTube's as its play triangle). */
export function platformBadge(platform) {
  const badge = el('span', `platform-badge ${platform}`);
  badge.append(icon(platform === 'youtube' ? 'play' : platform));
  return badge;
}

/**
 * Where each mark sits on its tile, in the tile's 24 units: centred, sized to look equally big (Kick's at
 * half, so its 4/3-unit steps fall on whole pixels on a 2× screen; Twitch's raised a little for its tail).
 */
const TILE_MARK = { twitch: 'translate(4 3.67) scale(0.667)', kick: 'translate(6 6) scale(0.5)', youtube: 'translate(4 4) scale(0.667)' };

/**
 * A platform's mark on a tile in its colour (YouTube's as its play triangle): the same size for all
 * three, whatever each mark's shape. One svg, square and mark together, so the mark can't land half a
 * pixel off its square (as an icon inside a box can).
 */
export function platformTile(platform) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `platform-tile ${platform}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<rect width="24" height="24" rx="6.5"/><use href="#i-${platform === 'youtube' ? 'play' : platform}" width="24" height="24" transform="${TILE_MARK[platform]}"/>`;
  return svg;
}

/** A small icon-only button, its label as tooltip and for screen readers. */
export function iconButton(name, label, onClick) {
  const btn = el('button', 'btn btn-ghost btn-sm btn-icon');
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.append(icon(name));
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * A dropdown, in place of the browser's own select (which looks like neither theme): a button showing the choice,
 * opening a list like the chat's menus. Keys: ↓, ↑, Enter or Space open it; arrows move, Home and End go to the
 * ends, Enter picks, Esc or Tab closes. `choices` [[value, label]]; `onChange(value)` on a new pick; `label` for
 * screen readers. The button's .value gets and sets the choice.
 */
export function dropdown(choices, value, onChange, label) {
  const button = el('button', 'dropdown');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  if (label) button.setAttribute('aria-label', label);
  const shown = el('span', 'dropdown-value');
  button.append(shown, icon('chevron-down'));
  let current = value;
  const show = () => (shown.textContent = choices.find(([v]) => v === current)?.[1] ?? '');
  show();

  let list = null;
  const close = () => {
    list?.remove();
    list = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    removeEventListener('scroll', moved, true);
    removeEventListener('resize', close);
  };
  const outside = (e) => !list?.contains(e.target) && !button.contains(e.target) && close();
  // The page scrolled (not the list itself, a long one): a list left floating would be in the wrong place.
  const moved = (e) => !list?.contains(e.target) && close();
  const pick = (v) => {
    close();
    button.focus();
    if (v === current) return;
    current = v;
    show();
    onChange?.(v);
  };
  const open = () => {
    list = el('div', 'dropdown-list');
    list.setAttribute('role', 'listbox');
    if (label) list.setAttribute('aria-label', label);
    for (const [v, text] of choices) {
      const option = el('button', 'dropdown-option', text);
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(v === current));
      option.addEventListener('click', () => pick(v));
      list.append(option);
    }
    list.addEventListener('keydown', (e) => {
      const options = [...list.children];
      const at = options.indexOf(document.activeElement);
      const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: options.length - 1 }[e.key];
      if (to != null) {
        e.preventDefault();
        options[Math.max(0, Math.min(options.length - 1, to))].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
        button.focus();
      } else if (e.key === 'Tab') close();
    });
    document.body.append(list);
    // Under the button, as wide as it at least; above it if there's no room below.
    const r = button.getBoundingClientRect();
    list.style.minWidth = `${r.width}px`;
    list.style.left = `${Math.min(r.left, innerWidth - list.offsetWidth - 8)}px`;
    list.style.top = `${r.bottom + 4 + list.offsetHeight > innerHeight - 8 ? r.top - 4 - list.offsetHeight : r.bottom + 4}px`;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    addEventListener('scroll', moved, true);
    addEventListener('resize', close);
    (list.querySelector('[aria-selected="true"]') || list.firstChild)?.focus();
  };
  button.addEventListener('click', () => (list ? close() : open()));
  button.addEventListener('keydown', (e) => {
    if (list || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    open();
  });
  Object.defineProperty(button, 'value', {
    get: () => current,
    set: (v) => {
      current = v;
      show();
    },
  });
  return button;
}

/** How to @ someone: their display name when it's plain letters and digits, else their login. */
export const mentionName = (user) => (/^\w+$/.test(user.name) ? user.name : user.login);
