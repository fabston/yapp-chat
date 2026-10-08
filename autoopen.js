/*
 * Content script on twitch.tv, kick.com and youtube.com: opens Yapp Chat's side panel on
 * your first click (or key press) on a live stream. Chrome only lets an
 * extension open the panel in answer to one. Once per page, so closing the
 * panel keeps it closed; off with "Open on live streams" in Settings.
 * It never reads what's on the page beyond "is this a live stream".
 */
(() => {
  let url = '';
  let enabled = false;
  let channelLive = false; // Twitch or Kick: asked of the background (their APIs)
  let done = false;

  // Live on YouTube: the player's LIVE badge and the live chat beside it.
  const youTubeLive = () =>
    Boolean(document.querySelector('#movie_player .ytp-live-badge') && document.querySelector('ytd-live-chat-frame'));

  // On load and after in-page navigation (both sites are single-page apps).
  async function check() {
    if (!chrome.runtime?.id) return clearInterval(checking); // the extension was updated or removed: this copy is done
    if (location.href === url) return;
    url = location.href;
    done = false;
    channelLive = false;
    enabled = (await chrome.storage.sync.get({ autoOpen: true })).autoOpen;
    if (enabled && (location.hostname.endsWith('twitch.tv') || location.hostname === 'kick.com')) {
      const at = url;
      const live = Boolean(await chrome.runtime.sendMessage({ type: 'isLive', url }).catch(() => false));
      if (url === at) channelLive = live; // not if you've moved on meanwhile
    }
  }

  function onGesture() {
    if (done || !enabled || location.href !== url) return;
    if (!channelLive && !(location.hostname === 'www.youtube.com' && youTubeLive())) return;
    done = true;
    chrome.runtime.sendMessage({ type: 'openPanel' }).catch(() => {});
  }

  check();
  const checking = setInterval(check, 1000);
  // Runs at document_start so these come before the sites' own listeners (YouTube's player stops clicks).
  addEventListener('pointerdown', onGesture, true);
  addEventListener('keydown', onGesture, true);
  // A click inside an iframe on the page (Twitch's extension overlays cover the
  // video) only shows up here as the page losing focus, still with the click's activation.
  addEventListener('blur', () => {
    if (navigator.userActivation?.isActive) onGesture();
  });
})();
