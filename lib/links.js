/*
 * Link previews: hover a YouTube link or a Twitch clip in chat for its
 * thumbnail, title and channel. The link parsing is pure and unit-tested.
 */

import { twitchClip } from './twitch.js';

const YT_ID = /^[\w-]{11}$/;

/** What a link points at that has a preview: { kind: 'youtube', id } | { kind: 'clip', slug } | null. */
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
  return null;
}

const previews = new Map(); // href → Promise<{ thumbnail, title, by, meta } | null>

/** The preview for a link (kept for the page's life), or null. */
export function linkPreview(href) {
  const target = linkTarget(href);
  if (!target) return Promise.resolve(null);
  if (!previews.has(href)) {
    const load =
      target.kind === 'youtube'
        ? fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${target.id}`)}`, { credentials: 'omit' })
            .then((res) => (res.ok ? res.json() : null))
            .then((o) => o && { thumbnail: o.thumbnail_url, title: o.title, by: o.author_name, meta: 'YouTube' })
        : twitchClip(target.slug).then(
            (c) => c && { thumbnail: c.thumbnail, title: c.title, by: c.channel, meta: `Twitch clip · ${c.seconds}s · ${c.views.toLocaleString()} views` },
          );
    previews.set(href, load.catch(() => null));
  }
  return previews.get(href);
}
