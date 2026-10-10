/*
 * The user card (a name clicked in lib/chat.js): banner, picture, name,
 * badges and earlier names, a private note, stats (followers, account age,
 * sub, since when they follow), their messages (this chat, then their chat
 * logs, searchable), and quick actions (mention, reply, mod tools). Twitch's
 * and Kick's profiles fill in after it opens. Functions of the pane it's in.
 */

import { cheerParts, formatAgo, formatClock, formatCount, formatDay, formatDuration, formatMonth, readableColor, twitchParts } from './format.js';
import { icon } from './icons.js';
import { kickCardUser, kickChannel, kickEmoteUrl } from './kick.js';
import { logCount, logMonth, logMonths, nameHistory, recentFromUser, searchLogs } from './logs.js';
import { NOTICE_STYLE, eventSummary, isModeration } from './notices.js';
import { openModPanel } from './mod-tools.js';
import { shortDuration } from './moderation.js';
import { loadNotes, nicknameOf, saveNote, saveSettings } from './settings.js';
import { PLATFORM_NAMES, largerPicture } from './sources.js';
import { cheerColor, twitchEmoteUrl, twitchFollowedAt, twitchProfile } from './twitch.js';
import { el, iconButton, mentionName } from './ui.js';

/** "Load all" in a user card stops after this many log entries. */
const LOG_CAP = 20_000;

/** Younger than this, an account or a follow is new: the first sign of a throwaway account, so it stands out. */
const FRESH = 30 * 864e5;

/** "Joined Oct 2013", or when it's new `recent`'s words for it ("Joined 3 days ago") in the warning colour; the day on hover. */
function sinceRow(stat, iconName, label, at, recent) {
  const fresh = Date.now() - at < FRESH;
  const row = stat(iconName, label, { bold: fresh ? recent(at) : formatMonth(at) });
  row.classList.toggle('fresh', fresh);
  row.title = `${formatDay(at)} (${formatAgo(at)})`;
  return row;
}

/** "Following Mar 2021" (or "Following 3 days" when new, as "Subbed 14 months"), or "Not following". */
function followRow(stat, at) {
  return at ? sinceRow(stat, 'heart', 'Following ', at, (t) => formatDuration(Math.floor((Date.now() - t) / 1000))) : stat('heart', 'Not following');
}

/**
 * A profile card for whoever you clicked: banner, picture, name and badges,
 * bio, a few stats, their recent messages here, and quick actions. Twitch
 * profile details fill in when they arrive.
 */
export function openUserCard(pane, user, event, feed) {
  const card = pane.card;
  const twitch = feed.platform === 'twitch';
  const color = readableColor(user.color, user.login || user.name);
  delete card.dataset.moved; // dragged before: opens by the click again
  card.dataset.user = user.id;
  card.setAttribute('aria-label', `${user.name}'s user card`);

  // Banner (theirs on Twitch, else a wash of their colour) with the buttons on it.
  const banner = el('div', 'card-banner');
  banner.style.setProperty('--user-color', color);
  const tools = el('div', 'card-tools');
  if (user.login) {
    const star = iconButton('star', pane.isFriend(user) ? 'Remove from friends' : 'Add to friends', () => {
      pane.toggleFriend(user);
      const now = !star.classList.contains('on');
      star.classList.toggle('on', now);
      star.title = now ? 'Remove from friends' : 'Add to friends';
      star.setAttribute('aria-label', star.title);
    });
    star.classList.add('friend-btn');
    star.classList.toggle('on', pane.isFriend(user));
    tools.append(star);
  }
  tools.append(
    iconButton(feed.platform, `Open on ${PLATFORM_NAMES[feed.platform]}`, () =>
      window.open(feed.profileUrl(user), '_blank', 'noopener'),
    ),
    iconButton('x', 'Close', () => (card.hidden = true)),
  );
  banner.append(tools);
  pane.floating(card, banner, tools, 'card'); // drag it by the banner; 📌 keeps it open

  // Their picture fades in once it has loaded, in a circle that's there from the start.
  const frame = el('span', 'card-avatar-frame');
  const avatar = el('img', 'card-avatar');
  avatar.alt = '';
  avatar.addEventListener('load', () => frame.classList.add('loaded'));
  if (user.photo) avatar.src = user.photo;
  frame.append(avatar);
  zoomPicture(avatar, card);
  const name = el('strong', 'card-name', user.name);
  name.style.color = color;
  const role = el('span', 'card-role');
  role.hidden = true;
  const nameRow = el('div', 'card-name-row');
  nameRow.append(name, role);
  if (user.badges?.length) nameRow.append(pane.renderBadges(user.badges, feed));
  const who = el('div', 'card-who');
  who.append(nameRow);
  // Earlier names, from the log servers: "Previously [xqcow 2017–2022]", the latest first; the months on hover.
  if (twitch && pane.ctx.settings.cardLogs && /^\d+$/.test(user.id)) {
    nameHistory(user.id)
      .then((names) => {
        const earlier = names.filter((n) => n.login !== user.login?.toLowerCase());
        if (!earlier.length || card.hidden || !head.isConnected) return;
        const chip = (n) => {
          const [from, to] = [n.first, n.last].map((t) => new Date(t).getFullYear());
          const c = el('span', 'card-name-chip');
          c.append(el('strong', '', n.login), el('span', 'card-name-when', from === to ? String(to) : `${from}–${to}`));
          c.title = `${n.login}: ${formatMonth(n.first)} – ${formatMonth(n.last)}`;
          return c;
        };
        const line = el('div', 'card-names');
        line.append(el('span', '', 'Previously'), ...earlier.slice(0, 3).map(chip));
        // Some have had many: the rest on a click.
        if (earlier.length > 3) {
          const more = el('button', 'card-name-chip card-names-more', `+${earlier.length - 3} more`);
          more.type = 'button';
          more.addEventListener('click', () => more.replaceWith(...earlier.slice(3).map(chip)));
          line.append(more);
        }
        nameRow.after(line);
        placeCard(pane, event);
      })
      .catch(() => {}); // the card works without it
  }
  if (pane.merged) {
    const where = el('div', 'card-in', 'in ');
    where.append(pane.sourcePicture(feed, 'card-in-pic', pane.mixed), feed.label);
    who.append(where);
  }
  const head = el('div', 'card-head');
  head.append(frame, who);

  const bio = el('p', 'card-bio');
  bio.hidden = true;
  // A private note about them (synced with your settings; lib/settings.js saveNote).
  const note = el('textarea', 'input card-note-input');
  note.rows = 1;
  note.placeholder = 'Private note (only you see it)';
  note.setAttribute('aria-label', `Private note about ${user.name}`);
  const noteKey = (user.login || user.id || '').toLowerCase();
  // Not typed in before the notes have loaded (it would be lost, or overwritten); while they're still arriving
  // from another device, not at all (lib/settings.js saveNote won't save over them).
  note.disabled = true;
  loadNotes().then((notes) => {
    if (!notes) return void (note.placeholder = 'Notes are still syncing…');
    note.value = notes[noteKey] || '';
    note.disabled = false;
  });
  // Saved a second after you stop typing (synced storage takes a limited number of writes a minute).
  let saving = null;
  note.addEventListener('input', () => {
    clearTimeout(saving);
    saving = setTimeout(() => saveNote(noteKey, note.value.trim()), 1000);
  });
  // Leaving the box saves at once (the panel may be closing).
  note.addEventListener('change', () => {
    clearTimeout(saving);
    saveNote(noteKey, note.value.trim());
  });

  // Your own name for them, shown in chat in place of theirs (Settings → Friends lists them): beside the note.
  const about = el('div', 'card-private');
  if (user.login) {
    const login = user.login.toLowerCase();
    const nick = Object.assign(el('input', 'input card-nick-input'), { placeholder: 'Nickname', maxLength: 30, spellcheck: false, value: nicknameOf(pane.ctx.settings, login) });
    nick.setAttribute('aria-label', `Your nickname for ${user.name}`);
    nick.title = 'Shown in chat instead of their name (only you see it)';
    // Saved when you leave the box, or at Enter.
    nick.addEventListener('keydown', (e) => e.key === 'Enter' && nick.blur());
    nick.addEventListener('change', () => {
      const { [login]: old, ...rest } = pane.ctx.settings.nicknames;
      const now = nick.value.trim();
      if (now !== nicknameOf(pane.ctx.settings, login)) saveSettings({ nicknames: now ? { ...rest, [login]: now } : rest });
    });
    about.append(nick);
  }
  about.append(note);

  // Stats, one short line each: icon, then text with the key part in bold.
  const stats = el('div', 'card-stats');
  const stat = (iconName, ...parts) => {
    const row = el('div', `card-stat stat-${iconName}`);
    row.append(icon(iconName), ...parts.map((p) => (typeof p === 'string' ? p : el('strong', '', p.bold))));
    return row;
  };
  const sub = user.badges?.find((b) => b.set === 'subscriber' || b.set === 'founder');
  // "Subbed 14 months", the tier only above 1 ("· Tier 3"; always on hover), or "Tier 1 sub" when the months aren't known.
  // Kick has one kind of sub: tier 0.
  const subStat = (months, tier) => {
    const row = months
      ? stat('star', 'Subbed ', { bold: `${months} month${months === 1 ? '' : 's'}` }, tier > 1 ? ` · Tier ${tier}` : '')
      : stat('star', { bold: tier ? `Tier ${tier}` : 'Subscriber' }, tier ? ' sub' : '');
    if (tier) row.title = `Tier ${tier} sub`;
    return row;
  };
  if (sub || user.months) {
    // Twitch sub badge versions: 3000+ tier 3, 2000+ tier 2, else tier 1. Kick has one kind of sub.
    const tier = Number(sub?.version) >= 3000 ? 3 : Number(sub?.version) >= 2000 ? 2 : 1;
    stats.append(subStat(user.months, feed.platform === 'kick' ? 0 : tier));
  }
  // Since when they follow the channel: Twitch tells only its moderators and the broadcaster.
  if (twitch && feed.isMod && feed.roomId && user.id !== feed.roomId && pane.ctx.scopes.includes('moderator:read:followers')) {
    twitchFollowedAt(pane.ctx.auth, feed.roomId, user.id)
      .then((at) => {
        if (card.hidden || !head.isConnected) return;
        stats.append(followRow(stat, at));
        placeCard(pane, event);
      })
      .catch(() => {}); // the card works without it
  }

  // Their messages: in this chat now, then their chat logs (Twitch).
  // What they said, and their subs, gifts and raids (their timeouts and bans come with the offenses).
  const theirs = pane.lines.filter((l) => l.feed === feed && l.message.user?.id === user.id && (l.message.text || (l.message.event && !isModeration(l.message))));
  const theirOffenses = feed.offensesOf(user);
  const recent = cardHistory(pane, user, feed, [...theirs.map((l) => l.message), ...theirOffenses]);

  // Quick actions.
  const actions = el('div', 'card-actions');
  const action = (label, run) => {
    const btn = el('button', 'btn btn-sm card-action', label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      card.hidden = true;
      run();
    });
    return btn;
  };
  const canType = Boolean(pane.input) && pane.ctx.canWrite(feed) && !feed.banned;
  const last = theirs.findLast((l) => l.message.kind === 'chat' && !l.message.own);
  if (canType) {
    actions.append(
      action('Mention', () => {
        pane.setTarget(feed);
        pane.input.setRangeText(`@${mentionName(user)} `, pane.input.selectionStart, pane.input.selectionEnd, 'end');
        pane.input.focus();
      }),
    );
    if (last) actions.append(action('Reply', () => pane.setReply(last.message, feed)));
  }
  actions.append(action('Copy name', () => navigator.clipboard.writeText(user.name)));
  // Moderators: a timeout of your first three lengths (Settings → Moderation), ban, lifting their timeout or ban while
  // one holds, and the rest (a reason, any length, a warning) in "Moderate…".
  let mod = null;
  if (feed.isMod && user.id && !pane.ctx.isOwn(user, feed.platform)) {
    const run = (task) => pane.modRun(task, feed);
    const tools = pane.modTools(feed, user);
    mod = el('div', 'card-actions card-mod');
    const timeouts = el('span', 'card-timeouts');
    timeouts.setAttribute('role', 'group');
    timeouts.setAttribute('aria-label', 'Timeout');
    timeouts.append(icon('clock'));
    for (const seconds of pane.ctx.settings.modTimeouts.slice(0, 3)) {
      const b = action(shortDuration(seconds), () => run(() => tools.timeout(seconds)));
      b.title = `Timeout ${formatDuration(seconds)}`;
      timeouts.append(b);
    }
    const ban = action('Ban…', () => confirm(`Ban ${user.name} from ${feed.label}'s chat?`) && run(() => tools.ban()));
    ban.classList.add('danger');
    const held = feed.restriction(user);
    mod.append(timeouts, ban, ...(held ? [action(held.duration ? 'Lift timeout' : 'Unban', () => run(() => tools.unban()))] : []), action('Moderate…', () => openModPanel(pane, user, feed, event)));
  }

  card.replaceChildren(...[banner, head, bio, about, stats, recent, actions, mod].filter(Boolean));
  card.hidden = false;
  placeCard(pane, event);

  if (feed.platform === 'kick') return fillKickCard(pane, user, feed, { card, head, avatar, banner, role, bio, stats, stat, subStat, event, hasSub: Boolean(sub || user.months) });

  // Twitch profile: picture, banner, role, bio, account age, followers, live now.
  if (!twitch) return;
  twitchProfile(user.login)
    .then((p) => {
      if (!p || card.hidden || !head.isConnected) return;
      if (p.photo) avatar.src = p.photo;
      if (p.banner) banner.style.backgroundImage = `url("${p.banner}")`;
      // Partners get Twitch's verified check, as on Twitch; affiliates and staff a word (Twitch has no icon for affiliates).
      const verified = p.role === 'Partner';
      role.replaceChildren(verified ? icon('verified') : p.role);
      role.classList.toggle('is-verified', verified);
      role.title = verified ? 'Verified · Twitch Partner' : '';
      role.hidden = !p.role;
      bio.textContent = p.bio;
      bio.hidden = !p.bio;
      const rows = [];
      if (p.followers != null) rows.push(stat('user', { bold: formatCount(p.followers) }, p.followers === 1 ? ' follower' : ' followers'));
      if (p.createdAt) rows.push(sinceRow(stat, 'calendar', 'Joined ', p.createdAt, formatAgo));
      if (p.liveViewers != null) {
        const live = stat('radio', 'Live · ', { bold: formatCount(p.liveViewers) }, ' watching');
        live.classList.add('is-live');
        rows.push(live);
      }
      stats.prepend(...rows);
      placeCard(pane, event);
    })
    .catch(() => {}); // the card works without it
}

/**
 * Kick's part of a user card: in this channel (picture, since when they
 * follow and how long they've subscribed: public on Kick), then their own
 * channel (banner, bio, followers, verified, live now).
 */
function fillKickCard(pane, user, feed, { card, head, avatar, banner, role, bio, stats, stat, subStat, event, hasSub }) {
  Promise.all([
    // By username here ("awa_xo"); their channel by its slug ("awa-xo"). They differ for about one in ten.
    kickCardUser(feed.source.channel, user.name, feed.kickChannel?.subBadges).catch(() => null),
    kickChannel(user.login).catch(() => null),
  ]).then(([here, own]) => {
    if (card.hidden || !head.isConnected) return;
    const photo = here?.photo || own?.avatar;
    if (photo) avatar.src = photo;
    if (own?.banner) banner.style.backgroundImage = `url("${own.banner}")`;
    if (own?.verified) {
      role.replaceChildren(icon('verified'));
      role.classList.add('is-verified', 'kick');
      role.title = 'Verified on Kick';
      role.hidden = false;
    }
    bio.textContent = own?.bio || '';
    bio.hidden = !own?.bio;
    const rows = [];
    if (own) rows.push(stat('user', { bold: formatCount(own.followers) }, own.followers === 1 ? ' follower' : ' followers'));
    if (here?.subMonths && !hasSub) rows.push(subStat(here.subMonths, 0));
    if (here && user.id !== feed.roomId) rows.push(followRow(stat, here.followingSince));
    if (own?.live) {
      const live = stat('radio', 'Live · ', { bold: formatCount(own.live.viewers) }, ' watching');
      live.classList.add('is-live');
      rows.push(live);
    }
    stats.append(...rows); // in their places by CSS order
    placeCard(pane, event);
  });
}

/**
 * The user card's messages: what they said in this chat, then (Twitch, if
 * Settings allow) their chat logs from a public log server, the newest month first,
 * with "Load …" and "Load all" for earlier ones; without logs, their part of
 * the channel's last 800 messages. Grouped by day, newest at the bottom,
 * with their timeouts, bans, subs and so on, and a search box.
 */
function cardHistory(pane, user, feed, local) {
  const section = el('section', 'card-recent');
  const count = el('span', 'card-count');
  const note = el('span', 'card-note');
  const setNote = (text) => {
    note.textContent = text;
    note.title = text;
  };
  const title = el('h3', 'card-section', 'Messages');
  title.append(count, note);
  // Their timeouts and bans: counts, and a filter to see just those.
  const offenses = el('div', 'card-offenses');
  offenses.hidden = true;
  let only = null; // 'timeout' | 'ban' | null
  const search = el('input', 'input card-search');
  search.type = 'search';
  search.placeholder = 'Search their messages';
  search.setAttribute('aria-label', 'Search their messages');
  search.hidden = true;
  const list = el('div', 'card-messages');
  const bar = el('div', 'card-earlier-slot'); // what's loaded from the logs, and "Load …": above the list, always in view
  section.append(title, offenses, search, bar, list);

  const shown = new Map(local.map((m) => [m.id, m]));
  const searched = new Map(); // id → message the log server found in months not loaded (shown while searching)
  let logs = null; // { server, months not loaded yet }, once found
  let logsNote = ''; // the log server, once found
  const rows = new Map(); // id → row, built once
  let controls = null; // "Since … · N logged" and "Load …" / "All (N)"
  const render = (keepPlace) => {
    const fromBottom = list.scrollHeight - list.scrollTop;
    const q = search.value.trim().toLowerCase();
    const all = [...(q ? new Map([...searched, ...shown]) : shown).values()].sort((a, b) => a.time - b.time);
    const isBan = (m) => m.kind === 'timeout' && !m.duration;
    const isTimeout = (m) => m.kind === 'timeout' && m.duration > 0;
    const messages = all.filter(
      (m) => (!q || (m.text || '').toLowerCase().includes(q)) && (!only || (only === 'ban' ? isBan(m) : isTimeout(m))),
    );
    const narrowed = q || only;
    count.textContent = narrowed ? `${messages.length.toLocaleString()} of ${all.length.toLocaleString()}` : all.length.toLocaleString();
    renderOffenses(all.filter(isTimeout), all.filter(isBan));
    count.hidden = !all.length;
    search.hidden = all.length < 10;
    bar.replaceChildren(...(controls && !narrowed ? [controls] : []));
    const nodes = [];
    let day = '';
    for (const m of messages) {
      const label = formatDay(m.time);
      if (label !== day) nodes.push(el('div', 'card-day', (day = label)));
      if (!rows.has(m.id)) rows.set(m.id, cardRow(pane, m, feed));
      nodes.push(rows.get(m.id));
    }
    if (!messages.length) nodes.push(el('p', 'card-empty', narrowed ? 'Nothing matches.' : note.textContent ? 'Looking…' : 'No messages here yet.'));
    list.replaceChildren(...nodes);
    list.scrollTop = keepPlace ? list.scrollHeight - fromBottom : list.scrollHeight;
  };
  // "⏱ 37 timeouts · last 10 minutes, mon, oct 5" and "⛔ 1 ban": click one to see only those (again: all).
  function renderOffenses(timeouts, bans) {
    offenses.hidden = !timeouts.length && !bans.length;
    const chip = (kind, iconName, entries, label) => {
      if (!entries.length) return null;
      const last = entries.at(-1);
      const btn = el('button', `offense-chip ${kind}`);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(only === kind));
      btn.append(icon(iconName), el('strong', '', entries.length.toLocaleString()), ` ${label}${entries.length === 1 ? '' : 's'}`);
      const when = formatDay(last.time).replace(/^(Today|Yesterday)$/, (w) => w.toLowerCase()); // mid-sentence
      btn.append(el('span', 'offense-last', kind === 'timeout' ? `last ${formatDuration(last.duration)}, ${when}` : when));
      btn.addEventListener('click', () => {
        only = only === kind ? null : kind;
        render(false);
      });
      return btn;
    };
    offenses.replaceChildren(...[chip('timeout', 'clock', timeouts, 'timeout'), chip('ban', 'x', bans, 'ban')].filter(Boolean));
  }
  // Months not loaded yet: the log server searches all of them too (it can take a few seconds).
  let searchingFor = '';
  const searchAll = async () => {
    const q = search.value.trim();
    if (!logs?.months.length || q.length < 2 || q.toLowerCase() === searchingFor) return;
    searchingFor = q.toLowerCase();
    searched.clear(); // the last search's finds
    setNote('searching all their logs…');
    const found = await searchLogs(logs.server, channel, login, q).catch(() => null);
    if (!current() || searchingFor !== q.toLowerCase()) return;
    if (!found) searchingFor = ''; // the same words can try again
    for (const m of found || []) searched.set(m.id, m);
    // The server sends at most 500, the newest.
    setNote(!found ? "couldn't search all their logs" : `all their logs searched${found.length >= 500 ? ' · newest 500' : ''}`);
    render(false);
  };
  let typing = null;
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      if (logsNote && search.value.trim().length < 2) {
        searchingFor = '';
        setNote(logsNote);
      }
      render(false);
      searchAll();
    }, 150);
  });
  render();

  const login = user.login;
  if (feed.platform !== 'twitch' || !login || !pane.ctx.settings.cardLogs) return section;
  const channel = feed.source.channel;
  // Still this card (pinned or not): its list in a card that's still theirs and open.
  const current = () => list.isConnected && list.closest('.usercard')?.dataset.user === user.id && !list.closest('.usercard').hidden;
  const add = (entries) => entries.forEach((m) => shown.set(m.id, m));
  const monthName = ({ year, month }) => formatMonth(new Date(year, month - 1, 1));
  setNote('loading logs…');

  (async () => {
    const found = await logMonths(channel, login).catch(() => null);
    if (!current()) return;
    if (!found) {
      // Not in the logs: their part of what the channel said lately (that service is Settings → Show recent messages).
      if (!pane.ctx.settings.recentMessages) return setNote('');
      add(await recentFromUser(channel, login).catch(() => []));
      if (!current()) return;
      setNote('in the last 800 messages');
      return render();
    }
    const { server, months } = found;
    logs = found;
    const source = new URL(server).host;
    const total = logCount(server, channel, login).catch(() => null); // alongside the first month
    let count = null;
    let oldest = null;
    let stopped = false; // "All" stopped at LOG_CAP
    const failed = []; // months the server didn't send
    const loadNext = async () => {
      oldest = months.shift();
      setNote(`loading ${monthName(oldest)}…`);
      add(await logMonth(server, channel, login, oldest).catch(() => (failed.push(monthName(oldest)), [])));
    };
    const summary = () =>
      [
        `${months.length ? 'Since' : 'All since'} ${monthName(oldest)}`,
        count && `${count >= 10_000 ? formatCount(count) : count.toLocaleString()} logged`, // 439.5K; exact below 10,000
        stopped && `stopped at ${LOG_CAP.toLocaleString()}`,
        failed.length && `couldn't load ${failed.join(', ')}`,
      ]
        .filter(Boolean)
        .join(' · ');
    const showControls = () => {
      logsNote = source;
      setNote(source);
      // "Since Oct 2026 · 295,630 logged" (or "All since …" when there's nothing earlier), then the buttons.
      controls = el('div', 'card-earlier');
      controls.append(el('span', 'card-earlier-text', summary()));
      if (!months.length) return;
      const one = el('button', 'btn btn-sm', `Load ${monthName(months[0])}`);
      const all = el('button', 'btn btn-sm', `All (${months.length})`);
      all.title = `${months.length} more month${months.length === 1 ? '' : 's'}, up to ${LOG_CAP.toLocaleString()} messages`;
      // "Load all" stops at LOG_CAP entries (busy chatters have years of logs); "Load …" goes on from there.
      const load = async (everything) => {
        one.disabled = all.disabled = true;
        do await loadNext();
        while (everything && months.length && shown.size < LOG_CAP && current());
        if (!current()) return;
        stopped = everything && months.length > 0;
        showControls();
        render(true);
      };
      one.type = all.type = 'button';
      one.addEventListener('click', () => load(false));
      all.addEventListener('click', () => load(true));
      const actions = el('span', 'card-earlier-actions'); // together, so they wrap as one
      actions.append(one);
      if (months.length > 1) actions.append(all);
      controls.append(actions);
    };
    await loadNext();
    if (!current()) return;
    showControls();
    render();
    // The count when it comes (it can take longer than the month).
    count = await total;
    const text = current() && controls?.querySelector('.card-earlier-text');
    if (text && count) text.textContent = summary();
  })();
  return section;
}

/** One entry in the card: a message (with emotes), a sub or raid, or a timeout or ban. */
function cardRow(pane, m, feed) {
  const row = el('div', 'card-message');
  const time = el('span', 'ts', formatClock(m.time));
  if (m.kind === 'timeout') {
    row.classList.add('card-timeout');
    row.append(time, icon(m.duration ? 'clock' : 'x'), m.duration ? `Timed out for ${formatDuration(m.duration)}` : 'Banned');
    return row;
  }
  row.append(time);
  if (m.event) {
    const style = NOTICE_STYLE[m.event.type];
    const what = el('span', 'card-event', eventSummary(m.event) || m.system);
    if (style) {
      what.prepend(icon(style[0]));
      what.style.color = (m.event.type === 'cheer' && cheerColor(m.event.bits)) || style[1];
    }
    row.append(what);
  }
  const body = el('span', 'body');
  let parts = m.nativeEmotes ? twitchParts(m.text || '', m.nativeEmotes, feed.emotes, m.platform === 'kick' ? kickEmoteUrl : twitchEmoteUrl) : m.parts || [];
  if (m.event?.type === 'cheer') parts = cheerParts(parts, feed.cheermotes);
  pane.renderParts(body, parts);
  row.append(body);
  return row;
}

/**
 * Pointing at their picture shows it big, over the card from where it is. It's
 * in the card (fixed, so the card's edges don't cut it off), so it goes with it.
 */
function zoomPicture(avatar, card) {
  let big = null;
  avatar.addEventListener('mouseenter', () => {
    if (!avatar.src) return;
    const img = el('img', 'card-avatar-big');
    img.alt = '';
    const small = avatar.src;
    img.addEventListener('error', () => img.src !== small && (img.src = small)); // no bigger one: the one we have
    img.src = largerPicture(small);
    big = img;
    const r = avatar.getBoundingClientRect();
    const size = Math.min(200, innerWidth - 16, innerHeight - 16);
    Object.assign(big.style, {
      width: `${size}px`,
      height: `${size}px`,
      left: `${Math.max(8, Math.min(r.left, innerWidth - size - 8))}px`,
      top: `${Math.max(8, Math.min(r.top, innerHeight - size - 8))}px`,
    });
    card.append(big);
  });
  avatar.addEventListener('mouseleave', () => {
    big?.remove();
    big = null;
  });
}

/**
 * Near where you clicked, the whole card inside the pane. Placed again
 * whenever it changes size (the profile and logs fill in after it opens).
 */
function placeCard(pane, event) {
  if (event) pane.cardAnchor = { x: event.clientX, y: event.clientY };
  pane.cardResize ??= new ResizeObserver(() => placeCard(pane));
  pane.cardResize.observe(pane.card);
  if (!pane.card.dataset.moved) pane.placeNear(pane.card, pane.cardAnchor); // dragged: where you put it
}
