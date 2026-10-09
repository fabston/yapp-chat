/*
 * Link previews: hover a YouTube link, a Twitch clip, or a Kick clip or video in chat for its thumbnail, title and
 * channel. The link parsing is pure and unit-tested.
 */

import { formatUptime } from './format.js';
import { kickClip, kickVideo } from './kick.js';
import { twitchClip } from './twitch.js';

const YT_ID = /^[\w-]{11}$/;
const KICK_CLIP = /^clip_[0-9A-Z]{26}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a link points at that has a preview, or null: { kind: 'youtube', id } | { kind: 'clip', slug } (Twitch) |
 * { kind: 'kick-clip', id } (kick.com/name/clips/clip_…, or ?clip=) | { kind: 'kick-video', id } (kick.com/name/videos/…).
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
  }
  if (host === 'kick.com') {
    const clip = url.searchParams.get('clip') || (parts[1] === 'clips' ? parts[2] : '');
    if (KICK_CLIP.test(clip || '')) return { kind: 'kick-clip', id: clip };
    if (parts[1] === 'videos' && UUID.test(parts[2] || '')) return { kind: 'kick-video', id: parts[2] };
  }
  return null;
}

const views = (n) => `${n.toLocaleString()} view${n === 1 ? '' : 's'}`;

/** Each kind's preview: { thumbnail, title, by, meta }, or null. */
const LOADERS = {
  youtube: (t) =>
    fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${t.id}`)}`, { credentials: 'omit' })
      .then((res) => (res.ok ? res.json() : null))
      .then((o) => o && { thumbnail: o.thumbnail_url, title: o.title, by: o.author_name, meta: 'YouTube' }),
  clip: (t) => twitchClip(t.slug).then((c) => c && { thumbnail: c.thumbnail, title: c.title, by: c.channel, meta: `Twitch clip · ${c.seconds}s · ${views(c.views)}` }),
  'kick-clip': (t) =>
    kickClip(t.id).then((c) => c && { thumbnail: c.thumbnail, title: c.title, by: c.channel, meta: [`Kick clip · ${c.seconds}s · ${views(c.views)}`, c.by && `clipped by ${c.by}`].filter(Boolean).join(' · ') }),
  'kick-video': (t) =>
    kickVideo(t.id).then((v) => v && { thumbnail: v.thumbnail, title: v.title || 'Past stream', by: v.channel, meta: [`Kick video · ${formatUptime(v.ms)}`, views(v.views), v.category].filter(Boolean).join(' · ') }),
};

const previews = new Map(); // href → Promise<{ thumbnail, title, by, meta } | null>

/** The preview for a link (kept for the page's life; a Kick video's for 4 minutes), or null. */
export function linkPreview(href) {
  const target = linkTarget(href);
  if (!target) return Promise.resolve(null);
  if (!previews.has(href)) {
    previews.set(href, LOADERS[target.kind](target).catch(() => null));
    // A Kick video's picture link works for 5 minutes: ask again after 4.
    if (target.kind === 'kick-video') setTimeout(() => previews.delete(href), 240_000);
  }
  return previews.get(href);
}
