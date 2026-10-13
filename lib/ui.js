/*
 * Small DOM helpers shared by the chat (lib/chat.js), its user card
 * (lib/card.js), the mod tools, the mentions inbox, the channel suggestions and Settings.
 */

import { setNameTheme } from './format.js';
import { icon } from './icons.js';
import { CHAT_FONTS, EMOTE_SIZES } from './settings.js';

/**
 * The page as Settings → Appearance has it: the theme (light, dark, or as the system is), the spacing, the chat's
 * font and sizes, shaded lines, and names readable on that theme. Says whether it's light.
 */
export function applyAppearance(settings) {
  const root = document.documentElement;
  const light = settings.theme === 'light' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  root.dataset.theme = light ? 'light' : 'dark';
  setNameTheme(light);
  root.dataset.density = settings.density;
  root.style.setProperty('--chat-font', CHAT_FONTS[settings.chatFont][1]);
  root.style.setProperty('--chat-size', `${settings.fontSize}px`);
  root.style.setProperty('--emote-scale', EMOTE_SIZES[settings.emoteSize]);
  root.classList.toggle('alt-rows', settings.altRows);
  return light;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A badge's picture under a reflection that crosses it every few seconds (.badge-shine in chat.css): Yapp Chat's founder and team badges. */
export function shiny(img) {
  const wrap = el('span', 'badge-shine');
  wrap.append(img);
  return wrap;
}

/** A platform's mark on a small coloured circle, for a picture's corner (YouTube's as its play triangle). */
export function platformBadge(platform) {
  const badge = el('span', `platform-badge ${platform}`);
  badge.append(icon(platform === 'youtube' ? 'play' : platform));
  return badge;
}

/**
 * A channel's or a person's picture (an empty circle until `avatar` is known), with its platform's badge on the
 * corner when `platform` is given. `className`: whose it is (its size).
 */
export function sourcePic(className, avatar, platform) {
  const pic = el('span', `source-pic ${className}`);
  const img = el('img', 'source-avatar');
  img.alt = '';
  if (avatar) img.src = avatar;
  pic.append(img);
  if (platform) pic.append(platformBadge(platform));
  return pic;
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
  const part = (tag, attributes) => {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
  };
  part('rect', { width: 24, height: 24, rx: 6.5 });
  part('use', { href: `#i-${platform === 'youtube' ? 'play' : platform}`, width: 24, height: 24, transform: TILE_MARK[platform] || '' });
  return svg;
}

/** A button that does `onClick` (it's handed the click): its class, and its text if it has any. */
export function button(className, text, onClick) {
  const btn = el('button', className, text);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

/** A link to somewhere else, opened in a tab of its own. */
export function outLink(text, href, className = 'link') {
  const a = el('a', className, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

const NOTES = new WeakMap(); // a box → what takes its note away

/**
 * What's wrong with what was typed in `input`, in a note under it, in place of the browser's own bubble (which looks
 * like neither theme): `text`, and smaller under it `hint`, what would do. The box is marked and gets the focus; the
 * note goes once they type again, leave the box or press Esc. Without `text`: only takes the note away.
 */
export function fieldNote(input, text = '', hint = '') {
  NOTES.get(input)?.();
  if (!text) return;
  const note = el('div', 'field-note');
  note.id = `field-note-${crypto.randomUUID()}`;
  note.setAttribute('role', 'alert');
  const words = el('div', 'field-note-text');
  words.append(el('strong', '', text));
  if (hint) words.append(el('span', '', hint));
  note.append(icon('alert'), words);
  document.body.append(note);
  // Under the box from its left edge, as wide as it at most (a narrow box: 260 px); above it if there's no room below.
  const r = input.getBoundingClientRect();
  note.style.maxWidth = `${Math.min(Math.max(r.width, 260), innerWidth - 16)}px`;
  note.style.left = `${Math.max(8, Math.min(r.left, innerWidth - note.offsetWidth - 8))}px`;
  note.style.top = `${r.bottom + 6 + note.offsetHeight > innerHeight - 8 ? r.top - 6 - note.offsetHeight : r.bottom + 6}px`;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', note.id);
  input.focus();
  const gone = new AbortController();
  const off = () => {
    gone.abort();
    note.remove();
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    NOTES.delete(input);
  };
  NOTES.set(input, off);
  const { signal } = gone;
  input.addEventListener('input', off, { signal });
  input.addEventListener('blur', off, { signal });
  input.addEventListener('keydown', (e) => e.key === 'Escape' && off(), { signal });
  addEventListener('resize', off, { signal });
}

/** A small icon-only button, its label as tooltip and for screen readers. */
export function iconButton(name, label, onClick) {
  const btn = button('btn btn-ghost btn-sm btn-icon', '', onClick);
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.append(icon(name));
  return btn;
}

/**
 * A checkbox with its label, in place of the browser's own (which looks like neither theme): the real input, drawn
 * as a box in the accent colour with a tick (sc-theme.css .check), level with the label's first line. Returns
 * [label, input]; the input's .checked and its change event as usual.
 */
export function checkbox(text) {
  const label = el('label', 'check');
  const input = el('input');
  input.type = 'checkbox';
  label.append(input, el('span', 'check-text', text));
  return [label, input];
}

/**
 * A dropdown, in place of the browser's own select (which looks like neither theme): a button showing the choice,
 * opening a list like the chat's menus. Keys: ↓, ↑, Enter or Space open it; arrows move, Home and End go to the
 * ends, Enter picks, Esc or Tab closes. `choices` [[value, label]], a label being its text or a function that draws
 * it (a node: a name in its paint); `onChange(value)` on a new pick; `label` for screen readers. The button's .value
 * gets and sets the choice.
 */
export function dropdown(choices, value, onChange, label) {
  const box = el('button', 'dropdown');
  box.type = 'button';
  box.setAttribute('aria-haspopup', 'listbox');
  box.setAttribute('aria-expanded', 'false');
  if (label) box.setAttribute('aria-label', label);
  const shown = el('span', 'dropdown-value');
  box.append(shown, icon('chevron-down'));
  let current = value;
  const face = (text) => (typeof text === 'function' ? text() : text);
  const show = () => shown.replaceChildren(face(choices.find(([v]) => v === current)?.[1] ?? ''));
  show();

  let list = null;
  const close = () => {
    list?.remove();
    list = null;
    box.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    removeEventListener('scroll', moved, true);
    removeEventListener('resize', close);
  };
  const outside = (e) => !list?.contains(e.target) && !box.contains(e.target) && close();
  // The page scrolled (not the list itself, a long one): a list left floating would be in the wrong place.
  const moved = (e) => !list?.contains(e.target) && close();
  const pick = (v) => {
    close();
    box.focus();
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
      const option = button('dropdown-option', '', () => pick(v));
      option.append(face(text));
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(v === current));
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
        box.focus();
      } else if (e.key === 'Tab') close();
    });
    document.body.append(list);
    // Under the button, as wide as it at least; above it if there's no room below.
    const r = box.getBoundingClientRect();
    list.style.minWidth = `${r.width}px`;
    list.style.left = `${Math.min(r.left, innerWidth - list.offsetWidth - 8)}px`;
    list.style.top = `${r.bottom + 4 + list.offsetHeight > innerHeight - 8 ? r.top - 4 - list.offsetHeight : r.bottom + 4}px`;
    box.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    addEventListener('scroll', moved, true);
    addEventListener('resize', close);
    (list.querySelector('[aria-selected="true"]') || list.firstChild)?.focus();
  };
  box.addEventListener('click', () => (list ? close() : open()));
  box.addEventListener('keydown', (e) => {
    if (list || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    open();
  });
  Object.defineProperty(box, 'value', {
    get: () => current,
    set: (v) => {
      current = v;
      show();
    },
  });
  return box;
}

/** How to @ someone: their display name when it's plain letters and digits, else their login. */
export const mentionName = (user) => (/^\w+$/.test(user.name) ? user.name : user.login);
