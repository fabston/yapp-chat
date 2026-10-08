/*
 * Third-party emotes: BetterTTV, FrankerFaceZ and 7TV, global and per Twitch
 * channel. Each list becomes a Map of name → { url, zeroWidth }. Loaded once
 * per page (kept in memory). The parsers are pure and unit-tested.
 */

/* ---- Parsers (API response → [name, { url, zeroWidth }]) ---- */

export function parseBttv(list) {
  return (list || []).map((e) => [e.code, { url: `https://cdn.betterttv.net/emote/${e.id}/2x`, zeroWidth: false }]);
}

export function parseFfzSets(sets) {
  return Object.values(sets || {}).flatMap((set) =>
    (set.emoticons || []).map((e) => {
      const url = e.urls?.['2'] || e.urls?.['1'] || '';
      return [e.name, { url: url.startsWith('//') ? `https:${url}` : url, zeroWidth: Boolean(e.modifier) }];
    }),
  );
}

/** 7TV: data.flags bit 256 marks zero-width emotes (drawn over the previous one). */
export function parse7tv(emotes) {
  return (emotes || [])
    .filter((e) => e.data?.host?.url)
    .map((e) => [e.name, { url: `https:${e.data.host.url}/2x.webp`, zeroWidth: Boolean((e.data.flags || 0) & 256) }]);
}

/* ---- Loading ---- */

const memo = new Map();

async function getJson(url) {
  if (!memo.has(url)) {
    memo.set(
      url,
      fetch(url)
        // 404 and the like are answers (no emotes there): kept. Errors and server trouble: tried again next time.
        .then((res) => (res.ok ? res.json() : res.status < 500 ? null : Promise.reject(new Error(String(res.status)))))
        .catch(() => {
          memo.delete(url);
          return null;
        }),
    );
  }
  return memo.get(url);
}

/** Which providers to load: { bttv, ffz, seventv } from settings. */
export async function globalEmotes(enabled) {
  const [bttv, ffz, seventv] = await Promise.all([
    enabled.bttv ? getJson('https://api.betterttv.net/3/cached/emotes/global') : null,
    enabled.ffz ? getJson('https://api.frankerfacez.com/v1/set/global') : null,
    enabled.seventv ? getJson('https://7tv.io/v3/emote-sets/global') : null,
  ]);
  return new Map([
    ...parseBttv(bttv),
    ...parseFfzSets(ffz && Object.fromEntries((ffz.default_sets || []).map((id) => [id, ffz.sets?.[id]]))),
    ...parse7tv(seventv?.emotes),
  ]);
}

/** A Kick channel's 7TV emotes (BTTV and FFZ are Twitch only), by its broadcaster's user id. */
export async function kickChannelEmotes(userId, enabled) {
  const seventv = enabled.seventv ? await getJson(`https://7tv.io/v3/users/kick/${userId}`) : null;
  return parse7tv(seventv?.emote_set?.emotes);
}

/** A Twitch channel's own emotes (its numeric id comes from the chat's ROOMSTATE). */
export async function channelEmotes(roomId, login, enabled) {
  const [bttv, ffz, seventv] = await Promise.all([
    enabled.bttv ? getJson(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`) : null,
    enabled.ffz ? getJson(`https://api.frankerfacez.com/v1/room/${login}`) : null,
    enabled.seventv ? getJson(`https://7tv.io/v3/users/twitch/${roomId}`) : null,
  ]);
  return new Map([
    ...parseBttv([...(bttv?.channelEmotes || []), ...(bttv?.sharedEmotes || [])]),
    ...parseFfzSets(ffz?.sets),
    ...parse7tv(seventv?.emote_set?.emotes),
  ]);
}
