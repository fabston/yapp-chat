/*
 * The same streamer live on the other platforms at once (a simulcast), so a chat of one channel can offer to bring
 * the others in. Found by name: a Twitch login, a Kick slug and a YouTube handle are often the same (xqc on Twitch
 * and Kick, theburntpeanut on all three). YouTube first by the link on their Kick profile (xQc's is a channel id;
 * the @xqc handle is someone else's). Only where they're live right now, which keeps a namesake out.
 */

import { kickChannel } from './kick.js';
import { twitchLiveInfo } from './twitch.js';
import { youtubeLive } from './youtube.js';

const KEEP = 5 * 60_000; // a YouTube channel page is 1–2 MB: asked at most every 5 minutes per name
const asked = new Map(); // `${platform}:${name}` → { at, others: Promise }

/**
 * Where else `name` (on `platform`) is live now: sources, in Twitch, Kick, YouTube order ([] for nowhere).
 * `youtube`: the YouTube channel on their Kick profile, when the chat is Kick's and knows it already.
 */
export function simulcasts(platform, name, youtube = null) {
  const key = `${platform}:${name.toLowerCase()}`;
  const known = asked.get(key);
  if (known && Date.now() - known.at < KEEP) return known.others;
  const others = look(platform, name.toLowerCase(), youtube);
  asked.set(key, { at: Date.now(), others });
  return others;
}

async function look(platform, name, youtube) {
  const login = name.replace(/-/g, '_'); // Kick writes Twitch's underscores as dashes in its slugs
  const slug = name.replace(/_/g, '-');
  const quietly = (promise) => promise.catch(() => null); // one that doesn't answer: not live there
  const kick = platform === 'kick' ? null : quietly(kickChannel(slug));
  const twitch = platform !== 'twitch' && /^\w{3,25}$/.test(login) ? quietly(twitchLiveInfo(login)).then((live) => live && { platform: 'twitch', channel: login }) : null;
  const tube =
    platform === 'youtube'
      ? null
      : Promise.resolve(kick).then(async (channel) => {
          const source = youtube || channel?.youtube || (/^[\w.-]{3,30}$/.test(name) ? { platform: 'youtube', handle: `@${name}` } : null);
          return source && (await quietly(youtubeLive(source))) ? source : null;
        });
  const kicking = kick && kick.then((channel) => channel?.live && { platform: 'kick', channel: channel.slug });
  return (await Promise.all([twitch, kicking, tube])).filter(Boolean);
}
