/*
 * What to show: a Twitch or Kick channel or a YouTube live stream, from
 * whatever you typed or the page you're on. Pure; unit-tested.
 *
 * Source: { platform: 'twitch', channel } | { platform: 'youtube', videoId?, handle?, channelId? }
 *       | { platform: 'kick', channel }
 */

/** twitch.tv paths that aren't channels. */
const TWITCH_RESERVED = new Set([
  'directory', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops', 'friends',
  'messages', 'p', 'search', 'downloads', 'jobs', 'turbo', 'prime', 'store', 'login', 'signup',
  'moderator', 'u', 'popout', 'embed', 'broadcast', 'following', 'clips', 'collections',
]);

const TWITCH_LOGIN = /^[a-z0-9_]{3,25}$/i;

/** kick.com paths that aren't channels. */
const KICK_RESERVED = new Set([
  'browse', 'categories', 'category', 'following', 'search', 'video', 'videos', 'clips', 'clip', 'dashboard',
  'settings', 'subscriptions', 'messages', 'community-guidelines', 'privacy-policy', 'terms-of-service', 'faq',
  'about', 'help', 'login', 'signup', 'api', 'emotes', 'popout', 'embed', 'kick-tos', 'dmca-policy', 'contact',
]);

/** Kick channel names (slugs): letters, digits, "_" and "-". */
const KICK_SLUG = /^[a-z0-9_-]{2,32}$/i;
const YT_VIDEO_ID = /^[\w-]{11}$/;

function toUrl(input) {
  try {
    return new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
}

/** A source from a page address, or null if it isn't a Twitch channel / YouTube stream. */
export function sourceFromUrl(href) {
  const url = toUrl(href);
  if (!url) return null;
  const host = url.hostname.replace(/^(www|m)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'twitch.tv') {
    // twitch.tv/popout/<name>/chat, twitch.tv/<name>, twitch.tv/<name>/videos…
    const name = parts[0] === 'popout' || parts[0] === 'embed' ? parts[1] : parts[0];
    if (!name || TWITCH_RESERVED.has(name.toLowerCase()) || !TWITCH_LOGIN.test(name)) return null;
    return { platform: 'twitch', channel: name.toLowerCase() };
  }

  if (host === 'kick.com') {
    // kick.com/<name>, kick.com/popout/<name>/chat, kick.com/<name>/videos…
    const name = parts[0] === 'popout' || parts[0] === 'embed' ? parts[1] : parts[0];
    if (!name || KICK_RESERVED.has(name.toLowerCase()) || !KICK_SLUG.test(name)) return null;
    return { platform: 'kick', channel: name.toLowerCase() };
  }

  if (host === 'youtube.com' || host === 'youtu.be') {
    if (host === 'youtu.be' && YT_VIDEO_ID.test(parts[0] || '')) return { platform: 'youtube', videoId: parts[0] };
    const v = url.searchParams.get('v');
    if ((parts[0] === 'watch' || parts[0] === 'live_chat') && YT_VIDEO_ID.test(v || '')) {
      return { platform: 'youtube', videoId: v };
    }
    if (parts[0] === 'live' && YT_VIDEO_ID.test(parts[1] || '')) return { platform: 'youtube', videoId: parts[1] };
    // A channel's page: its current live stream.
    if (parts[0]?.startsWith('@')) return { platform: 'youtube', handle: parts[0].toLowerCase() };
    if (parts[0] === 'channel' && /^UC[\w-]{22}$/.test(parts[1] || '')) return { platform: 'youtube', channelId: parts[1] };
  }
  return null;
}

/**
 * A source from what you typed: a URL, "@handle" (YouTube), "yt:<video id>",
 * "kick:<name>", or a Twitch channel name.
 */
export function sourceFromInput(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/[./]/.test(text) && !text.startsWith('@')) return sourceFromUrl(text);
  if (text.startsWith('@') && text.length > 1) return { platform: 'youtube', handle: text.toLowerCase() };
  const yt = /^yt:([\w-]{11})$/i.exec(text);
  if (yt) return { platform: 'youtube', videoId: yt[1] };
  const kick = /^kick:(.+)$/i.exec(text);
  if (kick) return KICK_SLUG.test(kick[1]) ? { platform: 'kick', channel: kick[1].toLowerCase() } : null;
  return TWITCH_LOGIN.test(text) ? { platform: 'twitch', channel: text.toLowerCase() } : null;
}

/** Stable key, to avoid opening the same chat twice. */
export function sourceKey(source) {
  if (source.platform === 'twitch' || source.platform === 'kick') return `${source.platform}:${source.channel}`;
  return `youtube:${source.videoId || source.handle || source.channelId}`;
}

/** Shown in headers before the stream's own title is known. */
export function sourceLabel(source) {
  if (source.platform === 'twitch' || source.platform === 'kick') return source.channel;
  return source.handle || source.channelId || source.videoId;
}

/** A source as stored or passed in an address: checked before use. */
export function isSource(s) {
  if (s?.platform === 'twitch') return TWITCH_LOGIN.test(s.channel || '');
  if (s?.platform === 'kick') return KICK_SLUG.test(s.channel || '');
  if (s?.platform === 'youtube') return [s.videoId, s.handle, s.channelId].some((v) => typeof v === 'string' && v);
  return false;
}

/** Each platform's name, for "Open on …" and tooltips. */
export const PLATFORM_NAMES = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' };

/** The same picture, bigger: Twitch's 600 px size, YouTube's 400 px one, Kick's full size. */
export function largerPicture(url) {
  return url
    .replace(/-\d+x\d+(\.\w+)$/, '-600x600$1') // Twitch: …-profile_image-150x150.png
    .replace(/=s\d+(-|$)/, '=s400$1') // YouTube: …=s64-c-k-…
    .replace(/-thumb(\.\w+)$/, '-fullsize$1'); // Kick
}

/* ---- Chats: one source, or several merged into one list ---- */

/** Most sources merged into one chat. */
export const MAX_MERGED = 6;

/** Without repeats, at most MAX_MERGED. */
export function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter((s) => !seen.has(sourceKey(s)) && seen.add(sourceKey(s))).slice(0, MAX_MERGED);
}

/**
 * A chat from what you typed: one source, or several separated by commas or
 * spaces ("xqc, @xqcyt, kick:xqc"). Null if any part isn't a source.
 */
export function chatFromInput(input) {
  const words = String(input || '').split(/[\s,]+/).filter(Boolean);
  const sources = words.map(sourceFromInput);
  return words.length && sources.every(Boolean) ? uniqueSources(sources) : null;
}

/** Stable key for a chat (its sources in order). */
export const chatKey = (chat) => chat.map(sourceKey).join('+');
