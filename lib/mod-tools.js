/*
 * Moderating, for the channels you moderate: what Twitch's EventSub says moderators, AutoMod and suspicious users do
 * (lib/eventsub.js) made into the chat's lines; allowing or denying a held message; the "Moderate…" panel (a reason,
 * every length, ban, lifting a timeout or ban, a warning) and the chat modes panel (Twitch). ChatPane and Feed
 * (lib/chat.js) and the user card call these; the parsing is lib/moderation.js.
 */

import { formatClock, formatDuration, readableColor } from './format.js';
import { commandGroups } from './commands.js';
import { icon } from './icons.js';
import { automodWhy, modAction, parseDuration, shortDuration } from './moderation.js';
import { isModeration } from './notices.js';
import { twitchAnnounce, twitchAutomod, twitchChatSettings, twitchChatters, twitchRoles, twitchSetShieldMode, twitchShieldMode, twitchShoutout } from './twitch.js';
import { dropdown, el, iconButton } from './ui.js';

/* ---- Twitch's moderation events into the chat (lib/eventsub.js → Feed) ---- */

/** A moderator's line in the chat ("pond_police turned on slow mode"); also Kick's unbans (Feed). */
export function logMessage(feed, by, parts, reason) {
  const user = [...feed.chatters.values()].find((u) => u.name === by) || { id: '', login: by.toLowerCase(), name: by, color: '', badges: [] };
  return { id: `modlog-${feed.key}-${Date.now()}-${Math.random()}`, platform: feed.platform, kind: 'notice', time: Date.now(), user, text: '', system: '', event: { type: 'modlog', parts, reason } };
}

/** One of Twitch's moderation events for `feed` (a channel you moderate): its line, or a change to one already there. */
export function moderationEvent(feed, type, event) {
  const { pane } = feed;
  const shown = pane.ctx.settings.modLog;
  switch (type) {
    case 'channel.moderate': {
      const action = modAction(event);
      if (action?.lifted) feed.lift(action.lifted); // noted even when the lines aren't shown
      if (!action || !shown) return;
      if (action.kind === 'timeout') {
        // Who did it and why: on its line (Twitch's chat says only that it happened), now or when the line comes.
        feed.modBy.set(action.userId, { by: action.by, reason: action.reason, at: Date.now() });
        const its = (l) => l.feed === feed && isModeration(l.message) && l.message.user.id === action.userId && Date.now() - l.message.time < 15_000;
        // Still waiting for the next frame (both often come at once): drawn with it. Already drawn: drawn again.
        const waiting = pane.queue.findLast(its);
        if (waiting) return Object.assign(waiting.message.event, { by: action.by, reason: action.reason });
        const line = pane.lines.findLast(its);
        if (line) {
          Object.assign(line.message.event, { by: action.by, reason: action.reason });
          pane.redrawLine(line);
        }
        return;
      }
      if (action.kind === 'delete') {
        const line = pane.lines.find((l) => l.feed === feed && l.message.id === action.messageId);
        if (line) {
          line.message.deletedBy = action.by;
          pane.redrawLine(line);
        }
        return;
      }
      return pane.add(logMessage(feed, action.by, action.parts, action.reason), feed);
    }
    case 'automod.message.hold': {
      const user = feed.chatters.get(event.user_login) || { id: event.user_id, login: event.user_login, name: event.user_name || event.user_login, color: '', badges: [] };
      const held = { type: 'automod', messageId: event.message_id, why: automodWhy(event), status: '' };
      return pane.add({ id: `automod-${event.message_id}`, platform: 'twitch', kind: 'notice', time: Date.parse(event.held_at) || Date.now(), user, text: event.message?.text || '', nativeEmotes: [], system: '', event: held }, feed);
    }
    case 'automod.message.update': {
      const line = pane.lines.find((l) => l.message.id === `automod-${event.message_id}`);
      if (!line) return;
      const by = event.moderator_user_name ? ` by ${event.moderator_user_name}` : '';
      line.message.event.status = { approved: `Allowed${by}`, denied: `Denied${by}`, expired: 'Expired' }[String(event.status).toLowerCase()] || String(event.status);
      return pane.redrawLine(line);
    }
    case 'channel.suspicious_user.message':
    case 'channel.suspicious_user.update': {
      // Twitch watches this user (monitored) or holds their messages for mods (restricted): a tag on their lines.
      const status = event.low_trust_status;
      if (status === 'active_monitoring' || status === 'restricted') feed.suspicious.set(event.user_id, status);
      else feed.suspicious.delete(event.user_id);
      return pane.redrawUser((user) => user.id === event.user_id);
    }
    case 'channel.shield_mode.begin':
    case 'channel.shield_mode.end': {
      const on = type.endsWith('begin');
      feed.modes = { ...feed.modes, shield: on };
      pane.renderHead();
      if (shown && event.moderator_user_name) pane.add(logMessage(feed, event.moderator_user_name, [`turned ${on ? 'on' : 'off'} Shield Mode`], ''), feed);
      return;
    }
    default:
      return;
  }
}

/** Let a held message through, or not; its line says what became of it (Twitch's update says it again, with who). */
export function decideAutomod(pane, line, allow) {
  twitchAutomod(pane.ctx.auth, line.message.event.messageId, allow)
    .then(() => {
      line.message.event.status = allow ? 'Allowed' : 'Denied';
      pane.redrawLine(line);
    })
    .catch((error) => pane.system(error.message, line.feed));
}

/* ---- Panels ---- */

const button = (label, cls, onClick) => {
  const b = el('button', `btn btn-sm ${cls}`.trim(), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

/** What this chat saw of `user`'s timeouts and bans: "Timed out until 16:20 · 2 timeouts here lately", or ''. */
function modHistory(feed, user) {
  const past = feed.offensesOf(user);
  const held = feed.restriction(user);
  const timeouts = past.filter((o) => o.duration).length;
  const bans = past.length - timeouts;
  const count = (n, what) => n && `${n} ${what}${n === 1 ? '' : 's'}`;
  const counts = [count(timeouts, 'timeout'), count(bans, 'ban')].filter(Boolean).join(', ');
  return [held && (held.duration ? `Timed out until ${formatClock(held.time + held.duration * 1000)}` : 'Banned'), counts && `${counts} here lately`].filter(Boolean).join(' · ');
}

/**
 * "Moderate…": what this chat saw of them, a reason (typed, or one of Settings' saved ones), then a timeout of any of
 * your lengths or one typed, a ban, lifting a timeout or ban, or (Twitch) a warning, which needs the reason. Opened
 * from a message's menu or a card.
 */
export function openModPanel(pane, user, feed, event) {
  const panel = pane.modPanel;
  const tools = pane.modTools(feed, user);
  const { modTimeouts, modReasons } = pane.ctx.settings;
  const reason = Object.assign(el('input', 'input mod-reason'), { placeholder: 'Reason (optional)', maxLength: 500 });
  reason.addEventListener('input', () => reason.classList.remove('needed'));
  const why = () => reason.value.trim();
  const run = (task) => {
    panel.hidden = true;
    pane.modRun(task, feed);
  };
  const head = el('div', 'mod-head');
  head.append(el('strong', '', `Moderate ${user.name}`), iconButton('x', 'Close', () => (panel.hidden = true)));
  const reasons = el('div', 'mod-reasons');
  for (const saved of modReasons) reasons.append(button(saved, 'btn-ghost', () => ((reason.value = saved), reason.focus())));
  const lengths = el('div', 'mod-lengths');
  for (const seconds of modTimeouts) {
    const b = button(shortDuration(seconds), '', () => run(() => tools.timeout(seconds, why())));
    b.title = `Timeout ${formatDuration(seconds)}`;
    lengths.append(b);
  }
  // Another length, typed ("45m"): Enter times them out for it.
  const other = Object.assign(el('input', 'input mod-other'), { placeholder: 'other', title: 'Another length, like 45m or 2d: Enter', spellcheck: false });
  other.addEventListener('input', () => other.classList.remove('needed'));
  other.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const seconds = parseDuration(other.value);
    if (seconds) run(() => tools.timeout(seconds, why()));
    else other.classList.add('needed');
  });
  lengths.append(other);
  const more = el('div', 'mod-lengths');
  more.append(
    button('Ban', 'mod-danger', () => confirm(`Ban ${user.name} from ${feed.label}'s chat?`) && run(() => tools.ban(why()))),
    button('Lift timeout or ban', '', () => run(() => tools.unban())),
  );
  if (tools.warn) {
    more.append(
      button('Warn', '', () => {
        if (why()) return run(() => tools.warn(why()));
        reason.classList.add('needed');
        reason.focus();
      }),
    );
  }
  const history = modHistory(feed, user);
  panel.replaceChildren(head, ...(history ? [el('p', 'mod-history', history)] : []), reason, ...(modReasons.length ? [reasons] : []), el('span', 'mod-label', 'Timeout'), lengths, more);
  panel.hidden = false;
  pane.placeNear(panel, { x: event.clientX, y: event.clientY });
  reason.focus({ preventScroll: true });
}

/** Choices for a dropdown, with `value` among them when it isn't one of the usual. */
const withValue = (choices, value, label) => (choices.some(([v]) => v === value) ? choices : [...choices, [value, label(value)]].sort((a, b) => a[0] - b[0]));

/**
 * The header's moderation panel (Twitch, a channel you moderate): the chat modes (slow mode and followers-only with
 * their length, subscribers-only, emote-only, unique chat, Shield Mode; a change goes to Twitch at once, the header
 * shows it when Twitch says so), an announcement, and who's in chat.
 */
export function openModesPanel(pane, feed, event) {
  const panel = pane.modPanel;
  const auth = pane.ctx.auth;
  const modes = feed.modes;
  const apply = (settings) => twitchChatSettings(auth, feed.roomId, settings).catch((error) => pane.system(error.message, feed));
  const row = (label, control) => {
    const r = el('div', 'mod-row');
    r.append(el('span', 'mod-row-label', label), control);
    return r;
  };
  const slowNow = modes.slow || 0;
  const slow = dropdown(
    withValue([[0, 'Off'], [3, '3 seconds'], [5, '5 seconds'], [10, '10 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes']], slowNow, formatDuration),
    slowNow,
    (v) => apply(v ? { slow_mode: true, slow_mode_wait_time: v } : { slow_mode: false }),
    'Slow mode',
  );
  const followersNow = modes.followersOnly ?? -1;
  const followers = dropdown(
    withValue([[-1, 'Off'], [0, 'Any follower'], [10, '10 minutes'], [60, '1 hour'], [1440, '1 day'], [10_080, '1 week'], [43_200, '1 month']], followersNow, (m) => formatDuration(m * 60)),
    followersNow,
    (v) => apply(v < 0 ? { follower_mode: false } : { follower_mode: true, follower_mode_duration: v }),
    'Followers-only',
  );
  const toggle = (label, on, set) => {
    const b = el('button', 'mod-toggle', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(Boolean(on)));
    b.addEventListener('click', () => {
      const next = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(next));
      set(next);
    });
    return b;
  };
  const shield = toggle('Shield Mode', modes.shield, (on) =>
    twitchSetShieldMode(auth, feed.roomId, on)
      .then(() => ((feed.modes = { ...feed.modes, shield: on }), pane.renderHead()))
      .catch((error) => pane.system(error.message, feed)),
  );
  const toggles = el('div', 'mod-toggles');
  toggles.append(
    toggle('Subscribers-only', modes.subsOnly, (on) => apply({ subscriber_mode: on })),
    toggle('Emote-only', modes.emoteOnly, (on) => apply({ emote_mode: on })),
    toggle('Unique chat', modes.unique, (on) => apply({ unique_chat_mode: on })),
    shield,
  );
  // An announcement, in a colour.
  const say = Object.assign(el('input', 'input'), { placeholder: 'An announcement', maxLength: 500 });
  let color = 'primary';
  const colors = dropdown([['primary', 'Channel colour'], ['blue', 'Blue'], ['green', 'Green'], ['orange', 'Orange'], ['purple', 'Purple']], color, (v) => (color = v), 'Colour');
  const announce = el('form', 'mod-announce');
  announce.append(say, colors, button('Announce', 'btn-primary', () => announce.requestSubmit()));
  announce.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = say.value.trim();
    if (!text) return say.focus();
    twitchAnnounce(auth, feed.roomId, text, color).then(() => (say.value = ''), (error) => pane.system(error.message, feed));
  });
  const head = el('div', 'mod-head');
  head.append(el('strong', '', 'Moderation'), iconButton('x', 'Close', () => (panel.hidden = true)));
  const chatters = button("Who's in chat", 'mod-chatters', () => openChattersPanel(pane, feed, event));
  chatters.prepend(icon('users'));
  panel.replaceChildren(head, el('span', 'mod-label', 'Chat modes'), row('Slow mode', slow), row('Followers-only', followers), toggles, el('span', 'mod-label', 'Announce'), announce, chatters);
  panel.hidden = false;
  pane.placeNear(panel, { x: event.clientX, y: event.clientY });
  // Shield Mode isn't in Twitch's chat state: asked for once.
  if (modes.shield === undefined) {
    twitchShieldMode(auth, feed.roomId)
      .then((on) => {
        feed.modes = { ...feed.modes, shield: on };
        shield.setAttribute('aria-pressed', String(on));
      })
      .catch(() => {});
  }
}

/**
 * Who's in chat (Twitch tells moderators): how many, and their names to search, by role (the broadcaster, moderators,
 * VIPs, everyone else), in their chat colours when they've chatted here; a name opens their card. Up to 5,000
 * (lib/twitch.js twitchChatters); everyone else shows the first 200 that match.
 */
export function openChattersPanel(pane, feed, event) {
  const panel = pane.modPanel;
  const head = el('div', 'mod-head');
  const count = el('strong', '', 'In chat');
  head.append(count, iconButton('x', 'Close', () => (panel.hidden = true)));
  const find = Object.assign(el('input', 'input'), { type: 'search', placeholder: 'Find someone', disabled: true });
  const list = el('div', 'chatters-list');
  list.append(el('p', 'chatters-note', 'Asking Twitch…'));
  panel.replaceChildren(head, find, list);
  panel.hidden = false;
  pane.placeNear(panel, { x: event.clientX, y: event.clientY });
  Promise.all([twitchChatters(pane.ctx.auth, feed.roomId), twitchRoles(pane.ctx.auth, feed.roomId)]).then(
    ([{ total, users }, { mods, vips }]) => {
      count.textContent = `In chat · ${total.toLocaleString()}`;
      find.disabled = false;
      const roleOf = (u) => (u.id === feed.roomId ? 'Broadcaster' : mods.has(u.id) ? 'Moderators' : vips.has(u.id) ? 'VIPs' : 'Viewers');
      const nameButton = (u) => {
        const known = feed.chatters.get(u.login);
        const name = el('button', 'chatter', u.name);
        name.type = 'button';
        if (known?.color) name.style.color = readableColor(known.color, u.login);
        name.addEventListener('click', (e) => {
          panel.hidden = true;
          pane.openCard({ color: '', badges: [], ...known, id: u.id, login: u.login, name: u.name }, e, feed);
        });
        return name;
      };
      const show = () => {
        const q = find.value.trim().toLowerCase();
        const found = users.filter((u) => u.login.includes(q) || u.name.toLowerCase().includes(q));
        const sections = [];
        for (const role of ['Broadcaster', 'Moderators', 'VIPs', 'Viewers']) {
          const theirs = found.filter((u) => roleOf(u) === role);
          if (!theirs.length) continue;
          const names = el('div', 'chatters-names');
          names.append(...theirs.slice(0, 200).map(nameButton));
          if (theirs.length > 200) names.append(el('p', 'chatters-note', `And ${(theirs.length - 200).toLocaleString()} more: type to find them.`));
          sections.push(el('span', 'mod-label', role === 'Broadcaster' ? role : `${role} · ${theirs.length.toLocaleString()}`), names);
        }
        list.replaceChildren(...(sections.length ? sections : [el('p', 'chatters-note', 'No one by that name.')]));
      };
      find.addEventListener('input', show);
      show();
      find.focus({ preventScroll: true });
    },
    (error) => list.replaceChildren(el('p', 'chatters-note', error.message)),
  );
}

/**
 * /help's list, as a block in the chat: the commands `feed`'s platform has, by group, each with what it takes and does;
 * a mode's "off" beside it. A command clicked goes into the message box, to finish.
 */
export function commandsHelp(pane, feed) {
  const name = (n) => {
    const b = el('button', 'help-cmd', `/${n}`);
    b.type = 'button';
    b.addEventListener('click', () => pane.typeCommand(n));
    return b;
  };
  const wrap = el('div', 'command-help');
  const head = el('div', 'help-head');
  head.append(el('strong', '', 'Commands'), el('span', '', pane.merged ? `in ${feed.label} · click one to type it` : 'click one to type it'));
  // One grid for all the groups, so their columns line up.
  const list = el('div', 'help-rows');
  wrap.append(head, list);
  for (const [title, rows] of commandGroups(feed.platform)) {
    list.append(el('span', 'help-group', title));
    for (const [n, c, off] of rows) {
      // What it does (and its "off"), then what it takes.
      const about = el('span', 'help-about', c.about);
      if (off) about.append(' · ', name(off));
      if (c.usage) about.append(el('span', 'help-usage', `/${n} ${c.usage}`));
      list.append(name(n), about);
    }
  }
  return wrap;
}

/** Raids smaller than this don't need protecting. */
const RAID_PROTECT_FROM = 20;
const RAID_FOLLOWERS_FOR = 10 * 60_000;

/**
 * A raid coming into a channel you moderate (Twitch): a bar offering followers-only for 10 minutes (it turns off by
 * itself after, if it's still the one this set), Shield Mode, and a shoutout for the raider. Settings → Moderation
 * turns it off; it goes by itself after 3 minutes.
 */
export function offerRaidProtection(feed, message) {
  const { pane } = feed;
  const e = message.event;
  if (!feed.isMod || !pane.ctx.settings.raidProtect || !(e.viewers >= RAID_PROTECT_FROM)) return;
  const auth = pane.ctx.auth;
  const bar = el('div', 'raid-bar');
  const text = el('span', 'raid-text');
  text.append(el('strong', '', message.user.name), ` is raiding with ${e.viewers.toLocaleString()} viewers`);
  const done = (b, label) => {
    b.disabled = true;
    b.textContent = label;
  };
  const followers = button('Followers-only, 10 min', 'btn-primary', () => {
    if (feed.modes.followersOnly >= 0) return done(followers, 'Already followers-only');
    twitchChatSettings(auth, feed.roomId, { follower_mode: true, follower_mode_duration: 0 }).then(() => {
      done(followers, 'Followers-only on');
      setTimeout(() => {
        // Off again, unless someone changed it meanwhile.
        if (!feed.stopped && feed.modes.followersOnly === 0) twitchChatSettings(auth, feed.roomId, { follower_mode: false }).catch(() => {});
      }, RAID_FOLLOWERS_FOR);
    }, (error) => pane.system(error.message, feed));
  });
  const shield = button('Shield Mode', 'btn-ghost', () => twitchSetShieldMode(auth, feed.roomId, true).then(() => done(shield, 'Shield Mode on'), (error) => pane.system(error.message, feed)));
  const shoutout = button('Shout out', 'btn-ghost', () => twitchShoutout(auth, feed.roomId, message.user.id).then(() => done(shoutout, 'Shouted out'), (error) => pane.system(error.message, feed)));
  const actions = el('span', 'raid-actions');
  actions.append(followers, shield, ...(message.user.id ? [shoutout] : []));
  bar.append(text, iconButton('x', 'Not now', () => bar.remove()), actions);
  pane.root.querySelector('.raid-bar')?.remove();
  pane.filterRow.after(bar);
  setTimeout(() => bar.remove(), 3 * 60_000);
}
