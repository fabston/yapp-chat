/*
 * Twitch EventSub over a WebSocket, for the channels you moderate: what moderators do (channel.moderate), the
 * messages AutoMod holds and what became of them, suspicious users, Shield Mode. One socket for the page (signed in);
 * a chat subscribes its channel when it finds you moderate it, and lets go when it closes. Twitch moves the socket
 * now and then (session_reconnect: the subscriptions come along) and says how long it may stay quiet (keepalive).
 */

import { twitchSubscribe, twitchUnsubscribe } from './twitch.js';

const SOCKET = 'wss://eventsub.wss.twitch.tv/ws';

/** What a moderated channel listens to: [type, version]. One Twitch won't give (a permission missing) is left out. */
export const MOD_EVENTS = [
  ['channel.moderate', '2'],
  ['automod.message.hold', '2'],
  ['automod.message.update', '2'],
  ['channel.suspicious_user.message', '1'],
  ['channel.suspicious_user.update', '1'],
  ['channel.shield_mode.begin', '1'],
  ['channel.shield_mode.end', '1'],
];

export class EventSub {
  /** `auth`: () => the sign-in now (it may change while the page is open). */
  constructor(auth) {
    this.getAuth = auth;
    this.channels = new Map(); // room id → { listeners: Set, ids: [subscription ids] }
    this.socket = null;
    this.session = null;
    this.keepalive = 10;
  }

  /** Hear `roomId`'s moderation events (`onEvent(type, event)`); returns what stops it. */
  watch(roomId, onEvent) {
    let channel = this.channels.get(roomId);
    if (!channel) {
      channel = { listeners: new Set(), ids: [] };
      this.channels.set(roomId, channel);
      if (this.session) this.subscribe(roomId, channel);
    }
    channel.listeners.add(onEvent);
    this.open();
    return () => {
      channel.listeners.delete(onEvent);
      if (channel.listeners.size || this.channels.get(roomId) !== channel) return;
      this.channels.delete(roomId);
      for (const id of channel.ids) twitchUnsubscribe(this.getAuth(), id).catch(() => {});
      if (!this.channels.size) this.close();
    };
  }

  open(url = SOCKET) {
    if (this.socket && url === SOCKET) return;
    const socket = new WebSocket(url);
    this.socket = socket;
    // The old socket of a move still speaks until the new one is welcomed.
    socket.addEventListener('message', (e) => (this.socket === socket || this.moving === socket) && this.receive(JSON.parse(e.data)));
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return; // moved, or closed on purpose
      const subscribed = [...this.channels.values()].some((c) => c.ids.length);
      this.close();
      // Again in a while; not when nothing could be subscribed (Twitch closes a socket left unused: no permission),
      // till a chat asks again (watch).
      if (subscribed) setTimeout(() => this.channels.size && this.open(), 5000);
    });
  }

  close() {
    clearTimeout(this.quiet);
    const sockets = [this.socket, this.moving];
    this.socket = this.session = this.moving = null;
    for (const socket of sockets) socket?.close();
  }

  /** A message from Twitch (tests speak for it here too). */
  receive({ metadata = {}, payload = {} }) {
    // Anything at all means the socket's alive; too long without, and it's dead: open another (and subscribe again).
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.socket?.close(), (this.keepalive + 10) * 1000);
    switch (metadata.message_type) {
      case 'session_welcome':
        this.keepalive = payload.session.keepalive_timeout_seconds || this.keepalive;
        this.session = payload.session.id;
        if (this.moving) {
          // The new socket of a reconnect: the old one goes, the subscriptions are already here.
          this.moving.close();
          this.moving = null;
        } else {
          // A new session: the old one's subscriptions went with it.
          for (const [roomId, channel] of this.channels) {
            channel.ids = [];
            this.subscribe(roomId, channel);
          }
        }
        return;
      case 'session_reconnect': {
        this.moving = this.socket;
        this.socket = null;
        return this.open(payload.session.reconnect_url);
      }
      case 'notification': {
        const channel = this.channels.get(payload.event?.broadcaster_user_id);
        for (const listener of channel?.listeners || []) listener(payload.subscription.type, payload.event);
        return;
      }
      default:
        return; // keepalives; revocations (a permission taken back) just stop coming
    }
  }

  subscribe(roomId, channel) {
    for (const [type, version] of MOD_EVENTS) {
      twitchSubscribe(this.getAuth(), type, version, roomId, this.session)
        .then((id) => channel.ids.push(id))
        .catch(() => {}); // a permission missing (Settings says which): that kind doesn't come
    }
  }
}
