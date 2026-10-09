/*
 * Link previews: hover a YouTube link, a Twitch or Kick clip or video, or a Twitch or Kick channel in chat for its
 * thumbnail (or picture), title and channel. The link parsing is pure and unit-tested.
 */

import { formatCount, formatUptime } from './format.js';
import { kickChannelPreview, kickClip, kickVideo } from './kick.js';
import { sourceFromUrl } from './sources.js';
import { twitchChannel, twitchClip, twitchVideo } from './twitch.js';

const YT_ID = /^[\w-]{11}$/;
const KICK_CLIP = /^clip_[0-9A-Z]{26}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a link points at that has a preview, or null: { kind: 'youtube', id } | { kind: 'clip', slug } (Twitch) |
 * { kind: 'twitch-video', id } (twitch.tv/videos/…) | { kind: 'kick-clip', id } (kick.com/name/clips/clip_…, or
 * ?clip=) | { kind: 'kick-video', id } (kick.com/name/videos/…) | { kind: 'twitch-channel' or 'kick-channel', id }
 * (a channel's page: twitch.tv/name, kick.com/name).
 */
export function linkTarget(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' && YT_ID.test(parts[0] || '')) return { kind: 'youtube', id: parts[0] };
  if (host === 'youtube.com') {
    const v = url.searchParams.get('v');
    if (parts[0] === 'watch' && YT_ID.test(v || '')) return { kind: 'youtube', id: v };
    if ((parts[0] === 'shorts' || parts[0] === 'live') && YT_ID.test(parts[1] || '')) return { kind: 'youtube', id: parts[1] };
  }
  if (host === 'clips.twitch.tv' && parts[0] && parts[0] !== 'embed') return { kind: 'clip', slug: parts[0] };
  if (host === 'twitch.tv') {
    const i = parts.indexOf('clip');
    if (i >= 0 && parts[i + 1]) return { kind: 'clip', slug: parts[i + 1] };
    if (parts[0] === 'videos' && /^\d+$/.test(parts[1] || '')) return { kind: 'twitch-video', id: parts[1] };
  }
  if (host === 'kick.com') {
    const clip = url.searchParams.get('clip') || (parts[1] === 'clips' ? parts[2] : '');
    if (KICK_CLIP.test(clip || '')) return { kind: 'kick-clip', id: clip };
    if (parts[1] === 'videos' && UUID.test(parts[2] || '')) return { kind: 'kick-video', id: parts[2] };
  }
  // A channel's page itself (not its videos or settings).
  const channel = parts.length === 1 && sourceFromUrl(href);
  if (channel && channel.platform !== 'youtube') return { kind: `${channel.platform}-channel`, id: channel.channel };
  return null;
}

/**
 * A channel's preview: live, its stream's picture, title, viewers and game; offline, its picture (round) and
 * followers. `channel` from parseTwitchChannel or parseKickChannelPreview.
 */
const channelPreview = (channel) =>
  channel &&
  (channel.viewers != null
    ? { thumbnail: channel.thumbnail || channel.avatar, round: !channel.thumbnail, title: channel.title || channel.name, by: channel.name, meta: [`Live · ${formatCount(channel.viewers)} watching`, channel.game].filter(Boolean).join(' · ') }
    : { thumbnail: channel.avatar, round: true, title: channel.name, meta: [`Offline · ${formatCount(channel.followers)} followers`, channel.game && `last: ${channel.game}`].filter(Boolean).join(' · ') });

const views = (n) => `${n.toLocaleString()} view${n === 1 ? '' : 's'}`;

/** A video's length: "40s" under a minute (a highlight), else "6h 10m". */
const length = (seconds) => (seconds < 60 ? `${Math.round(seconds)}s` : formatUptime(seconds * 1000));

/** Each kind's preview: { thumbnail, title, by, meta }, or null. */
const LOADERS = {
  youtube: (t) =>
    fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${t.id}`)}`, { credentials: 'omit' })
      .then((res) => (res.ok ? res.json() : null))
      .then((o) => o && { thumbnail: o.thumbnail_url, title: o.title, by: o.author_name, meta: 'YouTube' }),
  clip: (t) => twitchClip(t.slug).then((c) => c && { thumbnail: c.thumbnail, title: c.title, by: c.channel, meta: `Twitch clip · ${c.seconds}s · ${views(c.views)}` }),
  'twitch-video': (t) =>
    twitchVideo(t.id).then((v) => v && { thumbnail: v.thumbnail, title: v.title || 'Past broadcast', by: v.channel, meta: [`Twitch ${v.kind} · ${length(v.seconds)}`, views(v.views), v.game].filter(Boolean).join(' · ') }),
  'twitch-channel': (t) => twitchChannel(t.id).then(channelPreview),
  'kick-channel': (t) => kickChannelPreview(t.id).then(channelPreview),
  'kick-clip': (t) =>
    kickClip(t.id).then((c) => c && { thumbnail: c.thumbnail, title: c.title, by: c.channel, meta: [`Kick clip · ${c.seconds}s · ${views(c.views)}`, c.by && `clipped by ${c.by}`].filter(Boolean).join(' · ') }),
  'kick-video': (t) =>
    kickVideo(t.id).then((v) => v && { thumbnail: v.thumbnail, title: v.title || 'Past stream', by: v.channel, meta: [`Kick video · ${length(v.ms / 1000)}`, views(v.views), v.category].filter(Boolean).join(' · ') }),
};

const previews = new Map(); // href → Promise<{ thumbnail, round?, title, by, meta } | null>

// How long a preview is kept (ms); the others for the page's life. A channel goes live or offline; a Kick video's
// picture link works for 5 minutes.
const KEEP = { 'twitch-channel': 60_000, 'kick-channel': 60_000, 'kick-video': 240_000 };

/** The preview for a link, or null. */
export function linkPreview(href) {
  const target = linkTarget(href);
  if (!target) return Promise.resolve(null);
  if (!previews.has(href)) {
    previews.set(href, LOADERS[target.kind](target).catch(() => null));
    if (KEEP[target.kind]) setTimeout(() => previews.delete(href), KEEP[target.kind]);
  }
  return previews.get(href);
}
