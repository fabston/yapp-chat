/*
 * Mentions inbox: messages that mention you (and your highlight words, if you chose), from
 * every open chat, kept on this device (chrome.storage.local, the last 100, so
 * the side panel and the chat window share it, and it's still there after the
 * browser restarts). background.js shows the unread count on the toolbar icon.
 */

import { escapeRe, formatAgo, formatClock, readableColor } from './format.js';
import { icon } from './icons.js';
import { el, platformBadge } from './ui.js';

const MAX = 100;

let saving = Promise.resolve(); // one read-and-write at a time: two mentions at once both count

/**
 * Record a mention: { id, source, label, avatar, user: { name, login, color }, text, parts (words and emotes),
 * match (what in it is your name or highlight word), time }.
 */
export function addMention(entry) {
  saving = saving.then(async () => {
    const { mentions = [], mentionsUnread = 0 } = await chrome.storage.local.get(['mentions', 'mentionsUnread']);
    if (mentions.some((m) => m.id === entry.id)) return false; // the same chat open in two places
    await chrome.storage.local.set({ mentions: [entry, ...mentions].slice(0, MAX), mentionsUnread: mentionsUnread + 1 });
    return true;
  }).catch(() => false);
  return saving;
}

let audio = null; // made at the first ping
let pinged = 0;

/** A short two-note ping (made here: no sound file), at most one every 3 seconds. */
export function mentionPing() {
  if (Date.now() - pinged < 3000) return;
  pinged = Date.now();
  try {
    audio ??= new AudioContext();
    audio.resume(); // a page nobody clicked in yet starts it suspended
    const now = audio.currentTime;
    for (const [pitch, at] of [[880, 0], [1320, 0.12]]) {
      const note = audio.createOscillator();
      const volume = audio.createGain();
      note.frequency.value = pitch;
      volume.gain.setValueAtTime(0.0001, now + at);
      volume.gain.exponentialRampToValueAtTime(0.15, now + at + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.25);
      note.connect(volume).connect(audio.destination);
      note.start(now + at);
      note.stop(now + at + 0.3);
    }
  } catch {
    // No sound here: the mention is in the inbox all the same.
  }
}

/**
 * A mention just went to the inbox from this page: the ping, and this window asking for attention (the taskbar
 * flashes, the Dock icon bounces) when it isn't in front, as Settings → Notifications says.
 */
export function mentionAlert(settings) {
  if (settings.mentionSound) mentionPing();
  // Where there are windows to ask (not in the Android app).
  if (settings.mentionFlash && chrome.windows?.getCurrent) {
    chrome.windows
      .getCurrent()
      .then((w) => !w.focused && chrome.windows.update(w.id, { drawAttention: true }))
      .catch(() => {});
  }
}

/** Settings at one of its sections, in a tab. */
const openSettings = (section) => chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#${section}`) });

/** A mention's text as chat shows it: emotes as pictures, what matched marked. */
function mentionText(m) {
  const text = el('div', 'mention-text');
  const marked = m.match ? new RegExp(`(${escapeRe(m.match)})`, 'i') : null;
  for (const part of m.parts || [{ type: 'text', text: m.text }]) {
    if (part.type === 'emote') {
      const img = el('img', 'emote');
      img.src = part.url;
      img.alt = img.title = part.name;
      text.append(img);
      continue;
    }
    // Split around the match (the odd pieces are it).
    (marked ? part.text.split(marked) : [part.text]).forEach((piece, i) => piece && text.append(i % 2 ? el('mark', '', piece) : piece));
  }
  return text;
}

/** With nothing in it: what it's waiting for, with your setup (and signing in, if that's what it needs). */
function emptyState(ctx) {
  const names = [...new Set([ctx.auth.login, ctx.kickAuth.login].filter(Boolean))];
  const words = ctx.settings.mentionWords ? ctx.settings.highlightWords.length : 0; // only if they're collected too
  const wordsText = words === 1 ? 'your highlight word' : `one of your ${words} highlight words`;
  const box = el('div', 'mentions-empty');
  box.append(el('span', 'mentions-empty-icon'));
  box.firstChild.append(icon('bell'));
  box.append(el('strong', '', 'Nothing here yet'));
  box.append(
    el(
      'p',
      '',
      names.length
        ? `When someone writes @${names.join(' or @')}${words ? `, or ${wordsText}` : ''}, it lands here.`
        : words
          ? `When someone says ${wordsText}, it lands here. Sign in, and mentions of your name do too.`
          : 'When someone mentions you, it lands here. Sign in, so Yapp Chat knows your name.',
    ),
  );
  if (!names.length) {
    const signIn = el('button', 'btn btn-sm', 'Sign in to Twitch or Kick');
    signIn.type = 'button';
    signIn.addEventListener('click', () => openSettings('accounts'));
    box.append(signIn);
  }
  return box;
}

/**
 * The 🔔 button for a header: the unread count on it, and a list of your
 * mentions under it. `onOpen(source, id)` opens the chat a mention came from, at that message.
 */
export function mentionsButton({ ctx, onOpen }) {
  const btn = el('button', 'btn btn-ghost btn-sm btn-icon mentions-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Mentions');
  btn.setAttribute('aria-haspopup', 'dialog');
  const count = el('span', 'mentions-count');
  count.hidden = true;
  btn.append(icon('bell'), count);

  const pop = el('div', 'mentions-pop');
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Mentions');
  document.body.append(pop);
  btn.setAttribute('aria-expanded', 'false');
  let unseen = 0; // unread when the list opened: those stay marked new while it's open
  let latest = 0;
  /** Open or close the list (and say so to screen readers). */
  const setOpen = (open) => {
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (!open) unseen = 0;
  };

  const render = async () => {
    const { mentions = [], mentionsUnread = 0 } = await chrome.storage.local.get(['mentions', 'mentionsUnread']);
    latest = mentionsUnread;
    count.hidden = !mentionsUnread;
    count.textContent = mentionsUnread > 99 ? '99+' : String(mentionsUnread);
    btn.setAttribute('aria-label', mentionsUnread ? `Mentions, ${mentionsUnread} new` : 'Mentions');
    if (pop.hidden) return;
    const head = el('div', 'mentions-head');
    head.append(el('strong', '', 'Mentions'));
    if (mentions.length) {
      const clear = el('button', 'link-btn', 'Clear');
      clear.type = 'button';
      clear.addEventListener('click', () => chrome.storage.local.set({ mentions: [], mentionsUnread: 0 }));
      head.append(clear);
    }
    const list = el('div', 'mentions-list');
    const fresh = unseen + mentionsUnread; // newest first: these many are new
    mentions.forEach((m, i) => {
      const row = el('button', i < fresh ? 'mention-row new' : 'mention-row');
      row.type = 'button';
      const pic = el('span', 'source-pic mention-source');
      const avatar = el('img', 'source-avatar');
      avatar.alt = '';
      if (m.avatar) avatar.src = m.avatar;
      pic.append(avatar, platformBadge(m.source.platform));
      const top = el('div', 'mention-top');
      const name = el('strong', '', m.user.name);
      name.style.color = readableColor(m.user.color, m.user.login || m.user.name);
      const when = el('span', 'mention-where', `in ${m.label} · ${formatAgo(m.time)}`);
      when.title = formatClock(m.time);
      top.append(name, when);
      const body = el('div', 'mention-body');
      body.append(top, mentionText(m));
      row.append(pic, body);
      row.addEventListener('click', () => {
        setOpen(false);
        onOpen(m.source, m.id);
      });
      list.append(row);
    });
    if (!mentions.length) list.append(emptyState(ctx));
    pop.replaceChildren(head, list);
  };

  btn.addEventListener('click', async () => {
    const open = pop.hidden;
    setOpen(open);
    if (open) {
      const r = btn.getBoundingClientRect();
      pop.style.top = `${r.bottom + 6}px`;
      pop.style.right = `${Math.max(8, innerWidth - r.right)}px`;
      unseen = latest;
      await chrome.storage.local.set({ mentionsUnread: 0 }); // seen (they stay marked new while it's open)
    }
    render();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.mentions || changes.mentionsUnread)) render();
  });
  ctx.addEventListener('reload', render); // signed in, highlight words changed: the empty state says so
  render();
  return btn;
}
