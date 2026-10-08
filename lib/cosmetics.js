/*
 * Cosmetics on names: 7TV name paints and badges (live, from 7TV's event
 * API, as 7TV users chat), and BTTV and FFZ badges (one list each). One
 * Cosmetics object per page, shared by its panes. Parsing is pure and unit-tested.
 */

/** 7TV colours are RGBA packed in a 32-bit integer. */
export function stvColor(n) {
  const u = n >>> 0;
  return `rgba(${(u >>> 24) & 255}, ${(u >>> 16) & 255}, ${(u >>> 8) & 255}, ${((u & 255) / 255).toFixed(3)})`;
}

/**
 * A 7TV paint as CSS for a name: { backgroundImage, filter } (the text is
 * clipped to the background), or null for kinds it can't draw.
 */
export function paintStyle(paint) {
  const stops = (paint.stops || []).map((s) => `${stvColor(s.color)} ${(s.at * 100).toFixed(1)}%`).join(', ');
  const repeat = paint.repeat ? 'repeating-' : '';
  let image;
  if (paint.function === 'LINEAR_GRADIENT' && stops) image = `${repeat}linear-gradient(${paint.angle || 0}deg, ${stops})`;
  else if (paint.function === 'RADIAL_GRADIENT' && stops) image = `${repeat}radial-gradient(${paint.shape || 'circle'}, ${stops})`;
  else if (paint.function === 'URL' && paint.image_url) image = `url("${paint.image_url}")`;
  else return null;
  const filter = (paint.shadows || []).map((s) => `drop-shadow(${stvColor(s.color)} ${s.x_offset}px ${s.y_offset}px ${s.radius}px)`).join(' ');
  return { backgroundImage: image, filter };
}

/** BTTV badges: Map Twitch user id → [{ url, title }]. */
export function parseBttvBadges(list = []) {
  const map = new Map();
  for (const b of list || []) if (b.providerId && b.badge?.svg) map.set(String(b.providerId), [{ url: b.badge.svg, title: b.badge.description, source: 'BetterTTV badge' }]);
  return map;
}

/** FFZ badges: Map Twitch user id → [{ url, title }]. */
export function parseFfzBadges(json) {
  const byId = new Map((json?.badges || []).map((b) => [String(b.id), b]));
  const map = new Map();
  for (const [badgeId, users] of Object.entries(json?.users || {})) {
    const b = byId.get(badgeId);
    const url = b && (b.urls?.['2'] || b.image);
    if (!url) continue;
    for (const id of users) {
      const key = String(id);
      map.set(key, [...(map.get(key) || []), { url: url.startsWith('//') ? `https:${url}` : url, title: b.title, source: 'FrankerFaceZ badge', color: b.color }]);
    }
  }
  return map;
}

/**
 * Events: "change" (detail: Twitch user id) when someone's paint or badge
 * arrives, so panes can redraw their lines.
 */
export class Cosmetics extends EventTarget {
  constructor() {
    super();
    this.paints = new Map(); // 7TV paint id → style
    this.stvBadges = new Map(); // 7TV badge id → { url, title }
    this.userPaint = new Map(); // Twitch user id → paint id
    this.userBadge = new Map(); // Twitch user id → 7TV badge id
    this.bttv = new Map();
    this.ffz = new Map();
    this.rooms = new Set();
    fetch('https://api.betterttv.net/3/cached/badges/twitch', { credentials: 'omit' })
      .then((res) => res.json())
      .then((list) => (this.bttv = parseBttvBadges(list)))
      .catch(() => {});
    fetch('https://api.frankerfacez.com/v1/badges/ids', { credentials: 'omit' })
      .then((res) => res.json())
      .then((json) => (this.ffz = parseFfzBadges(json)))
      .catch(() => {});
  }

  /** Listen for 7TV cosmetics in a Twitch channel (by its numeric id). */
  watch(roomId) {
    if (!roomId || this.rooms.has(roomId)) return;
    this.rooms.add(roomId);
    if (this.ws?.readyState === WebSocket.OPEN) this.subscribe(roomId);
    else this.connect();
  }

  subscribe(roomId) {
    for (const type of ['cosmetic.*', 'entitlement.*']) {
      this.ws.send(JSON.stringify({ op: 35, d: { type, condition: { ctx: 'channel', platform: 'TWITCH', id: roomId } } }));
    }
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.ws = new WebSocket('wss://events.7tv.io/v3');
    this.ws.addEventListener('message', (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch {
        /* not one of 7TV's events: skipped */
      }
    });
    // Dropped: back in a while (7TV asks clients not to hammer it).
    this.ws.addEventListener('close', () => setTimeout(() => this.connect(), 15_000));
  }

  onMessage(m) {
    if (m.op === 1) return this.rooms.forEach((room) => this.subscribe(room)); // hello
    if (m.op !== 0) return;
    const { type, body } = m.d;
    const object = body?.object;
    if (type === 'cosmetic.create' && object?.kind === 'PAINT') {
      const style = paintStyle(object.data);
      if (style) this.paints.set(object.id, style);
    } else if (type === 'cosmetic.create' && object?.kind === 'BADGE') {
      const host = object.data.host;
      const file = host?.files?.find((f) => f.name === '2x.webp') || host?.files?.[0];
      if (file) this.stvBadges.set(object.id, { url: `https:${host.url}/${file.name}`, title: object.data.tooltip || object.data.name, source: '7TV badge' });
    } else if ((type === 'entitlement.create' || type === 'entitlement.delete') && (object?.kind === 'PAINT' || object?.kind === 'BADGE')) {
      const twitch = object.user?.connections?.find((c) => c.platform === 'TWITCH')?.id;
      if (!twitch) return;
      const map = object.kind === 'PAINT' ? this.userPaint : this.userBadge;
      if (type === 'entitlement.create') map.set(twitch, object.ref_id);
      else if (map.get(twitch) === object.ref_id) map.delete(twitch);
      this.dispatchEvent(new CustomEvent('change', { detail: twitch }));
    }
  }

  /** The paint for someone's name ({ backgroundImage, filter }), or null. */
  paintFor(userId) {
    return this.paints.get(this.userPaint.get(userId)) || null;
  }

  /** Their 7TV, BTTV and FFZ badges: [{ url, title, source }]. */
  badgesFor(userId) {
    const stv = this.stvBadges.get(this.userBadge.get(userId));
    return [...(stv ? [stv] : []), ...(this.bttv.get(userId) || []), ...(this.ffz.get(userId) || [])];
  }
}
