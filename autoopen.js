/*
 * Content script on twitch.tv, kick.com and youtube.com: opens Yapp Chat's side panel on
 * your first click (or key press) on a live stream. Chrome only lets an
 * extension open the panel in answer to one. Once per page, so closing the
 * panel keeps it closed; off with "Open on live streams" in Settings.
 * On twitch.tv it also puts a Yapp Chat button in the top bar, among Twitch's own icon buttons (as 7TV does),
 * which opens the panel; off with "Yapp Chat button on Twitch" in Settings. That button is the only thing it adds
 * to a page, and it never reads what's on one beyond "is this a live stream".
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
    if (!chrome.runtime?.id) {
      // The extension was updated or removed: this copy is done, and its button would do nothing.
      document.getElementById(BUTTON)?.remove();
      return clearInterval(checking);
    }
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

  function onGesture(event) {
    // Yours, not one the page made up (which could use the one opening up without opening anything).
    if (event && !event.isTrusted) return;
    if (done || !enabled || location.href !== url) return;
    if (!channelLive && !(location.hostname === 'www.youtube.com' && youTubeLive())) return;
    done = true;
    chrome.runtime.sendMessage({ type: 'openPanel' }).catch(() => {});
  }

  /* ---- Twitch's top bar: a Yapp Chat button ---- */

  const BUTTON = 'yapp-chat-button';
  const SVG = 'http://www.w3.org/2000/svg';
  const shape = (name, attrs) => {
    const node = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };

  /**
   * The button, as Twitch's own icon buttons there: the duck's face in one colour (the bar's icon colour), a round
   * hover, and a label under it while it's pointed at or has the focus (Twitch's tooltips: light on its dark theme,
   * dark on its light one).
   */
  function yappButton() {
    const wrap = document.createElement('div');
    wrap.id = BUTTON;
    wrap.style.cssText = 'position:relative;display:flex;align-items:center;align-self:center;flex:none;margin:0 5px';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Yapp Chat');
    button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:none;border-radius:50%;background:transparent;color:var(--color-fill-button-icon, inherit);cursor:pointer';
    const svg = shape('svg', { viewBox: '0 0 20 20', width: '20', height: '20', fill: 'none', 'aria-hidden': 'true' });
    svg.append(
      shape('circle', { cx: 10, cy: 10.6, r: 7.4, stroke: 'currentColor', 'stroke-width': 1.7 }),
      shape('path', { d: 'M8.7 3.4c.3-1.3 1.6-2.1 2.9-1.8', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      shape('circle', { cx: 7.3, cy: 8.7, r: 1.2, fill: 'currentColor' }),
      shape('circle', { cx: 12.7, cy: 8.7, r: 1.2, fill: 'currentColor' }),
      shape('ellipse', { cx: 10, cy: 13, rx: 4.1, ry: 2.2, fill: 'currentColor' }),
    );
    button.append(svg);
    const tip = document.createElement('div');
    tip.textContent = 'Yapp Chat';
    tip.setAttribute('role', 'tooltip');
    tip.style.cssText = 'position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);z-index:2000;padding:3px 6px;border-radius:4px;font-size:13px;font-weight:600;line-height:1.2;white-space:nowrap;pointer-events:none;display:none';
    const point = (on) => {
      const dark = document.documentElement.classList.contains('tw-root--theme-dark');
      button.style.background = on ? 'var(--color-background-button-text-hover, rgba(128, 128, 140, 0.35))' : 'transparent';
      Object.assign(tip.style, { display: on ? 'block' : 'none', background: dark ? '#fff' : '#0e0e10', color: dark ? '#0e0e10' : '#fff' });
    };
    for (const [type, on] of [['pointerenter', true], ['pointerleave', false], ['focus', true], ['blur', false]]) button.addEventListener(type, () => point(on));
    // The same as the first click on a stream: the panel, for this tab.
    button.addEventListener('click', (e) => e.isTrusted && chrome.runtime.sendMessage({ type: 'openPanel' }).catch(() => {}));
    wrap.append(button, tip);
    return wrap;
  }

  let buttonOn = false;
  /**
   * Keep the button in Twitch's top bar (Twitch draws the bar again now and then), or out of it: at the right end
   * of its row of icon buttons, which starts at the Prime crown (after the last one that's icon-sized: what follows
   * are its wide ones, "Log In" or "Get Bits").
   */
  function placeButton() {
    const there = document.getElementById(BUTTON);
    if (!buttonOn) return there?.remove();
    const crown = document.querySelector('.top-nav__menu .top-nav__prime');
    if (!crown) return;
    let last = crown;
    for (let next = crown.nextElementSibling; next && (next === there || next.getBoundingClientRect().width <= 60); next = next.nextElementSibling) if (next !== there) last = next;
    if (there && last.nextElementSibling === there) return; // in its place
    last.after(there || yappButton());
  }
  const onTwitch = location.hostname === 'www.twitch.tv';
  if (onTwitch) {
    const readSetting = async () => {
      buttonOn = (await chrome.storage.sync.get({ twitchButton: true })).twitchButton;
      placeButton();
    };
    readSetting();
    chrome.storage.onChanged.addListener((changes, area) => area === 'sync' && changes.twitchButton && readSetting());
  }

  check();
  const checking = setInterval(() => {
    check();
    if (onTwitch && chrome.runtime?.id) placeButton();
  }, 1000);
  // Runs at document_start so these come before the sites' own listeners (YouTube's player stops clicks).
  addEventListener('pointerdown', onGesture, true);
  addEventListener('keydown', onGesture, true);
  // A click inside an iframe on the page (Twitch's extension overlays cover the
  // video) only shows up here as the page losing focus, still with the click's activation.
  addEventListener('blur', () => {
    if (navigator.userActivation?.isActive) onGesture();
  });
})();
