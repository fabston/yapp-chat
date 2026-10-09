/*
 * A chat in its own window (the pop-out button on a chat). Which chat is in
 * the address: popout.html?chat=<list of sources as JSON>, and &message=<id> to
 * go to a message (a mention's notification).
 */

import { ChatContext, ChatPane } from './lib/chat.js';
import { isNotesKey, signInChanged } from './lib/settings.js';
import { isSource, sourceLabel, uniqueSources } from './lib/sources.js';
import { popOutUrl } from './lib/window.js';

function chatFromAddress() {
  try {
    const chat = uniqueSources([].concat(JSON.parse(new URLSearchParams(location.search).get('chat'))).filter(isSource));
    return chat.length ? chat : null;
  } catch {
    return null;
  }
}

const setTitle = (chat) => (document.title = `${chat.map(sourceLabel).join(' + ')} · Yapp Chat`);

const chat = chatFromAddress();
if (!chat) {
  window.close();
} else {
  const ctx = await ChatContext.create();
  setTitle(chat);
  const pane = new ChatPane(document.getElementById('paneHost'), chat, ctx, {
    popOut: false,
    // Channels added or removed: the address follows, so a reload shows the same chat.
    onChange: (next) => {
      history.replaceState(null, '', popOutUrl(next));
      setTitle(next);
    },
  });
  const message = new URLSearchParams(location.search).get('message');
  if (message) pane.reveal(message);

  // Signing in or out changes the Twitch connection: start over. Other settings apply to new messages.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && (signInChanged(changes.twitchAuth) || signInChanged(changes.kickAuth))) return location.reload();
    if (area === 'sync' && Object.keys(changes).some((k) => k !== 'splits' && !isNotesKey(k))) await ctx.reload();
  });
}
