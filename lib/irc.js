/*
 * Twitch chat speaks IRC (with IRCv3 message tags) over a WebSocket. This
 * parses one line into { tags, prefix, command, params }. Pure; unit-tested.
 *
 *   @badges=moderator/1;color=#FF0000 :nick!nick@nick.tmi.twitch.tv PRIVMSG #chan :hello
 */

const TAG_ESCAPES = { ':': ';', s: ' ', '\\': '\\', r: '\r', n: '\n' };

function unescapeTag(value) {
  return value.replace(/\\(.?)/g, (_, c) => TAG_ESCAPES[c] ?? c);
}

export function parseIrc(line) {
  let rest = line;
  const tags = {};
  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ');
    for (const pair of rest.slice(1, end).split(';')) {
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      tags[key] = eq === -1 ? '' : unescapeTag(pair.slice(eq + 1));
    }
    rest = rest.slice(end + 1);
  }
  let prefix = '';
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ');
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }
  const trailingAt = rest.indexOf(' :');
  const head = trailingAt === -1 ? rest : rest.slice(0, trailingAt);
  const params = head.split(' ').filter(Boolean);
  const command = params.shift() || '';
  if (trailingAt !== -1) params.push(rest.slice(trailingAt + 2));
  return { tags, prefix, command, params };
}

/** "nick" from ":nick!nick@nick.tmi.twitch.tv". */
export function ircNick(prefix) {
  return prefix.split('!')[0];
}

/** Twitch "badges" tag: "subscriber/12,moderator/1" → [{ set, version }]. */
export function parseBadges(value) {
  if (!value) return [];
  return value.split(',').map((badge) => {
    const [set, version = '1'] = badge.split('/');
    return { set, version };
  });
}

/** Twitch "emotes" tag: "25:0-4,12-16/1902:6-10" → [{ id, start, end }] (code point indices). */
export function parseEmoteTag(value) {
  if (!value) return [];
  const out = [];
  for (const emote of value.split('/')) {
    const [id, ranges] = emote.split(':');
    for (const range of (ranges || '').split(',')) {
      const [start, end] = range.split('-').map(Number);
      if (Number.isFinite(start) && Number.isFinite(end)) out.push({ id, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
