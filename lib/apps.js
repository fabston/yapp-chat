/*
 * Yapp Chat's own Twitch and Kick apps: signing in is one click with them. A Client ID isn't secret (every
 * sign-in page shows it); a Client Secret is, so it stays on yapp.chat's token service
 * (server/token-service.mjs), which adds it when trading a sign-in code or refresh token for tokens: that's how
 * Kick signs in at all, and how Twitch sign-ins renew themselves. Both apps' redirect URL is this extension's
 * (chrome.identity.getRedirectURL(): https://<the extension's ID>.chromiumapp.org/). The manifest's "key" is the
 * Web Store's, so unpacked copies have the store's ID (ocebmcgmildjdidagnnifoegheabnpgd) and the same address.
 */

export const TWITCH_CLIENT_ID = '3psls8mm63vs48q3ez9yf2zflyoby1';
export const TWITCH_TOKEN_SERVICE = 'https://yapp.chat/api/twitch/token';
export const KICK_CLIENT_ID = '01M4CME59F9E99VPYJ8C814HTC';
export const KICK_TOKEN_SERVICE = 'https://yapp.chat/api/kick/token';
