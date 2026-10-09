// Service worker: opens the side panel on one tab only, from the toolbar icon
// or (autoopen.js) your first click on a live stream. The panel stays with
// that tab (switching away hides it, coming back shows it) and never appears
// on other pages. Everything else runs in the side panel and chat window.

import { formatCount } from './lib/format.js';
import { liveExceptWith, loadNotes, loadSettings, loadTwitchAuth, notifiesFor, saveNotes, saveSettings } from './lib/settings.js';
import { sourceFromUrl } from './lib/sources.js';
import { kickLiveInfo } from './lib/kick.js';
import { twitchFollowedLive, twitchLiveInfo } from './lib/twitch.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error) => console.error(error));
// No panel for the whole window: only the tabs it's opened on get one.
chrome.sidePanel.setOptions({ enabled: false }).catch((error) => console.error(error));

// YouTube's web API (new chat messages, viewer count) refuses requests that
// carry an extension's Origin. Drop the header from the ones Yapp Chat itself makes.
chrome.declarativeNetRequest
  .updateSessionRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] },
        condition: {
          urlFilter: '|https://www.youtube.com/youtubei/v1/',
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ['xmlhttprequest'],
        },
      },
    ],
  })
  .catch((error) => console.error(error));

// Private notes moved to synced storage in 1.0.6: on updating, this device's notes go there (they stay here if
// they don't fit).
chrome.runtime.onInstalled.addListener(async () => {
  const { notes } = await chrome.storage.local.get('notes'); // kept here by versions before 1.0.6
  const all = notes && (await loadNotes());
  if (all) await saveNotes(all);
});

// Unread mentions (lib/mentions.js) on the toolbar icon.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes.unread) return;
  const unread = changes.unread.newValue || 0;
  chrome.action.setBadgeText({ text: unread ? (unread > 99 ? '99+' : String(unread)) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff9a1f' });
});

function openPanel(tabId) {
  // Not awaited: open() has to run while the click still counts as a user gesture.
  chrome.sidePanel.setOptions({ tabId, path: `sidepanel.html?tab=${tabId}`, enabled: true });
  chrome.sidePanel.open({ tabId }).catch(() => {});
}

chrome.action.onClicked.addListener((tab) => openPanel(tab.id));

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  if (message.type === 'openPanel') openPanel(tabId);
  if (message.type === 'isLive') {
    const source = sourceFromUrl(message.url);
    const liveInfo = source?.platform === 'twitch' ? twitchLiveInfo : source?.platform === 'kick' ? kickLiveInfo : null;
    if (!liveInfo) return reply(false);
    liveInfo(source.channel).then((info) => reply(Boolean(info)), () => reply(false));
    return true; // answering asynchronously
  }
});

/* ---- Live notifications (Settings → Notify when channels I follow go live, for all or the ones chosen there) ---- */

/** A picture for a notification: it has to be a data: URL (or one of ours). */
async function pictureFor(url) {
  try {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    return 'icons/icon128.png';
  }
}

/** Every 2 minutes: the channels you follow that are live; a notification for each that wasn't last time (and notifies). */
async function checkLive() {
  const [settings, auth] = await Promise.all([loadSettings(), loadTwitchAuth()]);
  if (!settings.liveNotify || !auth.token) return;
  const live = await twitchFollowedLive(auth).catch(() => null);
  if (!live) return;
  const { liveSeen } = await chrome.storage.session.get('liveSeen');
  // The first check only remembers who's live (no flood of notifications when you switch it on).
  if (liveSeen) {
    for (const channel of live.filter((c) => !liveSeen.includes(c.login) && notifiesFor(settings, c.login))) {
      chrome.notifications.create(`live:${channel.login}`, {
        type: 'basic',
        iconUrl: channel.avatar ? await pictureFor(channel.avatar) : 'icons/icon128.png',
        title: `${channel.name} is live`,
        message: [channel.game, `${formatCount(channel.viewers)} watching`].filter(Boolean).join(' · '),
        buttons: [{ title: 'Turn off for this channel' }],
      });
    }
  }
  await chrome.storage.session.set({ liveSeen: live.map((c) => c.login) });
}

async function scheduleLive() {
  const { liveNotify } = await loadSettings();
  if (liveNotify) {
    if (!(await chrome.alarms.get('live'))) chrome.alarms.create('live', { delayInMinutes: 0.1, periodInMinutes: 2 });
  } else {
    chrome.alarms.clear('live');
    chrome.storage.session.remove('liveSeen');
  }
}

chrome.alarms.onAlarm.addListener((alarm) => alarm.name === 'live' && checkLive());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.liveNotify) scheduleLive();
});
chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith('live:')) return;
  chrome.tabs.create({ url: `https://www.twitch.tv/${id.slice(5)}` });
  chrome.notifications.clear(id);
});
// Its one button: no more notifications for that channel (Settings → Notifications turns it on again).
chrome.notifications.onButtonClicked.addListener(async (id) => {
  if (!id.startsWith('live:')) return;
  chrome.notifications.clear(id);
  const settings = await loadSettings();
  await saveSettings({ liveExcept: liveExceptWith(settings, id.slice(5), false) });
});
scheduleLive();

