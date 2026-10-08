/*
 * A person's past messages in a Twitch channel, for their user card: public
 * chat logs (rustlog servers, justlog's API and more: full months, for the
 * channels each one logs; people can opt out), else the channel's last 800
 * messages from the recent-messages service. Also how many messages the logs
 * have, a search through all of them, and earlier names. The parsing is pure
 * and unit-tested.
 */

import { parseIrc } from './irc.js';
import { twitchEvent, twitchRecentMessages } from './twitch.js';

/** Public log servers. All are asked at once; the one with the most of the person's months is used (on a tie, the first). */
const LOG_SERVERS = ['https://logs.ivr.fi', 'https://logs.spanix.team', 'https://logs.susgee.dev'];

/** How long a server may take to say what it has, before the card goes on without it. */
const LIST_TIMEOUT = 5000;

/** A log line → a message (chat, or a sub/raid notice), a timeout or ban ({ kind: 'timeout', duration }), or null. */
function logEntry(raw) {
  const event = twitchEvent(parseIrc(raw));
  if (event?.type === 'message') return event.message;
  if (event?.type === 'clearUser') return { id: `timeout-${event.time}`, kind: 'timeout', time: event.time, duration: event.duration, user: { login: event.login } };
  return null;
}

/** Someone's messages, subs and timeouts from a logs.ivr.fi month (JSON), oldest first. */
export function parseLogs(json) {
  return (json?.messages || [])
    .map((m) => m.raw && logEntry(m.raw))
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

/** The server with the most months, from [{ server, months } | null] in LOG_SERVERS order (the first on a tie), or null. */
export function deepestLogs(found) {
  return found.reduce((best, f) => (f && (!best || f.months.length > best.months.length) ? f : best), null);
}

/**
 * Where someone's logs in a channel are: { server, months } (months newest
 * first, [{ year, month }]) from the server that has the most of them, or
 * null if no server logs the channel or them. Servers started logging
 * channels at different times, so the first to answer may have only the
 * last few months.
 */
export async function logMonths(channel, login) {
  const found = await Promise.all(
    LOG_SERVERS.map(async (server) => {
      const url = `${server}/list?channel=${channel}&user=${login}`;
      const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(LIST_TIMEOUT) }).catch(() => null);
      if (!res?.ok) return null; // not logged there (404), down, or too slow
      const months = (await res.json().catch(() => ({}))).availableLogs || [];
      return months.length ? { server, months } : null;
    }),
  );
  return deepestLogs(found);
}

/** How many messages the server has from someone in a channel, or null. */
export async function logCount(server, channel, login) {
  const res = await fetch(`${server}/channel/${channel}/user/${login}/stats`, { credentials: 'omit', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  return (await res.json()).messageCount ?? null;
}

/** Someone's messages in all of a channel's logs that contain `query`, newest first, up to 500 (none found: []). */
export async function searchLogs(server, channel, login, query) {
  const url = `${server}/channel/${channel}/user/${login}/search?q=${encodeURIComponent(query)}&json=1&reverse=1&limit=500`;
  const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) return []; // nothing matches
  if (!res.ok) throw new Error(`${new URL(server).host} answered ${res.status}`);
  return parseLogs(await res.json());
}

/** Twitch logins over time, from /namehistory: [{ login, first, last }] (times in ms), the latest first. */
export function parseNameHistory(json) {
  if (!Array.isArray(json)) return [];
  return json
    .map((n) => ({ login: n.user_login, first: Date.parse(n.first_timestamp), last: Date.parse(n.last_timestamp) }))
    .filter((n) => n.login && n.last)
    .sort((a, b) => b.last - a.last);
}

/** The logins someone (a Twitch user id) has had, the latest first; [] if no server knows them. */
export async function nameHistory(userId) {
  for (const server of LOG_SERVERS) {
    const res = await fetch(`${server}/namehistory/${userId}`, { credentials: 'omit', signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!res?.ok) continue;
    const names = parseNameHistory(await res.json().catch(() => null));
    if (names.length) return names;
  }
  return [];
}

/** Someone's messages in one logged month, oldest first. */
export async function logMonth(server, channel, login, { year, month }) {
  const res = await fetch(`${server}/channel/${channel}/user/${login}/${year}/${month}?json=1`, { credentials: 'omit', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${new URL(server).host} answered ${res.status}`);
  return parseLogs(await res.json());
}

/** Without logs: their messages among the channel's last 800 (the most the recent-messages service keeps). */
export async function recentFromUser(channel, login) {
  const lines = await twitchRecentMessages(channel, 800);
  return lines.map(logEntry).filter((entry) => entry?.user?.login === login);
}
