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

/**
 * The sign-in fields a token gives. A renewal may come without a new refresh token: the old one stays. With it comes
 * a pass from the token service (memberPass, below): who you are, for Yapp Chat's own service, good for a day. One
 * that comes without (the service couldn't ask the platform whose it is) leaves the pass there was, which is the
 * same account's and good until it runs out.
 */
export const tokenFields = (json, refreshToken = '') => ({
  token: json.access_token,
  refreshToken: json.refresh_token || refreshToken,
  expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
  ...(typeof json.yapp_pass === 'string' && { pass: json.yapp_pass, passUntil: Number(json.yapp_pass_until) || 0 }),
});

/** A renewal the platform refused (the sign-in is gone), not one that couldn't be asked. */
export const refused = (error) => error?.status === 400 || error?.status === 401;

const renewing = new Map(); // token service → its renewal under way on this page

/**
 * `auth` with a fresh token when it's (nearly) out, renewed in place (pages and the chat connection hold the
 * object) and saved for the other pages (`save`). Another page may have renewed it first, and a refresh token
 * may work only once: then the one it saved (`load`) is taken. Fails with the platform's status: refused, sign
 * in again; else it couldn't be asked, and the sign-in stays for next time. `force`: renewed now, though it isn't
 * out yet (for a pass: memberPass).
 */
export async function renewTokens(auth, { url, platform, load, save }, force = false) {
  if (!auth?.refreshToken || (!force && Date.now() < auth.expiresAt - 60_000)) return auth;
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

/** A renewal made only for a pass isn't made again this soon, pass or none: each one uses a refresh token up. */
const PASS_RETRY = 10 * 60_000;

/**
 * The pass that tells Yapp Chat's own service (name paints and badges) whose sign-in this is: what's sent there in
 * place of the sign-in, which could chat and moderate as you, where a pass can only change your paint and badge.
 * The token service gives one with each token: `auth`'s while it's good; else the one a renewal brings
 * (`fresh(auth, force)`: the account's own, freshTwitchAuth / freshKickAuth), the renewal that's due or one made
 * for it. Throws when there's none to be had.
 */
export async function memberPass(auth, fresh) {
  const good = () => Boolean(auth.pass) && auth.passUntil > Date.now() + 60_000;
  if (!good()) await fresh(auth);
  if (!good() && auth.refreshToken && !(Date.now() - auth.passAsked < PASS_RETRY)) {
    auth.passAsked = Date.now(); // kept with the sign-in (the renewal saves it), so other pages wait too
    await fresh(auth, true);
    if (good()) auth.passAsked = 0; // it brought one: nothing to wait for
  }
  if (good()) return auth.pass;
  // A sign-in from before passes that can't renew itself; or the token service couldn't say whose it is just now.
  throw new Error(auth.refreshToken ? "Yapp Chat couldn't check your sign-in just now. Try again in a few minutes." : 'Sign in again in Settings → Accounts to use this.');
}
