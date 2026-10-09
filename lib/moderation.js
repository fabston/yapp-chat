/*
 * Moderation, the pure part (unit-tested): timeout lengths as typed and shown, and what Twitch's EventSub says
 * moderators did (channel.moderate) and why AutoMod held a message. lib/mod-tools.js makes them into the chat.
 */

import { formatDuration } from './format.js';

/* ---- Lengths (pure) ---- */

const UNITS = { s: 1, m: 60, h: 3600, d: 86400, w: 604_800 };

/** "10m", "1h", "1d", "2w", "30s" or plain seconds as seconds; 0 if it isn't one Twitch takes (1 second to 2 weeks). */
export function parseDuration(text) {
  const m = /^\s*(\d+)\s*([smhdw]?)\s*$/i.exec(String(text));
  const seconds = m ? Number(m[1]) * UNITS[(m[2] || 's').toLowerCase()] : 0;
  return seconds >= 1 && seconds <= 1_209_600 ? seconds : 0;
}

/** Seconds as the shortest whole unit: "10m", "1h", "1d", "1w", "90s". */
export function shortDuration(seconds) {
  for (const [unit, size] of [['w', 604_800], ['d', 86400], ['h', 3600], ['m', 60]]) if (seconds % size === 0) return `${seconds / size}${unit}`;
  return `${seconds}s`;
}

/* ---- What moderators did (EventSub channel.moderate, version 2; pure) ---- */

/** Where an action keeps its details in the event, when not under its own name. */
const DETAILS = {
  add_blocked_term: 'automod_terms',
  remove_blocked_term: 'automod_terms',
  add_permitted_term: 'automod_terms',
  remove_permitted_term: 'automod_terms',
  approve_unban_request: 'unban_request',
  deny_unban_request: 'unban_request',
};

/**
 * A channel.moderate event as what the chat shows: { kind: 'timeout', userId, by, reason } (a timeout or ban: its own
 * line says so), { kind: 'delete', messageId, by }, { kind: 'log', by, parts, reason } (a line of its own; parts are
 * text and { name }; an unban's has `lifted`, the user id), or null for what isn't shown. Shared chat's actions read as the plain ones.
 */
export function modAction(event) {
  const action = String(event.action || '').replace(/^shared_chat_/, '');
  const by = event.moderator_user_name || event.moderator_user_login || '';
  const data = event[DETAILS[action] || event.action] || {};
  const who = { name: data.user_name || data.user_login || '' };
  const terms = (data.terms || []).map((t) => `“${t}”`).join(', ');
  const log = (parts, reason = '') => ({ kind: 'log', by, parts, reason });
  switch (action) {
    case 'ban':
    case 'timeout':
      return { kind: 'timeout', userId: data.user_id || '', by, reason: data.reason || '' };
    case 'delete':
      return { kind: 'delete', messageId: data.message_id || '', by };
    case 'unban':
      return { ...log(['unbanned ', who]), lifted: data.user_id || '' };
    case 'untimeout':
      return { ...log(['lifted the timeout on ', who]), lifted: data.user_id || '' };
    case 'warn':
      return log(['warned ', who], data.reason || '');
    case 'clear':
      return log(['cleared the chat']);
    case 'slow':
      return log([`turned on slow mode (${formatDuration(Number(data.wait_time_seconds) || 0)})`]);
    case 'slowoff':
      return log(['turned off slow mode']);
    case 'followers':
      return log([`turned on followers-only${Number(data.follow_duration_minutes) ? ` (${formatDuration(data.follow_duration_minutes * 60)})` : ''}`]);
    case 'followersoff':
      return log(['turned off followers-only']);
    case 'subscribers':
      return log(['turned on subscribers-only']);
    case 'subscribersoff':
      return log(['turned off subscribers-only']);
    case 'emoteonly':
      return log(['turned on emote-only']);
    case 'emoteonlyoff':
      return log(['turned off emote-only']);
    case 'uniquechat':
      return log(['turned on unique chat']);
    case 'uniquechatoff':
      return log(['turned off unique chat']);
    case 'vip':
      return log(['made ', who, ' a VIP']);
    case 'unvip':
      return log(['took VIP from ', who]);
    case 'mod':
      return log(['made ', who, ' a moderator']);
    case 'unmod':
      return log(['took moderator from ', who]);
    case 'raid':
      return log(['raided ', who]);
    case 'unraid':
      return log(['called off the raid']);
    case 'add_blocked_term':
      return log([`blocked ${terms}`]);
    case 'remove_blocked_term':
      return log([`unblocked ${terms}`]);
    case 'add_permitted_term':
      return log([`allowed ${terms}`]);
    case 'remove_permitted_term':
      return log([`stopped allowing ${terms}`]);
    case 'approve_unban_request':
      return log(['accepted the unban request of ', who], data.moderator_message || '');
    case 'deny_unban_request':
      return log(['turned down the unban request of ', who], data.moderator_message || '');
    default:
      return null;
  }
}

/** Why AutoMod held a message: its category ("swearing", "sexual content"…) or a blocked term. */
export function automodWhy(event) {
  if (event.reason === 'blocked_term') return 'Blocked term';
  const category = String(event.automod?.category || '').replace(/_/g, ' ');
  return category ? category[0].toUpperCase() + category.slice(1) : 'AutoMod';
}
