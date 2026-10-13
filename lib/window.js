/* The chat window (chat.html) and popped-out chats (popout.html): open them, or bring them forward. */

import { chatKey } from './sources.js';
import { loadSettings, saveSettings } from './settings.js';

/** Open (or focus) the chat window; `chat` (a list of sources) is added to it if it isn't there yet. */
export async function openChatWindow(chat) {
  if (chat) {
    const { splits } = await loadSettings();
    if (!splits.some((s) => chatKey(s) === chatKey(chat))) await saveSettings({ splits: [...splits, chat] });
  }
  await focusOrOpen(chrome.runtime.getURL('chat.html'), 1200, 800);
}

/** A window of the extension's own at `url`: brought forward if it's open, else opened, that big. */
async function focusOrOpen(url, width, height) {
  const [open] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  if (open) await chrome.windows.update(open.windowId, { focused: true });
  else await chrome.windows.create({ url, type: 'popup', width, height });
}

/** A platform's own page in a small window beside the chat (its chat, to write, vote or predict there). */
export const openBeside = (url) => chrome.windows.create({ url, type: 'popup', width: 420, height: 720 });

/** The address of a popped-out chat (a list of sources). */
export const popOutUrl = (chat) => chrome.runtime.getURL(`popout.html?chat=${encodeURIComponent(JSON.stringify(chat))}`);

/** Pop a chat out into its own small window, or bring it forward if it's already out. */
export const popOutChat = (chat) => focusOrOpen(popOutUrl(chat), 420, 720);
