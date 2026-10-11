/*
 * Settings page: sections in a sidebar (Accounts, Chat, Appearance with a live preview, Highlights, Hidden,
 * Notifications, Friends, Emotes, Privacy & data, About), and a search over them.
 */

import { icon } from './lib/icons.js';
import { backupText, CHAT_FONTS, cleanLogin, clearNotes, COMMON_BOTS, DEFAULTS, EMOTE_SIZES, FONT_SIZES, isNotesKey, LIMITS, liveExceptWith, loadKickAuth, loadNotes, loadSettings, loadTwitchAuth, notifiesFor, readBackup, saveKickAuth, saveNotes, saveSettings, saveTwitchAuth } from './lib/settings.js';
import { freshKickAuth, kickPicture, kickSignIn, kickSignOut } from './lib/kick.js';
import { entryRegex, formatDuration, patternFor, readableColor } from './lib/format.js';
import { commandGroups } from './lib/commands.js';
import { mentionPing } from './lib/mentions.js';
import { parseDuration, shortDuration } from './lib/moderation.js';
import { BADGES, discordLinking, discordSignIn, joinCosmetics, linkDiscord, loadMine, PAINTS, refreshCatalog, saveCosmetic, useCatalog } from './lib/paints.js';
import { freshTwitchAuth, twitchEmoteUrl, twitchFollowedChannels, twitchProfile, twitchSignIn, twitchSignOut, validateToken } from './lib/twitch.js';
import { applyAppearance, button, checkbox, dropdown, el, outLink, platformBadge, shiny } from './lib/ui.js';

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

/** A setting's words: its title, and under it what it does (its text, or a node that says it). */
function settingText(title, desc) {
  const text = el('span', 'setting-text');
  text.append(el('span', 'setting-title', title), typeof desc === 'string' ? el('span', 'setting-desc', desc) : desc);
  return text;
}

function switchRow(id, on) {
  $(id).setAttribute('aria-checked', String(on));
}

/**
 * The rows that turn one setting on or off, in the page's order: [the row's id, the setting]. render() draws each
 * as its setting is, and a click flips it. (The emote sets' rows are made in render().)
 */
const SWITCHES = [
  ['autoOpenRow', 'autoOpen'], ['twitchButtonRow', 'twitchButton'], ['offerSimulcastRow', 'offerSimulcast'],
  ['recentRow', 'recentMessages'], ['showPinnedRow', 'showPinned'], ['cardLogsRow', 'cardLogs'],
  ['holdAnywhereRow', 'holdAnywhere'], ['foldRow', 'foldRepeats'], ['foldSimilarRow', 'foldSimilar'],
  ['timestampsRow', 'timestamps'], ['badgesRow', 'badges'], ['cosmeticsRow', 'cosmetics'], ['altRowsRow', 'altRows'],
  ['highlightNameRow', 'highlightName'], ['mentionWordsRow', 'mentionWords'],
  ['hideCommandsRow', 'hideCommands'], ['hideBotsRow', 'hideBots'],
  ['modButtonsRow', 'modButtons'], ['modKeysRow', 'modKeys'], ['modLogRow', 'modLog'], ['raidProtectRow', 'raidProtect'], ['flagNewAccountsRow', 'flagNewAccounts'],
  ['liveNotifyRow', 'liveNotify'], ['mentionNotifyRow', 'mentionNotify'], ['mentionSoundRow', 'mentionSound'], ['mentionFlashRow', 'mentionFlash'],
];

/** Your picture beside your name, with the platform's badge on its corner (an empty circle until it loads). */
function showPicture(id, platform, url) {
  const pic = $(id);
  if (!pic.querySelector('.platform-badge')) pic.append(platformBadge(platform));
  const img = pic.querySelector('img');
  if (url && img.getAttribute('src') !== url) img.src = url;
}

let kickPictureAsked = false;

/**
 * Each kept with its sign-in, so it's there at once the next time: Twitch's from your public profile (asked each
 * time the page opens, as you may have changed it); Kick's kept at sign-in, or asked for once for a sign-in from before.
 */
function renderPictures() {
  if (auth.token) {
    showPicture('accountPic', 'twitch', auth.picture);
    twitchProfile(auth.login)
      .then((p) => {
        if (!p?.photo || p.photo === auth.picture || !auth.token) return;
        auth.picture = p.photo;
        saveTwitchAuth(auth);
        showPicture('accountPic', 'twitch', p.photo);
      })
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

/**
 * A list of what settings[key] holds (an array's values, or an object's entries as [name, value]), each drawn by
 * `view` with a ✕ that removes it, or `empty` when there are none.
 */
function renderList(id, key, empty, removeLabel, view = entryView) {
  const held = settings[key];
  const listed = Array.isArray(held);
  const without = (entry) => (listed ? held.filter((value) => value !== entry) : Object.fromEntries(Object.entries(held).filter(([name]) => name !== entry[0])));
  const items = (listed ? held : Object.entries(held)).map((entry) => {
    const remove = button('btn btn-ghost btn-icon', '', () => saveSettings({ [key]: without(entry) }));
    remove.title = 'Remove';
    remove.setAttribute('aria-label', removeLabel(entry));
    remove.append(icon('x'));
    const li = el('li');
    li.append(view(entry), remove);
    return li;
  });
  $(id).replaceChildren(...(items.length ? items : [el('li', 'none', empty)]));
}

/**
 * Accounts: your name's paint and your badge, for each sign-in (lib/paints.js). A dropdown of the paints, each in its
 * own colours; a dropdown of the badges that are yours to wear, when you have any (today the founders', for the
 * first 420 accounts that signed in); and a line of chat with yours on your name. Drawn at once from what's kept
 * here of you (cosmeticsMine), which the service is then asked about again. Picking one shows at once and sets it,
 * for everyone who uses Yapp Chat to see.
 */
let cosmeticsMine = await loadMine(); // "twitch:<id>" → { paint, badge, offers }
const picking = {}; // "twitch:<id>" → { paint or badge: the one being saved }, shown meanwhile
const askedMine = {}; // platform → the account the service was asked about, since this page opened
function renderPaints() {
  const accounts = [
    ['twitch', 'twitchPaints', auth, auth.login, freshTwitchAuth, setStatus],
    ['kick', 'kickPaints', kickAuth, kickAuth.name || kickAuth.login, freshKickAuth, setKickStatus],
  ];
  for (const [platform, box, account, name, fresh, say] of accounts) {
    const host = $(box);
    host.hidden = !account.token || !account.userId;
    if (host.hidden) continue;
    // Appearance → Name paints and extra badges is off: nothing to pick, and the service isn't asked (nor the account
    // joined to it: the privacy policy says it's kept only while that's on).
    if (!settings.cosmetics) {
      host.replaceChildren(el('p', 'setting-desc', 'Name paints and extra badges are off (Appearance).'));
      continue;
    }
    const key = `${platform}:${account.userId}`;
    // The service is asked once, each time this page opens: the account joins its members if it hasn't, and what
    // it says is kept (and drawn, where it's news).
    if (askedMine[platform] !== account.userId) {
      askedMine[platform] = account.userId;
      fresh(account)
        .then(() => joinCosmetics(platform, account.userId, account.token))
        .catch(() => {}); // not now: what's kept still shows
    }
    const me = { ...cosmeticsMine[key], ...picking[key] };
    const paint = PAINTS.find((p) => p.id === me.paint);
    const yours = (me.offers?.badge || []).filter((id) => BADGES[id]);
    const badge = yours.includes(me.badge) ? me.badge : '';
    const painted = (text, paint) => {
      const span = el('span', `name${paint ? ' painted' : ''}${paint?.flow ? ' flowing' : ''}`, text);
      if (paint) span.style.backgroundImage = paint.image;
      else span.style.color = readableColor('', name);
      return span;
    };
    const pictured = (id) => {
      const img = Object.assign(el('img', 'badge'), { src: BADGES[id].url, alt: BADGES[id].title });
      return BADGES[id].shine ? shiny(img) : img;
    };
    const choose = async (kind, value) => {
      picking[key] = { ...picking[key], [kind]: value };
      renderPaints(); // it shows before it's saved
      try {
        await fresh(account);
        await saveCosmetic(platform, account.userId, account.token, kind, value);
        say(value ? `Your ${kind} is set. Others see it within ten minutes.` : `Your ${kind} is off.`);
      } catch (error) {
        say(error.message, false);
      }
      if (picking[key]?.[kind] === value) delete picking[key][kind]; // not one picked since
      cosmeticsMine = await loadMine();
      renderPaints(); // as it's kept now: back to what it was, if it couldn't be saved
    };
    const row = (title, desc, choices, value, kind) => {
      const line = el('div', 'paint-row');
      line.append(settingText(title, desc), dropdown(choices, value, (picked) => choose(kind, picked), title));
      return line;
    };
    // The paints that aren't everyone's (the founders', the team's, a booster's, a season's): listed when the service
    // says they're yours (and the one you wear), before the others and marked "Limited" (options.css .paint-choice).
    const paints = PAINTS.filter((p) => !p.only || p === paint || me.offers?.paint?.includes(p.id)).sort((a, b) => Boolean(b.only) - Boolean(a.only));
    const choice = (p) => () => {
      const node = el('span', `paint-choice${p.only ? ' limited' : ''}`);
      node.append(painted(p.name, p));
      return node;
    };
    const rows = [row('Name paint', 'Colours through your name, for everyone who uses Yapp Chat to see.', [['', 'None'], ...paints.map((p) => [p.id, choice(p)])], paint?.id || '', 'paint')];
    if (yours.length) {
      const drawn = (id) => () => {
        const choice = el('span', 'badge-choice');
        choice.append(pictured(id), BADGES[id].title);
        return choice;
      };
      rows.push(row('Badge', 'Before your name, for everyone who uses Yapp Chat to see.', [['', 'None'], ...yours.map((id) => [id, drawn(id)])], badge, 'badge'));
    }
    // Discord (once it's set up on the service): linked, boosting Yapp Chat's server gives the Booster badge and the
    // Boost paint while it lasts.
    if (discordLinking()) {
      // What it says is what's so: linking doesn't boost, nor even join the server, so its link is there; and which
      // Discord account it is ("Linked to duckfan."), for whoever has several (one linked before names were kept: "Linked.").
      const server = outLink('Yapp Discord server', 'https://yapp.chat/discord', '');
      const linked = me.discordName ? ['Linked to ', el('strong', '', me.discordName), '. '] : ['Linked. '];
      const desc = el('span', 'setting-desc');
      desc.append(...(!me.discord ? ['Boost ', server, ' for a Booster badge and paint.'] : me.boosting ? [...linked, "You're boosting ", server, ': the Booster badge and paint are yours.'] : [...linked, 'Boost ', server, ' to get the Booster badge and paint.']));
      const linker = button('btn btn-sm', me.discord ? 'Unlink' : 'Link Discord', async () => {
        linker.disabled = true;
        try {
          await fresh(account);
          const you = await linkDiscord(platform, account.userId, account.token, me.discord ? '' : await discordSignIn());
          say(!you.discord ? 'Discord unlinked.' : you.boosting ? 'Discord linked. Thanks for boosting: the Booster badge and the Boost paint are yours.' : 'Discord linked. Boost the server to get the badge and paint.');
        } catch (error) {
          say(cancelled(error) ? 'Sign-in cancelled.' : error.message, cancelled(error));
        }
        cosmeticsMine = await loadMine();
        renderPaints();
      });
      const line = el('div', 'paint-row');
      line.append(settingText('Discord', desc), linker);
      rows.push(line);
    }
    const preview = el('div', 'paint-preview');
    if (badge) preview.append(pictured(badge));
    preview.append(painted(name, paint), el('span', 'sep', ': '), 'this is your name in chat');
    host.replaceChildren(...rows, preview);
  }
}

let drawn = false; // the page has been drawn once: an account that shows up after that has just signed in

function render() {
  renderPictures();
  renderPaints();
  // Just signed in, it fades in where the button was (options.css .account.arriving); one that's there as the page
  // opens is simply there.
  for (const [id, account] of [['signedIn', auth], ['kickSignedIn', kickAuth]]) {
    if (drawn && $(id).hidden && account.token) $(id).classList.add('arriving');
    $(id).hidden = !account.token;
  }
  $('signedOut').hidden = Boolean(auth.token);
  $('accountName').textContent = auth.login || '';
  $('kickSignedOut').hidden = Boolean(kickAuth.token);
  $('kickName').textContent = kickAuth.name || '';
  // The account's ID (what yapp.chat keeps of it: to name it by, for a badge given by hand); a click copies it.
  for (const [id, account] of [['accountId', auth], ['kickId', kickAuth]]) {
    $(id).hidden = !account.userId;
    $(id).textContent = account.userId ? `ID ${account.userId}` : '';
  }

  for (const [row, key] of SWITCHES) switchRow(row, settings[key]);
  // Live notifications ask Twitch which channels you follow: off, and saying so, until you're signed in.
  $('liveNotifyRow').disabled = !auth.token;
  switchRow('liveNotifyRow', settings.liveNotify && Boolean(auth.token));
  // Similar messages fold only where repeats do.
  $('foldSimilarRow').disabled = !settings.foldRepeats;
  switchRow('foldSimilarRow', settings.foldSimilar && settings.foldRepeats);
  $('liveNotifyDesc').textContent = auth.token ? 'A desktop notification; click it to open the stream. For all of them, or the ones you choose below.' : 'Sign in to Twitch first (Accounts, above).';
  renderLiveChannels();
  applyAppearance(settings); // this page wears it too, and the preview is the chat's own styles
  renderPreview();
  renderData();
  searchSettings(); // what was just drawn, filtered as the search says
  for (const [id, key] of [['themeChoices', 'theme'], ['densityChoices', 'density'], ['fontChoices', 'chatFont'], ['sizeChoices', 'fontSize'], ['emoteSizeChoices', 'emoteSize']]) {
    for (const btn of $(id).children) btn.setAttribute('aria-pressed', String(btn.dataset.value === String(settings[key])));
  }
  renderList('friendList', 'friends', 'No friends yet.', (login) => `Remove ${login} from friends`);
  renderList('nicknameList', 'nicknames', 'No nicknames yet.', ([login]) => `Remove your nickname for ${login}`, ([login, nick]) => {
    const text = el('span');
    text.append(login, el('span', 'nickname-arrow', ' → '), el('strong', '', nick));
    return text;
  });
  renderList('hiddenList', 'hiddenUsers', 'No one hidden.', (login) => `Show messages from ${login} again`);
  renderList('wordList', 'highlightWords', 'No words yet.', (word) => `Stop highlighting ${word}`);
  renderList('hiddenWordList', 'hiddenWords', 'No words yet.', (word) => `Stop hiding ${word}`);
  // Lengths as chips: "10m", its length in words on hover; the first (the quick one) marked with its key.
  renderList('modTimeoutList', 'modTimeouts', '', (s) => `Remove ${formatDuration(s)}`, (s) => {
    const chip = el('span', '', shortDuration(s));
    chip.title = formatDuration(s);
    if (s === settings.modTimeouts[0]) chip.append(' ', Object.assign(el('kbd', '', 'T'), { title: 'The quick one: T and the message buttons' }));
    return chip;
  });
  renderList('modReasonList', 'modReasons', 'No reasons yet.', (r) => `Remove ${r}`, (r) => el('span', '', r));
  // The last length can't go (a message's buttons need one).
  for (const remove of $('modTimeoutList').querySelectorAll('button')) remove.hidden = settings.modTimeouts.length === 1;

  $('emoteRows').replaceChildren(
    ...EMOTE_SETS.map(([key, name, site]) => {
      const row = button('setting-row', '', () => saveSettings({ emotes: { ...settings.emotes, [key]: !settings.emotes[key] } }));
      row.setAttribute('role', 'switch');
      row.setAttribute('aria-checked', String(settings.emotes[key]));
      const knob = el('span', 'switch');
      knob.setAttribute('aria-hidden', 'true');
      row.append(settingText(name, `Loads emote lists and images from ${site}.`), knob);
      return row;
    }),
  );
  drawn = true;
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
    button.replaceChildren(el('span', 'spinner'), text);
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
  ['moderator:manage:chat_settings', 'mod tools: chat modes (slow, followers-only, sub-only…)'],
  ['moderator:manage:automod', "mod tools: AutoMod's held messages, to allow or deny"],
  ['moderator:manage:shield_mode', 'mod tools: Shield Mode'],
  ['moderator:manage:warnings', 'mod tools: warnings'],
  ['moderator:read:suspicious_users', 'mod tools: suspicious users marked'],
  ['moderator:read:moderators', 'mod tools: what moderators do, in the chat'],
  ['moderator:read:chatters', "mod tools: who's in chat"],
  ['moderator:manage:announcements', 'mod tools: announcements'],
  ['moderator:manage:shoutouts', 'mod tools: shoutouts'],
  ['clips:edit', 'commands: /clip'],
  ['user:manage:blocked_users', 'commands: /block and /unblock'],
  ['user:manage:whispers', 'commands: /w (whispers)'],
  ['channel:manage:moderators', 'your channel: /mod and /unmod'],
  ['channel:manage:vips', 'your channel: /vip and /unvip'],
  ['channel:manage:raids', 'your channel: /raid and /unraid'],
  ['channel:edit:commercial', 'your channel: /commercial'],
  ['channel:manage:broadcast', 'your channel: /marker'],
];

/** Signed in before some features asked for their permission: say what's missing, and fix it in one click. */
async function checkScopes() {
  const box = $('scopeHealth');
  if (auth.token) await freshTwitchAuth(auth).catch(() => {});
  const info = auth.token ? await validateToken(auth.token).catch(() => null) : null;
  const missing = info ? SCOPE_FEATURES.filter(([scope]) => !info.scopes?.includes(scope)) : [];
  box.hidden = !missing.length;
  if (!missing.length) return;
  const list = el('ul');
  list.append(...missing.map(([, what]) => el('li', '', what)));
  const again = button('btn btn-primary btn-sm', 'Sign in again', () => signIn(again));
  box.replaceChildren(el('strong', '', 'Your sign-in is from before some features.'), el('p', '', 'Sign in again to turn on:'), list, again);
}

for (const [id, account, say] of [['accountId', () => auth, setStatus], ['kickId', () => kickAuth, setKickStatus]]) {
  $(id).addEventListener('click', () => navigator.clipboard.writeText(String(account().userId)).then(() => say('Account ID copied.'), () => say("Couldn't copy it.", false)));
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

// Turning the sound on plays it, so you know what it's like.
$('mentionSoundRow').addEventListener('click', () => !settings.mentionSound && mentionPing());
for (const [row, key] of SWITCHES) $(row).addEventListener('click', () => saveSettings({ [key]: !settings[key] }));

/* ---- Appearance preview ---- */

/** A small chat drawn with the current appearance settings, using the chat's own styles. */
function renderPreview() {
  const emote = (id, name) => {
    const stack = el('span', 'emote-stack');
    const img = el('img', 'emote');
    img.src = twitchEmoteUrl(id);
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
      for (const [file, title] of badges) {
        const img = el('img', 'badge');
        img.src = `assets/badges/${file}.png`;
        img.alt = img.title = title;
        wrap.append(img);
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
    // Badges as a channel shows them: Twitch's moderator and VIP, and subscriber ranks (the website's duck ones).
    line({ name: 'PixelPanda', color: '#7C4DFF', badges: [['twitch-vip', 'VIP'], ['sub-3-month', '3-month subscriber']], body: ['hi chat ', emote(25, 'Kappa')], time: '21:04', fold: '×3' }),
    line({ name: 'PogFan', color: '#FF4500', badges: [['twitch-moderator', 'Moderator'], ['sub-12-month', '1-year subscriber']], body: [emote(425618, 'LUL'), ' that was so close'], time: '21:04' }),
    line({ name: 'Painted_Name', color: '#8A2BE2', badges: [['sub-6-month', '6-month subscriber']], body: ['my 7TV paint ', emote(41, 'Kreygasm')], time: '21:05', paint: 'linear-gradient(90deg, #ff5f6d, #ffc371, #2ec5ff)' }),
    notice,
    line({ name: 'quiet_viewer', color: '#2E8B57', body: ['first time here'], time: '21:05', first: true }),
    line({ name: 'Jordan', color: '#DAA520', badges: [['sub-1-month', 'Subscriber']], body: ['same, it was insane'], time: '21:06', reply: ['PogFan', 'that was so close'] }),
  );
}

/* ---- Privacy & data: what Yapp Chat keeps ---- */

async function renderData() {
  const [notes, { emoteUse = {}, mentions = [] }] = await Promise.all([loadNotes(), chrome.storage.local.get(['emoteUse', 'mentions'])]);
  const rows = [
    ['Private notes about people (synced)', Object.keys(notes || {}).length, 'note', clearNotes],
    ['Emotes you used (for Recent; this device)', Object.keys(emoteUse).length, 'emote', () => chrome.storage.local.remove('emoteUse')],
    ['Mentions inbox (the last 100; this device)', mentions.length, 'mention', () => chrome.storage.local.set({ mentions: [], mentionsUnread: 0 })],
  ];
  $('dataRows').replaceChildren(
    ...rows.map(([title, count, noun, clear]) => {
      const btn = button('btn btn-sm', 'Clear', async () => {
        await clear();
        renderData();
      });
      btn.disabled = !count;
      const row = el('div', 'setting-row static');
      row.append(settingText(title, count ? `${count} ${noun}${count === 1 ? '' : 's'}` : 'Nothing saved'), btn);
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
/** What the search unfolded (a <details> with a match inside), folded again when the search changes. */
const searchOpened = new Set();

function searchSettings() {
  const term = $('settingsSearch').value.trim().toLowerCase();
  for (const node of document.querySelectorAll('.search-out')) node.classList.remove('search-out');
  for (const details of searchOpened) details.open = false;
  searchOpened.clear();
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
      const holds = (node) => hits.some((row) => node.contains(row));
      for (const row of rows) row.classList.toggle('search-out', !hits.includes(row));
      for (const node of block) node.classList.toggle('search-out', !holds(node));
      // Inside a folded part (Moderation's commands, About's mod keys): its cards without a match go, it opens for one with.
      for (const node of block.flatMap((n) => [...n.querySelectorAll('details .card, details .group-label, details .card-desc')])) node.classList.toggle('search-out', !holds(node));
      for (const details of block.flatMap((n) => (n.matches('details') ? [n] : [...n.querySelectorAll('details')]))) {
        if (!holds(details) || details.open) continue;
        details.open = true;
        searchOpened.add(details);
      }
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
// To the search: "/" anywhere but a text box (as on many sites), or Ctrl/⌘+F anywhere (the browser's find bar
// matters less here than the settings' own search); what's in it is selected, to type over.
document.addEventListener('keydown', (e) => {
  const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]');
  const find = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f';
  if (!slash && !find) return;
  e.preventDefault();
  $('settingsSearch').focus();
  $('settingsSearch').select();
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

// Shortcuts as this computer's keyboard has them: ⌘ and ⌥ on a Mac (About's, the search's).
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
if (mac) {
  for (const key of document.querySelectorAll('kbd[data-mod]')) key.textContent = '⌘';
  for (const key of document.querySelectorAll('kbd[data-alt]')) key.textContent = '⌥';
}
if (mac) $('searchKey').textContent = '⌘F';

const navLinks = [...document.querySelectorAll('.nav a')];
for (const link of navLinks) link.prepend(icon(link.dataset.icon));
for (const button of document.querySelectorAll('.btn-provider')) button.prepend(icon(button.dataset.icon));
const panels = [...document.querySelectorAll('.panel')];

// One highlight behind the current link, sliding from one to the next (placed without sliding the first time).
const nav = document.querySelector('.nav');
const marker = el('span', 'nav-marker');
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

// This page follows the theme too: "System", when the system switches.
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyAppearance(settings));

/** Segmented choices: [label, value] → saves `key`. */
function choices(id, key, options) {
  $(id).replaceChildren(
    ...options.map(([label, value]) => {
      const btn = button('', label, () => saveSettings({ [key]: value }));
      btn.dataset.value = value;
      return btn;
    }),
  );
}
choices('themeChoices', 'theme', [['Dark', 'dark'], ['Light', 'light'], ['System', 'system']]);
choices('densityChoices', 'density', [['Comfortable', 'comfortable'], ['Compact', 'compact']]);
choices('fontChoices', 'chatFont', Object.entries(CHAT_FONTS).map(([value, [label]]) => [label, value]));
choices('sizeChoices', 'fontSize', Object.entries(FONT_SIZES));
choices('emoteSizeChoices', 'emoteSize', Object.keys(EMOTE_SIZES).map((label) => [label, label]));

// Friends, and people whose messages don't show: a name added to its list.
for (const [form, input, key] of [['friendForm', 'friendInput', 'friends'], ['hideForm', 'hideInput', 'hiddenUsers']]) {
  $(form).addEventListener('submit', async (e) => {
    e.preventDefault();
    const login = cleanLogin($(input).value);
    if (!login) return;
    if (!settings[key].includes(login)) await saveSettings({ [key]: [...settings[key], login] });
    $(input).value = '';
  });
}
$('nicknameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = cleanLogin($('nicknameLogin').value);
  const nick = $('nicknameInput').value.trim();
  if (!login || !nick) return ($('nicknameError').textContent = 'Their name, and your nickname for them.');
  if (Object.keys(settings.nicknames).length >= LIMITS.nicknames && !Object.hasOwn(settings.nicknames, login)) return ($('nicknameError').textContent = 'Two hundred nicknames at most: remove one first.');
  await saveSettings({ nicknames: { ...settings.nicknames, [login]: nick } });
  $('nicknameLogin').value = $('nicknameInput').value = '';
  $('nicknameError').textContent = '';
});
for (const id of ['nicknameLogin', 'nicknameInput']) $(id).addEventListener('input', () => ($('nicknameError').textContent = ''));

/* ---- Hidden ---- */

$('botNames').textContent = `${COMMON_BOTS.slice(0, 5).join(', ')} and ${COMMON_BOTS.length - 5} more.`;

/* ---- Highlight and hide words: words, phrases or /regexes/ ---- */

/** Add a word, phrase or /regex/ to settings[key]; false (saying why under its form, errorId) for a broken regex. */
async function addEntry(key, entry, errorId) {
  if (entry.length > LIMITS.entryLength) {
    $(errorId).textContent = `At most ${LIMITS.entryLength} characters.`;
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

/**
 * Moderation → Commands: the same list as /help (lib/commands.js commandGroups), a card per group, each command a row
 * the search finds ("slow" leaves /slow); the ones for everyone or the broadcaster only, and the ones Kick has too, say so.
 */
function renderCommands() {
  const kick = new Set(commandGroups('kick').flatMap(([, rows]) => rows.map(([name]) => name)));
  const groups = commandGroups('twitch');
  const parts = groups.flatMap(([title, rows]) => {
    const label = el('p', 'group-label', title);
    label.dataset.noSearch = '';
    const card = el('div', 'card nested');
    for (const [name, command, off] of rows) {
      const row = el('div', 'setting-row static command-row');
      const what = el('span', 'setting-title');
      what.append(el('code', '', `/${name}`), ...(command.usage ? [' ', el('span', 'command-usage', command.usage)] : []));
      const desc = el('span', 'setting-desc', command.about);
      if (off) desc.append(' · ', el('code', '', `/${off}`), command.off ? ' undoes it' : ' turns it off');
      const text = el('span', 'setting-text');
      text.append(what, desc);
      // Who it's for, when not moderators; and Kick, where it works there too.
      const who = { anyone: 'Everyone', broadcaster: 'Broadcaster' }[command.who];
      row.append(text, ...(who ? [el('span', 'command-who', who)] : []), ...(kick.has(name) && name !== 'help' ? [el('span', 'command-kick', 'Kick too')] : []));
      card.append(row);
    }
    return [label, card];
  });
  $('commandList').replaceWith(...parts);
  $('commandSummary').textContent = `All ${groups.flatMap(([, rows]) => rows).length} commands`;
}
renderCommands();

// Moderation: timeout lengths (up to 6, as typed: 10m, 1h…) and saved reasons.
$('modTimeoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const seconds = parseDuration($('modTimeoutInput').value);
  if (!seconds) return ($('modTimeoutError').textContent = 'A length like 30s, 10m, 1h, 1d or 1w, up to 2 weeks.');
  if (settings.modTimeouts.length >= LIMITS.modTimeouts && !settings.modTimeouts.includes(seconds)) return ($('modTimeoutError').textContent = 'Six lengths at most: remove one first.');
  await saveSettings({ modTimeouts: [...new Set([...settings.modTimeouts, seconds])] });
  $('modTimeoutInput').value = '';
  $('modTimeoutError').textContent = '';
});
$('modTimeoutInput').addEventListener('input', () => ($('modTimeoutError').textContent = ''));
$('modReasonForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = $('modReasonInput').value.trim();
  if (!reason) return;
  if (settings.modReasons.length >= LIMITS.modReasons && !settings.modReasons.includes(reason)) return ($('modReasonError').textContent = 'Twelve reasons at most: remove one first.');
  await saveSettings({ modReasons: [...new Set([...settings.modReasons, reason])] });
  $('modReasonInput').value = '';
});
$('modReasonInput').addEventListener('input', () => ($('modReasonError').textContent = ''));

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
  const words = Object.assign(el('input', 'input'), { placeholder: 'giveaway, free sub', spellcheck: false, autocomplete: 'off' });
  const places = [['words', 'As whole words'], ['anywhere', 'Anywhere, also inside words'], ['start', 'At the start of the message'], ['whole', 'As the whole message']];
  const where = dropdown(places, 'words', () => update(), 'Where');
  const [caseLabel, matchCase] = checkbox('Match case');
  const [stretchLabel, stretched] = checkbox('Letters stretched too (lol, LOOOOL)');
  const [tricksLabel, tricks] = checkbox('Spam tricks too (fr3e, f.r.e.e, freesub)');
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

  const box = el('details', 'fold pattern-builder');
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

// Every folded part (.fold: "Build a regex", Moderation's commands, the channels that notify): a chevron that turns.
for (const summary of document.querySelectorAll('.fold > summary')) summary.append(icon('chevron-down', 'icon fold-chevron'));

chrome.storage.onChanged.addListener(async (changes, area) => {
  // You, as the service says (lib/paints.js cosmeticsMine): the paint and badge pickers again.
  if (area === 'local' && changes.cosmeticsMine) {
    cosmeticsMine = changes.cosmeticsMine.newValue || {};
    renderPaints();
  }
  const signIns = area === 'local' && (changes.twitchAuth || changes.kickAuth);
  // Notes, emotes used, mentions (chats write these all the time): only their counts.
  if ((area === 'local' && !signIns) || (area === 'sync' && Object.keys(changes).every(isNotesKey))) return renderData();
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
try {
  render();
} catch (error) {
  document.documentElement.dataset.ready = ''; // whatever went wrong drawing it, the page isn't left hidden
  throw error;
}
checkScopes();
// The service's catalogue may add badges and paints to this version's (lib/paints.js), and says whether Discord can
// be linked: the pickers again, with it. Asked for here when it's five minutes old: you came to look.
const catalogued = useCatalog(renderPaints).catch(() => {});
// Shown now, whole (options.css hides the page until data-ready): with what the kept catalogue adds and your pictures
// loaded, so nothing pops in or pushes the page down; not waiting long for a picture.
const pictured = [...document.querySelectorAll('.account-pic img[src]')].map((img) => img.decode().catch(() => {}));
Promise.race([Promise.all([catalogued, ...pictured]), new Promise((resolve) => setTimeout(resolve, 300))]).then(() => (document.documentElement.dataset.ready = ''));
if (settings.cosmetics) refreshCatalog(Date.now(), 5 * 60_000).catch(() => {});
