/*
 * Sign-ins that renew themselves (Twitch's and Kick's, through Yapp Chat's token service: lib/apps.js): the
 * token request, the fields a token gives, and renewing one before it runs out.
 */

/** Tokens from a token service, which adds the app's secret. A failure carries Twitch's or Kick's status. */
export async function requestTokens(url, params, platform) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw Object.assign(new Error(json.message || json.error_description || `${platform} answered ${res.status}`), { status: res.status });
  return json;
}

/** The sign-in fields a token gives. A renewal may come without a new refresh token: the old one stays. */
export const tokenFields = (json, refreshToken = '') => ({
  token: json.access_token,
  refreshToken: json.refresh_token || refreshToken,
  expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
});

/** A renewal the platform refused (the sign-in is gone), not one that couldn't be asked. */
export const refused = (error) => error?.status === 400 || error?.status === 401;

const renewing = new Map(); // token service → its renewal under way on this page

/**
 * `auth` with a fresh token when it's (nearly) out, renewed in place (pages and the chat connection hold the
 * object) and saved for the other pages (`save`). Another page may have renewed it first, and a refresh token
 * may work only once: then the one it saved (`load`) is taken. Fails with the platform's status: refused, sign
 * in again; else it couldn't be asked, and the sign-in stays for next time.
 */
export async function renewTokens(auth, { url, platform, load, save }) {
  if (!auth?.refreshToken || Date.now() < auth.expiresAt - 60_000) return auth;
  if (!renewing.has(url)) {
    const renewal = (async () => {
      try {
        Object.assign(auth, tokenFields(await requestTokens(url, { grant_type: 'refresh_token', refresh_token: auth.refreshToken }, platform), auth.refreshToken));
        await save(auth);
      } catch (error) {
        const saved = await load();
        if (saved.token && saved.userId === auth.userId && saved.expiresAt > auth.expiresAt) return void Object.assign(auth, saved);
        const message = refused(error) ? `Sign in to ${platform} again in Settings.` : `Couldn't reach ${platform} to renew your sign-in. Try again.`;
        throw Object.assign(new Error(message), { status: error.status });
      } finally {
        renewing.delete(url);
      }
    })();
    renewing.set(url, renewal);
  }
  await renewing.get(url);
  return auth;
}
