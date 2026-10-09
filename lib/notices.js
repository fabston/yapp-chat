/*
 * Subs, gifts, raids and the other notices (from lib/twitch.js, lib/youtube.js
 * and lib/kick.js): how they look in the chat, and what they were in a few
 * words (the user card's list).
 */

import { formatCount } from './format.js';

/** Subs, gifts, raids, announcements, Super Chats, memberships: icon and colour. */
export const NOTICE_STYLE = {
  sub: ['star', '#a970ff'],
  resub: ['star', '#a970ff'],
  upgrade: ['star', '#a970ff'],
  gift: ['gift', '#ff6bb5'],
  gifts: ['gift', '#ff6bb5'],
  raid: ['users', '#ff9f43'],
  announcement: ['megaphone', '#a970ff'],
  streak: ['flame', '#ff7043'],
  timeout: ['volume-mute', '#f0b429'],
  ban: ['hammer', '#eb4d4b'],
  superchat: ['dollar', '#ffca28'],
  member: ['heart', '#2ba640'],
  cheer: ['gem', '#9c3ee8'],
  kicks: ['gem', '#53fc18'], // Kick's paid gifts, like bits
  modlog: ['shield', '#8b97ad'], // what a moderator did (lib/moderation.js), for moderators
  automod: ['shield', '#f59e0b'], // a message AutoMod held, to allow or deny
};

/** A timeout or ban, shown as a notice line in the chat (lib/chat.js Feed.modMessage). */
export const isModeration = (m) => m.event?.type === 'timeout' || m.event?.type === 'ban';

/** "1 KICK", "100 KICKs" (Kick's paid gifts). */
export const kicks = (n) => `${n.toLocaleString()} KICK${n === 1 ? '' : 's'}`;

/** A sub, raid… in a few words, for lists like the user card's ("Resubscribed · Tier 1 · 27 months"). */
export function eventSummary(e) {
  const months = (n) => `${n} month${n === 1 ? '' : 's'}`;
  switch (e.type) {
    case 'sub':
      return e.plan === 'Prime' ? 'Subscribed with Prime' : ['Subscribed', e.plan].filter(Boolean).join(' · ');
    case 'resub':
      return ['Resubscribed', e.plan, e.months && months(e.months)].filter(Boolean).join(' · ');
    case 'gift':
      return `Gifted a sub to ${e.recipient}`;
    case 'gifts':
      return `Gifted ${e.count} sub${e.count === 1 ? '' : 's'}`;
    case 'upgrade':
      return 'Continued their sub';
    case 'raid':
      return `Raided with ${formatCount(e.viewers)} viewers`;
    case 'announcement':
      return 'Announcement';
    case 'streak':
      return `Watch streak · ${e.streams} streams`;
    case 'cheer':
      return `Cheered ${e.bits.toLocaleString()} bits`;
    case 'kicks':
      return `Sent ${kicks(e.amount)}`;
    case 'superchat':
      return `Super Chat ${e.amount}`;
    case 'member':
      return e.text;
    case 'automod':
      return `Held by AutoMod · ${e.why}`;
    case 'modlog': {
      const text = e.parts.map((p) => (typeof p === 'string' ? p : p.name)).join('');
      return text[0].toUpperCase() + text.slice(1);
    }
    default:
      return '';
  }
}
