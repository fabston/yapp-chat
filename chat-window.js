/*
 * Chat window: several chats side by side. Each chat is one
 * channel or several merged. The list is saved (settings "splits"), so it
 * comes back next time, and the side panel can add to it.
 */

import { channelSuggest } from './lib/channel-suggest.js';
import { ChatContext, ChatPane } from './lib/chat.js';
import { mentionsButton } from './lib/mentions.js';
import { isNotesKey, loadSettings, saveSettings, signInChanged } from './lib/settings.js';
import { chatFromInput, chatKey } from './lib/sources.js';

const $ = (id) => document.getElementById(id);

const ctx = await ChatContext.create();
/** key → ChatPane (on screen in the saved order: see reconcile). */
const panes = new Map();

async function saveSplits(update) {
  const { splits } = await loadSettings();
  await saveSettings({ splits: update(splits) });
}

/** Channels were added to or removed from a chat here: save it in its place (the pane keeps its messages). */
function changed(pane, chat) {
  const oldKey = [...panes].find(([, p]) => p === pane)?.[0];
  // Now the same as another column: that one stays, this one goes (reconcile closes it).
  if (panes.has(chatKey(chat)) && panes.get(chatKey(chat)) !== pane) {
    saveSplits((splits) => splits.filter((c) => chatKey(c) !== oldKey));
    return;
  }
  panes.delete(oldKey);
  panes.set(chatKey(chat), pane);
  saveSplits((splits) => splits.map((c) => (chatKey(c) === oldKey ? chat : c)));
}

/** Match the panes on screen to the saved list (kept panes keep their messages). */
function reconcile(splits) {
  const wanted = new Map(splits.map((chat) => [chatKey(chat), chat]));
  for (const [key, pane] of panes) {
    if (!wanted.has(key)) {
      pane.close();
      panes.delete(key);
    }
  }
  for (const [key, chat] of wanted) {
    if (panes.has(key)) continue;
    const pane = new ChatPane($('splits'), chat, ctx, {
      onClose: () => saveSplits((splits) => splits.filter((c) => chatKey(c) !== pane.key)),
      onChange: (next) => changed(pane, next),
    });
    panes.set(key, pane);
  }
  // Saved order, left to right.
  for (const key of wanted.keys()) $('splits').append(panes.get(key).root);
  $('emptyState').hidden = panes.size > 0;
  if (revealing && panes.has(revealing.key)) {
    panes.get(revealing.key).reveal(revealing.id);
    revealing = null;
  }
}

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('addInput');
  // One channel, or several ("xqc, @xqcyt") merged into one chat.
  const chat = chatFromInput(input.value);
  if (!chat) {
    input.setCustomValidity('Enter a Twitch channel, kick:name, a YouTube @handle, or a Twitch/Kick/YouTube link (several: separate with commas).');
    input.reportValidity();
    return;
  }
  await saveSplits((splits) => (splits.some((c) => chatKey(c) === chatKey(chat)) ? splits : [...splits, chat]));
  input.value = '';
});
$('addInput').addEventListener('input', () => $('addInput').setCustomValidity(''));
channelSuggest($('addInput'), ctx);
$('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
// Mentions inbox: a mention goes to its message, in a column with its channel (alone or merged), else in a new one.
let revealing = null; // { key, id }: a column on its way (reconcile), and the message to go to in it
$('settingsBtn').before(
  mentionsButton({
    ctx,
    onOpen: (source, id) => {
      const shown = [...panes.values()].find((p) => p.chat.some((s) => chatKey([s]) === chatKey([source])));
      if (shown) return shown.reveal(id);
      revealing = { key: chatKey([source]), id };
      saveSplits((splits) => [...splits, [source]]);
    },
  }),
);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && (signInChanged(changes.twitchAuth) || signInChanged(changes.kickAuth))) return location.reload();
  if (area !== 'sync') return;
  if (changes.splits) reconcile((await loadSettings()).splits);
  if (Object.keys(changes).some((k) => k !== 'splits' && !isNotesKey(k))) await ctx.reload();
});

reconcile(ctx.settings.splits);

// Alt+← / Alt+→: into the column to the left or right.
document.addEventListener('keydown', (e) => {
  if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  const columns = [...$('splits').children].map((root) => [...panes.values()].find((p) => p.root === root)).filter(Boolean);
  if (!columns.length) return;
  e.preventDefault();
  const at = columns.findIndex((p) => p.root.contains(document.activeElement));
  const next = at < 0 ? 0 : (at + (e.key === 'ArrowRight' ? 1 : -1) + columns.length) % columns.length;
  columns[next].focus();
});
