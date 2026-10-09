/*
 * Settings page: sections in a sidebar (Accounts, Chat, Appearance with a live preview, Highlights, Hidden,
 * Notifications, Friends, Emotes, Privacy & data, About), and a search over them.
 */

import { icon } from './lib/icons.js';
import { backupText, CHAT_FONTS, clearNotes, COMMON_BOTS, DEFAULTS, EMOTE_SIZES, FONT_SIZES, isNotesKey, liveExceptWith, loadKickAuth, loadNotes, loadSettings, loadTwitchAuth, notifiesFor, readBackup, saveKickAuth, saveNotes, saveSettings, saveTwitchAuth } from './lib/settings.js';
import { kickPicture, kickSignIn, kickSignOut } from './lib/kick.js';
import { entryRegex, patternFor, readableColor, setNameTheme } from './lib/format.js';
import { freshTwitchAuth, twitchFollowedChannels, twitchProfile, twitchSignIn, twitchSignOut, validateToken } from './lib/twitch.js';
import { dropdown, el, platformBadge } from './lib/ui.js';

const $ = (id) => document.getElementById(id);

const EMOTE_SETS = [
  ['bttv', 'BetterTTV', 'betterttv.com'],
  ['ffz', 'FrankerFaceZ', 'frankerfacez.com'],
  ['seventv', '7TV', '7tv.app'],
];

let settings = await loadSettings();
let auth = await loadTwitchAuth();
let kickAuth = await loadKickAuth();

/** A line under a sign-in: what just happened. Good news fades after a few seconds; errors stay until the next try. */
function showStatus(id, text, ok) {
  const box = $(id);
  box.textContent = text;
  box.className = `status-msg ${ok ? 'ok' : 'err'}`;
  clearTimeout(box.fade);
  if (ok) box.fade = setTimeout(() => box.textContent === text && (box.textContent = ''), 5000);
}

const setStatus = (text, ok = true) => showStatus('accountStatus', text, ok);
const setKickStatus = (text, ok = true) => showStatus('kickStatus', text, ok);

function switchRow(id, on) {
  $(id).setAttribute('aria-checked', String(on));
}

/** Your picture beside your name, with the platform's badge on its corner (an empty circle until it loads). */
function showPicture(id, platform, url) {
  const pic = $(id);
  if (!pic.querySelector('.platform-badge')) pic.append(platformBadge(platform));
  const img = pic.querySelector('img');
  if (url && img.getAttribute('src') !== url) img.src = url;
}

let kickPictureAsked = false;

/** Twitch's from your public profile; Kick's kept at sign-in, or asked for once for a sign-in from before. */
function renderPictures() {
  if (auth.token) {
    showPicture('accountPic', 'twitch');
    twitchProfile(auth.login)
      .then((p) => showPicture('accountPic', 'twitch', p?.photo))
      .catch(() => {});
  }
  if (kickAuth.token) {
    showPicture('kickPic', 'kick', kickAuth.picture);
    if (!kickAuth.picture && !kickPictureAsked) {
      kickPictureAsked = true;
      kickPicture(kickAuth)
        .then((url) => {
          if (!url || !kickAuth.token) return;
          kickAuth.picture = url;
          saveKickAuth(kickAuth);
          showPicture('kickPic', 'kick', url);
        })
        .catch(() => {});
    }
  }
}

/* ---- Live notifications: which channels ---- */

let followed = null; // the channels you follow, asked once the list first shows: Promise<[{ login, name, avatar }]>
const liveRows = new Map(); // login → its switch

/** Under "Notify when…": every channel you follow with its own switch (all on, but those you turn off). */
function renderLiveChannels() {
  const shown = settings.liveNotify && Boolean(auth.token);
  $('liveChannels').hidden = !shown;
  if (!shown) return;
  if (!followed) {
    $('liveCount').textContent = 'Loading the channels you follow…';
    const asked = (followed = twitchFollowedChannels(auth));
    // Only if it's still the one asked for (not another account's, signed in meanwhile).
    asked.then(
      (channels) => asked === followed && drawLiveChannels(channels),
      (error) => {
        if (asked !== followed) return;
        followed = null; // asked again next time
        $('liveCount').textContent = error.status === 401 ? 'Sign in to Twitch again to choose channels (Accounts, above).' : "Couldn't load the channels you follow. Try again later.";
      },
    );
  } else {
    followed.then(showLiveChoices, () => {});
  }
}

function drawLiveChannels(channels) {
  liveRows.clear();
  $('liveList').replaceChildren(
    ...channels.map(({ login, name, avatar }) => {
      const row = el('button', 'live-channel');
      row.type = 'button';
      row.setAttribute('role', 'switch');
      row.dataset.find = `${login} ${name.toLowerCase()}`;
      const pic = el('img', 'live-pic');
      pic.alt = '';
      pic.loading = 'lazy';
      if (avatar) pic.src = avatar;
      const toggle = el('span', 'switch');
      toggle.setAttribute('aria-hidden', 'true');
      row.append(pic, el('span', 'live-name', name), toggle);
      row.addEventListener('click', () => saveSettings({ liveExcept: liveExceptWith(settings, login, !notifiesFor(settings, login)) }));
      liveRows.set(login, row);
      const li = el('li');
      li.append(row);
      return li;
    }),
  );
  showLiveChoices(channels);
}

/** Each channel's switch, how many notify, and the search. */
function showLiveChoices(channels) {
  for (const [login, row] of liveRows) row.setAttribute('aria-checked', String(notifiesFor(settings, login)));
  const on = channels.filter((c) => notifiesFor(settings, c.login)).length;
  $('liveCount').textContent = channels.length ? `Notifying for ${on} of the ${channels.length} channel${channels.length === 1 ? '' : 's'} you follow` : "You don't follow any channels on Twitch yet.";
  filterLiveChannels();
}

function filterLiveChannels() {
  const term = $('liveFilter').value.trim().toLowerCase();
  for (const row of liveRows.values()) row.parentElement.hidden = Boolean(term) && !row.dataset.find.includes(term);
}

$('liveFilter').addEventListener('input', filterLiveChannels);
$('liveAllOn').addEventListener('click', () => saveSettings({ liveAll: true, liveExcept: [] }));
$('liveAllOff').addEventListener('click', () => saveSettings({ liveAll: false, liveExcept: [] }));

/**
 * An entry as shown in a list or the regex builder: a /regex/ with its parts coloured as regex tools do (escapes,
 * character classes, quantifiers, groups, alternatives, anchors; the slashes and flags quiet); anything else as text.
 */
function entryView(entry) {
  let re = null;
  try {
    re = entryRegex(entry);
  } catch {
    // a broken one (from an old backup): as text
  }
  if (!re) return document.createTextNode(entry);
  const code = el('code', 'rx');
  const part = (kind, text) => code.append(kind ? el('span', `rx-${kind}`, text) : text);
  const src = re.source;
  part('delim', '/');
  for (let i = 0; i < src.length; ) {
    const rest = src.slice(i);
    const quant = /^(?:[*+?]|\{\d+(?:,\d*)?\})\??/.exec(rest)?.[0];
    const token =
      (rest[0] === '\\' && ['escape', rest.slice(0, 2)]) ||
      (rest[0] === '[' && ['class', /^\[\^?\]?(?:\\.|[^\]\\])*\]?/.exec(rest)[0]]) ||
      (rest[0] === '(' && ['group', /^\((?:\?(?:[:=!]|<[=!]|<\w+>))?/.exec(rest)[0]]) ||
      (rest[0] === ')' && ['group', ')']) ||
      (quant && ['quant', quant]) ||
      (rest[0] === '|' && ['alt', '|']) ||
      ('^$'.includes(rest[0]) && ['anchor', rest[0]]) ||
      (rest[0] === '.' && ['escape', '.']) || ['', /^[^\\[()*+?{|^$.]+/.exec(rest)?.[0] || rest[0]];
    part(...token);
    i += token[1].length;
  }
  part('delim', '/');
  if (re.flags) part('flags', re.flags);
  return code;
}

/** A list of names or words from settings[key], each with a ✕ that removes it, or `empty` when there are none. */
function renderList(id, key, empty, removeLabel) {
  const items = settings[key].map((value) => {
    const li = document.createElement('li');
    li.append(entryView(value));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-ghost btn-icon';
    remove.title = 'Remove';
    remove.setAttribute('aria-label', removeLabel(value));
    remove.append(icon('x'));
    remove.addEventListener('click', () => saveSettings({ [key]: settings[key].filter((v) => v !== value) }));
    li.append(remove);
    return li;
  });
  $(id).replaceChildren(...(items.length ? items : [Object.assign(document.createElement('li'), { className: 'none', textContent: empty })]));
}

function render() {
  renderPictures();
  $('signedIn').hidden = !auth.token;
  $('signedOut').hidden = Boolean(auth.token);
  $('accountName').textContent = auth.login || '';
  $('kickSignedIn').hidden = !kickAuth.token;
  $('kickSignedOut').hidden = Boolean(kickAuth.token);
  $('kickName').textContent = kickAuth.name || '';

  switchRow('highlightNameRow', settings.highlightName);
  switchRow('autoOpenRow', settings.autoOpen);
  switchRow('recentRow', settings.recentMessages);
  switchRow('cardLogsRow', settings.cardLogs);
  switchRow('timestampsRow', settings.timestamps);
  switchRow('badgesRow', settings.badges);
  switchRow('altRowsRow', settings.altRows);
  switchRow('cosmeticsRow', settings.cosmetics);
  // Live notifications ask Twitch which channels you follow: off, and saying so, until you're signed in.
  $('liveNotifyRow').disabled = !auth.token;
  switchRow('liveNotifyRow', settings.liveNotify && Boolean(auth.token));
  $('liveNotifyDesc').textContent = auth.token ? 'A desktop notification; click it to open the stream. For all of them, or the ones you choose below.' : 'Sign in to Twitch first (Accounts, above).';
  renderLiveChannels();
  applyTheme();
  renderPreview();
  renderData();
  searchSettings(); // what was just drawn, filtered as the search says
  for (const [id, key] of [['themeChoices', 'theme'], ['densityChoices', 'density'], ['fontChoices', 'chatFont']]) {
    for (const btn of $(id).children) btn.setAttribute('aria-pressed', String(btn.dataset.value === settings[key]));
  }
  renderList('friendList', 'friends', 'No friends yet.', (login) => `Remove ${login} from friends`);
  switchRow('holdAnywhereRow', settings.holdAnywhere);
  switchRow('foldRow', settings.foldRepeats);
  // Similar messages fold only where repeats do.
  $('foldSimilarRow').disabled = !settings.foldRepeats;
  switchRow('foldSimilarRow', settings.foldSimilar && settings.foldRepeats);
  switchRow('hideCommandsRow', settings.hideCommands);
  switchRow('hideBotsRow', settings.hideBots);

  renderList('hiddenList', 'hiddenUsers', 'No one hidden.', (login) => `Show messages from ${login} again`);
  renderList('wordList', 'highlightWords', 'No words yet.', (word) => `Stop highlighting ${word}`);
  renderList('hiddenWordList', 'hiddenWords', 'No words yet.', (word) => `Stop hiding ${word}`);

  $('emoteRows').replaceChildren(
    ...EMOTE_SETS.map(([key, name, site]) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'setting-row';
      row.setAttribute('role', 'switch');
      row.setAttribute('aria-checked', String(settings.emotes[key]));
      row.innerHTML = '<span class="setting-text"><span class="setting-title"></span><span class="setting-desc"></span></span><span class="switch" aria-hidden="true"></span>';
      row.querySelector('.setting-title').textContent = name;
      row.querySelector('.setting-desc').textContent = `Loads emote lists and images from ${site}.`;
      row.addEventListener('click', () => saveSettings({ emotes: { ...settings.emotes, [key]: !settings.emotes[key] } }));
      return row;
    }),
  );

  for (const btn of $('sizeChoices').children) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.size) === settings.fontSize));
  }
  for (const btn of $('emoteSizeChoices').children) {
    btn.setAttribute('aria-pressed', String(btn.textContent === settings.emoteSize));
  }
}

/* ---- Accounts: Twitch and Kick, each signed in with one click through Yapp Chat's app ---- */

/**
 * A sign-in button while it works: a spinner and what's happening ("Waiting for Twitch…" while its window is
 * open, "Signing in…" once you've approved); `text` left out puts it back as it was.
 */
function setBusy(button, text) {
  if (!button) return;
  if (text) {
    button.dataset.idle ??= button.innerHTML;
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    button.replaceChildren(spinner, text);
    button.classList.add('busy');
    button.disabled = true;
  } else if (button.dataset.idle) {
    button.innerHTML = button.dataset.idle;
    delete button.dataset.idle;
    button.classList.remove('busy');
    button.disabled = false;
  }
}

/** Closing the platform's window isn't a failure: Chrome says "The user did not approve access." */
const cancelled = (error) => /did not approve|cancel/i.test(error.message);

async function signIn(button) {
  setStatus(''); // the last try's message goes
  setBusy(button, 'Waiting for Twitch…');
  try {
    const before = auth;
    auth = await twitchSignIn(() => setBusy(button, 'Signing in…'));
    await saveTwitchAuth(auth);
    if (before.token && before.token !== auth.token) twitchSignOut(before); // signing in again: the old one revoked
    setStatus(`Signed in as ${auth.login}.`);
  } catch (error) {
    if (cancelled(error)) setStatus('Sign-in cancelled.');
    else setStatus(`Couldn't sign in: ${error.message}`, false);
  }
  setBusy(button);
  render();
}
$('twitchQuickBtn').addEventListener('click', (e) => signIn(e.currentTarget));

/** Permissions newer features need, and what each one turns on. */
const SCOPE_FEATURES = [
  ['user:read:emotes', 'your own emotes in suggestions and the emote picker'],
  ['user:read:follows', 'live channels you follow, in suggestions and notifications'],
  ['moderator:manage:banned_users', 'mod tools: timeout and ban'],
  ['moderator:manage:chat_messages', 'mod tools: delete messages'],
  ['moderator:read:followers', 'mod tools: since when someone follows, in their user card'],
];

/** Signed in before some features asked for their permission: say what's missing, and fix it in one click. */
async function checkScopes() {
  const box = $('scopeHealth');
  if (auth.token) await freshTwitchAuth(auth).catch(() => {});
  const info = auth.token ? await validateToken(auth.token).catch(() => null) : null;
  const missing = info ? SCOPE_FEATURES.filter(([scope]) => !info.scopes?.includes(scope)) : [];
  box.hidden = !missing.length;
  if (!missing.length) return;
  const list = document.createElement('ul');
  list.append(...missing.map(([, what]) => Object.assign(document.createElement('li'), { textContent: what })));
  const again = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-primary btn-sm', textContent: 'Sign in again' });
  again.addEventListener('click', () => signIn(again));
  box.replaceChildren(
    Object.assign(document.createElement('strong'), { textContent: 'Your sign-in is from before some features.' }),
    Object.assign(document.createElement('p'), { textContent: 'Sign in again to turn on:' }),
    list,
    again,
  );
}

$('signOutBtn').addEventListener('click', async () => {
  await twitchSignOut(auth);
  auth = {};
  await saveTwitchAuth(auth);
  setStatus('Signed out. Chat stays readable.');
  render();
});

$('kickQuickBtn').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  setKickStatus('');
  setBusy(button, 'Waiting for Kick…');
  try {
    kickAuth = await kickSignIn(() => setBusy(button, 'Signing in…'));
    await saveKickAuth(kickAuth);
    setKickStatus(`Signed in as ${kickAuth.name}.`);
  } catch (error) {
    if (cancelled(error)) setKickStatus('Sign-in cancelled.');
    else setKickStatus(`Couldn't sign in: ${error.message}`, false);
  }
  setBusy(button);
  render();
});

$('kickSignOutBtn').addEventListener('click', async () => {
  await kickSignOut(kickAuth);
  kickAuth = {};
  await saveKickAuth(kickAuth);
  setKickStatus('Signed out. Kick chat stays readable.');
  render();
});

/* ---- Highlights, display ---- */

$('highlightNameRow').addEventListener('click', () => saveSettings({ highlightName: !settings.highlightName }));
$('autoOpenRow').addEventListener('click', () => saveSettings({ autoOpen: !settings.autoOpen }));
$('recentRow').addEventListener('click', () => saveSettings({ recentMessages: !settings.recentMessages }));
$('cardLogsRow').addEventListener('click', () => saveSettings({ cardLogs: !settings.cardLogs }));
$('timestampsRow').addEventListener('click', () => saveSettings({ timestamps: !settings.timestamps }));
$('badgesRow').addEventListener('click', () => saveSettings({ badges: !settings.badges }));
$('altRowsRow').addEventListener('click', () => saveSettings({ altRows: !settings.altRows }));
$('cosmeticsRow').addEventListener('click', () => saveSettings({ cosmetics: !settings.cosmetics }));
$('liveNotifyRow').addEventListener('click', () => saveSettings({ liveNotify: !settings.liveNotify }));

/* ---- Appearance preview ---- */

/** A small chat drawn with the current appearance settings, using the chat's own styles. */
function renderPreview() {
  const root = document.documentElement;
  root.dataset.density = settings.density;
  root.style.setProperty('--chat-size', `${settings.fontSize}px`);
  root.style.setProperty('--emote-scale', EMOTE_SIZES[settings.emoteSize]);
  root.style.setProperty('--chat-font', CHAT_FONTS[settings.chatFont][1]);
  root.classList.toggle('alt-rows', settings.altRows);
  setNameTheme(root.dataset.theme === 'light');

  const emote = (id, name) => {
    const stack = el('span', 'emote-stack');
    const img = el('img', 'emote');
    img.src = `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;
    img.alt = name;
    stack.append(img);
    return stack;
  };
  const line = ({ name, color, badges = [], body, time, paint, extra = [], fold, reply, first }) => {
    const msg = el('div', first ? 'msg first' : 'msg');
    if (first) {
      const label = el('div', 'first-line');
      label.append(icon('sparkles'), 'First message');
      msg.append(label);
    }
    if (reply) {
      const r = el('div', 'reply-line');
      r.append(el('span', 'reply-to', `@${reply[0]}`), el('span', 'reply-body', reply[1]));
      msg.append(r);
    }
    if (settings.timestamps) msg.append(el('span', 'ts', time));
    if (settings.badges && badges.length) {
      const wrap = el('span', 'badges');
      for (const [letter, kind] of badges) {
        const pill = el('span', 'badge-pill', letter);
        pill.dataset.kind = kind;
        wrap.append(pill);
      }
      msg.append(wrap);
    }
    const who = el('span', 'name', name);
    who.style.color = readableColor(color, name);
    if (paint && settings.cosmetics) {
      who.classList.add('painted');
      who.style.backgroundImage = paint;
    }
    msg.append(who, el('span', 'sep', ': '), ...body, ...extra);
    if (fold) msg.append(el('span', 'fold-count', fold));
    return msg;
  };
  const notice = el('div', 'msg notice');
  notice.style.setProperty('--notice', '#a970ff');
  const head = el('div', 'notice-head');
  const badge = el('span', 'notice-icon');
  badge.append(icon('star'));
  const title = el('span', 'notice-title');
  title.append(Object.assign(el('strong', '', 'MapleSyrup'), { style: `color:${readableColor('#FF7A59', 'MapleSyrup')}` }), ' resubscribed');
  head.append(badge, title, el('span', 'notice-pill', 'Tier 1'), el('span', 'notice-pill', '35 months'));
  notice.append(head);

  $('preview').replaceChildren(
    line({ name: 'PixelPanda', color: '#7C4DFF', badges: [['B', 'broadcaster']], body: ['welcome in chat ', emote(25, 'Kappa')], time: '21:04' }),
    line({ name: 'PogFan', color: '#FF4500', badges: [['M', 'moderator'], ['S', 'subscriber']], body: [emote(425618, 'LUL'), ' that was so close'], time: '21:04' }),
    line({ name: 'Painted_Name', color: '#8A2BE2', badges: [['S', 'subscriber']], body: ['my 7TV paint ', emote(41, 'Kreygasm')], time: '21:05', paint: 'linear-gradient(90deg, #ff5f6d, #ffc371, #2ec5ff)' }),
    notice,
    line({ name: 'quiet_viewer', color: '#2E8B57', body: ['first time here'], time: '21:05', fold: '×3', first: true }),
    line({ name: 'Jordan', color: '#DAA520', body: ['same, it was insane'], time: '21:06', reply: ['PogFan', 'that was so close'] }),
  );
}

/* ---- Privacy & data: what Yapp Chat keeps ---- */

async function renderData() {
  const [notes, { emoteUse = {} }, { mentions = [] }] = await Promise.all([loadNotes(), chrome.storage.local.get('emoteUse'), chrome.storage.session.get('mentions')]);
  const rows = [
    ['Private notes about people (synced)', Object.keys(notes || {}).length, 'note', clearNotes],
    ['Emotes you used (for Recent; this device)', Object.keys(emoteUse).length, 'emote', () => chrome.storage.local.remove('emoteUse')],
    ['Mentions inbox (until the browser closes)', mentions.length, 'mention', () => chrome.storage.session.set({ mentions: [], unread: 0 })],
  ];
  $('dataRows').replaceChildren(
    ...rows.map(([title, count, noun, clear]) => {
      const row = document.createElement('div');
      row.className = 'setting-row static';
      const text = document.createElement('span');
      text.className = 'setting-text';
      text.append(
        Object.assign(document.createElement('span'), { className: 'setting-title', textContent: title }),
        Object.assign(document.createElement('span'), { className: 'setting-desc', textContent: count ? `${count} ${noun}${count === 1 ? '' : 's'}` : 'Nothing saved' }),
      );
      const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-sm', textContent: 'Clear', disabled: !count });
      btn.addEventListener('click', async () => {
        await clear();
        renderData();
      });
      row.append(text, btn);
      return row;
    }),
  );
}

/* ---- Search: only the settings that match show ---- */

/** An element's text without its switch and choice rows (they're matched one by one), nor the preview's chat. */
function ownText(node) {
  const copy = node.cloneNode(true);
  for (const part of copy.querySelectorAll('.setting-row, [data-no-search]')) part.remove();
  return copy.textContent.toLowerCase();
}

/**
 * Show the settings that match the search, in blocks: a section's heading and what's under each of its h3s. A
 * block whose own text matches shows whole (a list, its form); otherwise only its matching rows, in their cards.
 */
function searchSettings() {
  const term = $('settingsSearch').value.trim().toLowerCase();
  for (const node of document.querySelectorAll('.search-out')) node.classList.remove('search-out');
  $('searchNone').hidden = true;
  if (!term) return;
  let found = 0;
  for (const section of document.querySelectorAll('section.panel')) {
    const heading = section.querySelector('h2');
    if (heading.textContent.toLowerCase().includes(term)) {
      found++;
      continue;
    }
    // Its blocks: what comes before the first h3, then each h3 with what follows it.
    const blocks = [[]];
    for (const child of section.children) {
      if (child === heading) continue;
      if (child.tagName === 'H3') blocks.push([]);
      blocks.at(-1).push(child);
    }
    let shown = 0;
    for (const block of blocks.filter((b) => b.length)) {
      if (block.some((node) => ownText(node).includes(term))) {
        shown++;
        continue;
      }
      const rows = block.flatMap((node) => [...node.querySelectorAll('.setting-row')]);
      const hits = rows.filter((row) => row.textContent.toLowerCase().includes(term));
      for (const row of rows) row.classList.toggle('search-out', !hits.includes(row));
      for (const node of block) node.classList.toggle('search-out', !hits.some((row) => node.contains(row)));
      if (hits.length) shown++;
    }
    section.classList.toggle('search-out', !shown);
    if (shown) found++;
  }
  for (const link of document.querySelectorAll('.nav a')) link.classList.toggle('search-out', $(link.hash.slice(1)).classList.contains('search-out'));
  $('searchNone').hidden = Boolean(found);
  $('searchNone').textContent = `No settings match "${$('settingsSearch').value.trim()}".`;
}

$('settingsSearch').addEventListener('input', searchSettings);
// "/" anywhere but a text box: to the search (as on many sites).
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  $('settingsSearch').focus();
});

/* ---- Reset: every setting back to how Yapp Chat starts (not sign-ins, notes or the chat window's chats) ---- */

let resetAsked = 0; // the timer that takes "Sure?" back

$('resetBtn').addEventListener('click', async () => {
  const button = $('resetBtn');
  const ask = (sure) => {
    button.classList.toggle('sure', sure);
    button.textContent = sure ? 'Sure? Reset' : 'Reset';
  };
  clearTimeout(resetAsked);
  // The first click asks; a second within a few seconds resets.
  if (!button.classList.contains('sure')) {
    ask(true);
    resetAsked = setTimeout(() => ask(false), 4000);
    return;
  }
  ask(false);
  await chrome.storage.sync.remove(Object.keys(DEFAULTS).filter((key) => key !== 'splits'));
  showStatus('resetStatus', 'Your settings are back to how Yapp Chat starts.', true);
});

/* ---- Backup: settings, friends, notes and emote history to a file and back ---- */

const setBackupStatus = (text, ok = true) => showStatus('backupStatus', text, ok);

/** While notes are still arriving from another device (loadNotes: null), a backup would miss or overwrite them. */
const NOTES_SYNCING = 'Your notes are still syncing from another device. Try again in a moment.';

$('exportBtn').addEventListener('click', async () => {
  const [notes, { emoteUse = {} }] = await Promise.all([loadNotes(), chrome.storage.local.get('emoteUse')]);
  if (!notes) return setBackupStatus(NOTES_SYNCING, false);
  const file = new Blob([backupText({ settings, notes, emoteUse })], { type: 'application/json' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: `yapp-chat-backup-${new Date().toISOString().slice(0, 10)}.json` });
  link.click();
  URL.revokeObjectURL(link.href);
  setBackupStatus('Saved to your downloads.');
});

$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // the same file can be picked again
  if (!file) return;
  try {
    const backup = readBackup(await file.text());
    const notes = Object.keys(backup.notes).length;
    if (!confirm(`Replace your settings with the ones in this file? Its ${notes} note${notes === 1 ? '' : 's'} and emote history are added to yours.`)) return;
    // The file's notes and emote history are added to what's here (its own win where both have one).
    const [here, { emoteUse = {} }] = await Promise.all([loadNotes(), chrome.storage.local.get('emoteUse')]);
    if (!here) return setBackupStatus(NOTES_SYNCING, false);
    await saveSettings(backup.settings);
    await saveNotes({ ...here, ...backup.notes });
    await chrome.storage.local.set({ emoteUse: { ...emoteUse, ...backup.emoteUse } });
    const friends = backup.settings.friends.length;
    setBackupStatus(`Imported your settings, ${friends} friend${friends === 1 ? '' : 's'} and ${notes} note${notes === 1 ? '' : 's'}.`);
  } catch (error) {
    setBackupStatus(error.message, false);
  }
});

/* ---- Sidebar: icons, and the section you're in ---- */

const navLinks = [...document.querySelectorAll('.nav a')];
for (const link of navLinks) link.prepend(icon(link.dataset.icon));
for (const button of document.querySelectorAll('.btn-provider')) button.prepend(icon(button.dataset.icon));
const panels = [...document.querySelectorAll('.panel')];

// One highlight behind the current link, sliding from one to the next (placed without sliding the first time).
const nav = document.querySelector('.nav');
const marker = document.createElement('span');
marker.className = 'nav-marker';
nav.prepend(marker);
let markedId = null;
const markSection = (id) => {
  const current = navLinks.find((link) => link.hash === `#${id}`);
  if (!current) return;
  for (const link of navLinks) link.toggleAttribute('aria-current', link === current);
  Object.assign(marker.style, {
    width: `${current.offsetWidth}px`,
    height: `${current.offsetHeight}px`,
    transform: `translate(${current.offsetLeft}px, ${current.offsetTop}px)`,
  });
  if (!markedId) requestAnimationFrame(() => marker.classList.add('ready'));
  // A narrow window has the links in a row that scrolls: bring the current one into view.
  if (id !== markedId && nav.scrollWidth > nav.clientWidth) {
    nav.scrollTo({ left: current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2, behavior: markedId ? 'smooth' : 'instant' });
  }
  markedId = id;
};

// The section you're in: the last one whose top has passed a quarter of the window; the first at
// the top and the last at the bottom, as short ones there (Accounts, About) never get that far.
// One you click stays marked until you scroll yourself.
let clicked = location.hash.slice(1) || null;
const sectionInView = () => {
  if (scrollY <= 4) return panels[0];
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) return panels.at(-1);
  return panels.findLast((panel) => panel.getBoundingClientRect().top <= innerHeight * 0.25) || panels[0];
};
let frame = 0;
const updateSection = () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => markSection(clicked || sectionInView().id));
};
for (const link of navLinks) {
  // The page glides to the section (it jumps when you've asked for less motion).
  link.addEventListener('click', (e) => {
    e.preventDefault();
    clicked = link.hash.slice(1);
    history.replaceState(null, '', link.hash);
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const panel = document.getElementById(clicked);
    panel.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
    panel.focus({ preventScroll: true }); // keyboard focus goes to the section, as a plain link would take it
    updateSection();
  });
}
for (const panel of panels) panel.tabIndex = -1;
// Scrolling yourself lets go of a clicked section: any key, or the wheel, a touch or a click outside the
// sidebar (inside it they'd only scroll its row of links, on a narrow window).
addEventListener('keydown', () => (clicked = null));
for (const type of ['wheel', 'touchstart', 'pointerdown']) {
  addEventListener(type, (e) => {
    if (!e.target.closest?.('.nav')) clicked = null;
  }, { passive: true });
}
addEventListener('scroll', updateSection, { passive: true });
addEventListener('resize', updateSection);
updateSection();

/** This page follows the theme too. */
function applyTheme() {
  const light = settings.theme === 'light' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

/** Segmented choices: [label, value] → saves `key`. */
function choices(id, key, options) {
  $(id).replaceChildren(
    ...options.map(([label, value]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.value = value;
      btn.addEventListener('click', () => saveSettings({ [key]: value }));
      return btn;
    }),
  );
}
choices('themeChoices', 'theme', [['Dark', 'dark'], ['Light', 'light'], ['System', 'system']]);
choices('densityChoices', 'density', [['Comfortable', 'comfortable'], ['Compact', 'compact']]);
choices('fontChoices', 'chatFont', Object.entries(CHAT_FONTS).map(([value, [label]]) => [label, value]));

$('friendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = $('friendInput').value.trim().replace(/^@/, '').toLowerCase();
  if (!login) return;
  if (!settings.friends.includes(login)) await saveSettings({ friends: [...settings.friends, login] });
  $('friendInput').value = '';
});
$('holdAnywhereRow').addEventListener('click', () => saveSettings({ holdAnywhere: !settings.holdAnywhere }));
$('foldRow').addEventListener('click', () => saveSettings({ foldRepeats: !settings.foldRepeats }));
$('foldSimilarRow').addEventListener('click', () => saveSettings({ foldSimilar: !settings.foldSimilar }));

/* ---- Hidden ---- */

$('botNames').textContent = `${COMMON_BOTS.slice(0, 5).join(', ')} and ${COMMON_BOTS.length - 5} more.`;
$('hideCommandsRow').addEventListener('click', () => saveSettings({ hideCommands: !settings.hideCommands }));
$('hideBotsRow').addEventListener('click', () => saveSettings({ hideBots: !settings.hideBots }));
$('hideForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = $('hideInput').value.trim().replace(/^@/, '').toLowerCase();
  if (!login) return;
  if (!settings.hiddenUsers.includes(login)) await saveSettings({ hiddenUsers: [...settings.hiddenUsers, login] });
  $('hideInput').value = '';
});

/* ---- Highlight and hide words: words, phrases or /regexes/ ---- */

/** Add a word, phrase or /regex/ to settings[key]; false (saying why under its form, errorId) for a broken regex. */
async function addEntry(key, entry, errorId) {
  if (entry.length > 200) {
    $(errorId).textContent = 'At most 200 characters.';
    return false;
  }
  try {
    entryRegex(entry);
  } catch (error) {
    $(errorId).textContent = `That regex doesn't work: ${error.message.replace(/^Invalid regular expression: /, '')}`;
    return false;
  }
  $(errorId).textContent = '';
  // Words once in any case; a regex as written (/A/ and /a/ differ).
  const same = (w) => (entryRegex(entry) ? w === entry : w.toLowerCase() === entry.toLowerCase());
  if (!settings[key].some(same)) await saveSettings({ [key]: [...settings[key], entry] });
  return true;
}

for (const [form, input, key, error] of [['wordForm', 'wordInput', 'highlightWords', 'wordError'], ['hideWordForm', 'hideWordInput', 'hiddenWords', 'hideWordError']]) {
  $(form).addEventListener('submit', async (e) => {
    e.preventDefault();
    const entry = $(input).value.trim();
    if (entry && (await addEntry(key, entry, error))) $(input).value = '';
  });
  $(input).addEventListener('input', () => ($(error).textContent = ''));
}

/**
 * "Build a regex": one from words without writing it. Which words, where they count, case, stretched letters and
 * spam tricks; the regex it makes (coloured); a message to try it on (what matches marked); Add puts it in
 * settings[key], a broken one refused under errorId.
 */
function patternBuilder(key, errorId) {
  const field = (label, control, hint) => {
    const wrap = el('label', 'pb-field');
    wrap.append(el('span', 'pb-label', label), control);
    if (hint) wrap.append(el('span', 'pb-hint', hint));
    return wrap;
  };
  const check = (label) => {
    const wrap = el('label', 'pb-check');
    const box = el('input');
    box.type = 'checkbox';
    wrap.append(box, label);
    return [wrap, box];
  };
  const words = Object.assign(el('input', 'input'), { placeholder: 'giveaway, free sub', spellcheck: false, autocomplete: 'off' });
  const places = [['words', 'As whole words'], ['anywhere', 'Anywhere, also inside words'], ['start', 'At the start of the message'], ['whole', 'As the whole message']];
  const where = dropdown(places, 'words', () => update(), 'Where');
  const [caseLabel, matchCase] = check('Match case');
  const [stretchLabel, stretched] = check('Letters stretched too (lol, LOOOOL)');
  const [tricksLabel, tricks] = check('Spam tricks too (fr3e, f.r.e.e, freesub)');
  const out = el('code', 'pb-out');
  const sample = Object.assign(el('input', 'input'), { placeholder: 'Type a message to try it', spellcheck: false, autocomplete: 'off' });
  const result = el('p', 'pb-result');
  result.setAttribute('aria-live', 'polite');
  const add = el('button', 'btn btn-primary btn-sm', 'Add');
  add.type = 'button';

  const pattern = () => patternFor({ words: words.value.split(','), where: where.value, matchCase: matchCase.checked, stretched: stretched.checked, tricks: tricks.checked });
  const update = () => {
    const entry = pattern();
    out.replaceChildren(entry ? entryView(entry) : 'Type a word above');
    add.disabled = !entry;
    result.replaceChildren();
    result.className = 'pb-result';
    if (!entry || !sample.value) return;
    const found = entryRegex(entry).exec(sample.value);
    if (!found) return result.replaceChildren('No match');
    // The message with what matched marked.
    result.classList.add('hit');
    const at = found.index;
    result.append('Matches: ', sample.value.slice(0, at), el('mark', '', found[0]), sample.value.slice(at + found[0].length));
  };
  for (const control of [words, matchCase, stretched, tricks, sample]) control.addEventListener('input', update);
  add.addEventListener('click', async () => {
    if (await addEntry(key, pattern(), errorId)) {
      words.value = '';
      update();
    }
  });
  update();

  const box = el('details', 'pattern-builder');
  const body = el('div', 'pb-body');
  const tryRow = el('div', 'pb-try');
  tryRow.append(field('Try it', sample), result);
  const outRow = el('div', 'pb-make');
  outRow.append(out, add);
  body.append(field('Words', words, 'Any of these; commas between.'), field('Where', where), caseLabel, stretchLabel, tricksLabel, outRow, tryRow);
  box.append(el('summary', '', 'Build a regex'), body);
  return box;
}

$('wordBuilder').append(patternBuilder('highlightWords', 'wordError'));
$('hideWordBuilder').append(patternBuilder('hiddenWords', 'hideWordError'));

$('sizeChoices').replaceChildren(
  ...Object.entries(FONT_SIZES).map(([label, size]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.size = size;
    btn.addEventListener('click', () => saveSettings({ fontSize: size }));
    return btn;
  }),
);

$('emoteSizeChoices').replaceChildren(
  ...Object.keys(EMOTE_SIZES).map((label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => saveSettings({ emoteSize: label }));
    return btn;
  }),
);

chrome.storage.onChanged.addListener(async (changes, area) => {
  const signIns = area === 'local' && (changes.twitchAuth || changes.kickAuth);
  // Notes, emotes used, mentions (chats write these all the time): only their counts.
  if (area === 'session' || (area === 'local' && !signIns) || (area === 'sync' && Object.keys(changes).every(isNotesKey))) return renderData();
  if (area === 'sync') settings = await loadSettings();
  if (signIns && changes.twitchAuth) {
    const before = auth.userId;
    auth = await loadTwitchAuth();
    if (auth.userId !== before) followed = null; // another account follows other channels (not a renewed token)
    checkScopes();
  }
  if (signIns && changes.kickAuth) kickAuth = await loadKickAuth();
  render();
});

$('versionTag').textContent = `v${chrome.runtime.getManifest().version}`;
$('aboutVersion').textContent = `Yapp Chat ${chrome.runtime.getManifest().version}`;
render();
checkScopes();
