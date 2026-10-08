/*
 * Side panel: one per tab (background.js opens it with ?tab=<id>). It shows
 * the chat of the stream in its tab, following the tab as it navigates, or a
 * chat you typed in or added channels to (pinned until you go back to
 * following the tab). Recent chats stay connected in the background.
 */

import { ChatContext, ChatPane } from './lib/chat.js';
import { channelSuggest } from './lib/channel-suggest.js';
import { icon } from './lib/icons.js';
import { chatFromInput, chatKey, sourceFromUrl } from './lib/sources.js';
import { mentionsButton } from './lib/mentions.js';
import { isNotesKey, signInChanged } from './lib/settings.js';
import { openChatWindow } from './lib/window.js';

const $ = (id) => document.getElementById(id);

/** Chats kept open (hidden) after you switch away, so going back shows their history. */
const KEEP_OPEN = 4;

const tabId = Number(new URLSearchParams(location.search).get('tab'));
const ctx = await ChatContext.create();
const panes = new Map(); // key → pane, most recently shown last
let pane = null;
let pinned = null;

/** Show a chat (a list of sources) or, for null, the empty state, unless it's already showing. */
function show(chat) {
  const key = chat && chatKey(chat);
  if (pane && pane.key === key) return;
  if (pane) {
    pane.root.hidden = true;
    pane.markAway(); // a "New since you left" line when you come back to it
  }
  pane = null;
  if (chat) {
    pane = panes.get(key) || new ChatPane($('paneHost'), chat, ctx, { onChange: pin });
    panes.delete(key);
    panes.set(key, pane);
    pane.root.hidden = false;
    pane.scrollToEnd();
    if (panes.size > KEEP_OPEN) {
      const [oldestKey, oldest] = panes.entries().next().value;
      oldest.close();
      panes.delete(oldestKey);
    }
  }
  $('emptyState').hidden = Boolean(chat);
}

/** Channels were added to or removed from the chat showing: keep showing it, pinned. */
function pin(chat) {
  for (const [key, p] of panes) if (p === pane) panes.delete(key);
  const kept = panes.get(chatKey(chat));
  if (kept && kept !== pane) kept.close(); // a hidden copy of the same chat
  panes.set(chatKey(chat), pane);
  pinned = chat;
  renderMode();
}

function renderMode() {
  const line = $('modeLine');
  line.hidden = !pinned;
  if (!pinned) return;
  // A chat you opened or added channels to: it stays until you follow the tab again.
  const label = document.createElement('span');
  label.className = 'sp-pinned';
  label.append(icon('pin'), 'Pinned chat');
  const follow = document.createElement('button');
  follow.type = 'button';
  follow.className = 'link-btn';
  follow.textContent = 'Follow tab';
  follow.addEventListener('click', () => {
    pinned = null;
    renderMode();
    followTab();
  });
  line.replaceChildren(label, follow);
}

/** The stream in this panel's tab (URLs are visible for twitch.tv, kick.com and youtube.com only). */
async function followTab() {
  if (pinned) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const source = tab?.url ? sourceFromUrl(tab.url) : null;
  show(source && [source]);
}

// A new address on Twitch, Kick or YouTube; or a page loading elsewhere (Chrome hides addresses there).
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && (change.url || change.status === 'loading')) followTab();
});

$('openForm').addEventListener('submit', (e) => {
  e.preventDefault();
  // One channel, or several ("xqc, @xqcyt") merged into one chat.
  const chat = chatFromInput($('openInput').value);
  if (!chat) {
    $('openInput').setCustomValidity('Enter a Twitch channel, kick:name, a YouTube @handle, or a Twitch/Kick/YouTube link (several: separate with commas).');
    $('openInput').reportValidity();
    return;
  }
  $('openInput').value = '';
  pinned = chat;
  renderMode();
  show(chat);
});
$('openInput').addEventListener('input', () => $('openInput').setCustomValidity(''));
channelSuggest($('openInput'), ctx);

$('windowBtn').addEventListener('click', () => openChatWindow(pinned || pane?.chat));
$('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
// Mentions inbox: a mention opens its chat here, pinned.
$('settingsBtn').before(
  mentionsButton({
    onOpen: (source) => {
      pinned = [source];
      renderMode();
      show(pinned);
    },
  }),
);

// Signing in or out changes the Twitch connection: start over. Other settings
// apply to new messages.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && (signInChanged(changes.twitchAuth) || signInChanged(changes.kickAuth))) return location.reload();
  if (area === 'sync' && Object.keys(changes).some((k) => k !== 'splits' && !isNotesKey(k))) await ctx.reload();
});

followTab();
