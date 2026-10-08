/*
 * Small DOM helpers shared by the chat (lib/chat.js), its user card
 * (lib/card.js), the mentions inbox and the channel suggestions.
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

/** How to @ someone: their display name when it's plain letters and digits, else their login. */
export const mentionName = (user) => (/^\w+$/.test(user.name) ? user.name : user.login);
