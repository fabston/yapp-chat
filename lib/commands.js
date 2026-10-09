/*
 * Commands in the message box, for moderators: Twitch stopped taking them through chat in 2023 (only /me goes, as a
 * message), so each goes through Twitch's API, or Kick's, as the mod buttons do (ChatPane.modTools). The list and the
 * parsing are pure (unit-tested); runCommand does them.
 */

import { parseDuration } from './moderation.js';
import { twitchAnnounce, twitchChatSettings, twitchClearChat, twitchSetShieldMode, twitchShoutout, twitchUserId } from './twitch.js';

/**
 * name → { usage (what it takes: [in brackets] if it may be left out), about, group (in /help's list: COMMAND_GROUPS),
 * kick (Kick has it too), alias (/help shows it with that one) }. A name ending in "off" turns its mode off: /help
 * shows it with the mode. /me isn't here: it's a message (lib/twitch.js send).
 */
export const COMMANDS = {
  timeout: { usage: 'name [length] [reason]', about: 'Time them out, for your first length if none', group: 'people', kick: true },
  ban: { usage: 'name [reason]', about: 'Ban them', group: 'people', kick: true },
  unban: { usage: 'name', about: 'Lift their ban or timeout', group: 'people', kick: true },
  untimeout: { usage: 'name', about: 'Lift their timeout', group: 'people', kick: true, alias: 'unban' },
  warn: { usage: 'name reason', about: 'Warn them: they have to acknowledge it', group: 'people' },
  clear: { usage: '', about: 'Clear the chat for everyone', group: 'chat' },
  slow: { usage: '[seconds]', about: 'Slow mode, 30 seconds if none', group: 'modes' },
  slowoff: { usage: '', about: 'Slow mode off', group: 'modes' },
  followers: { usage: '[length]', about: 'Followers-only, any follower if no length', group: 'modes' },
  followersoff: { usage: '', about: 'Followers-only off', group: 'modes' },
  subscribers: { usage: '', about: 'Subscribers-only', group: 'modes' },
  subscribersoff: { usage: '', about: 'Subscribers-only off', group: 'modes' },
  emoteonly: { usage: '', about: 'Emote-only', group: 'modes' },
  emoteonlyoff: { usage: '', about: 'Emote-only off', group: 'modes' },
  uniquechat: { usage: '', about: 'Unique chat: no repeating a message', group: 'modes' },
  uniquechatoff: { usage: '', about: 'Unique chat off', group: 'modes' },
  shield: { usage: '', about: 'Shield Mode', group: 'modes' },
  shieldoff: { usage: '', about: 'Shield Mode off', group: 'modes' },
  announce: { usage: 'message', about: 'An announcement; /announceblue, green, orange or purple for a colour', group: 'chat' },
  shoutout: { usage: 'name', about: 'Shout out their channel', group: 'people' },
  chatters: { usage: '', about: "Who's in chat", group: 'chat' },
  help: { usage: '', about: 'These commands', group: 'chat' },
};

/** The list's sections (commandGroups): [group, title]. */
const COMMAND_GROUPS = [
  ['people', 'People'],
  ['modes', 'Chat modes'],
  ['chat', 'Chat'],
];

const COLORS = ['blue', 'green', 'orange', 'purple'];

/** A command's entry in COMMANDS: /announceblue and the other colours are /announce's. */
const commandOf = (name) => COMMANDS[COLORS.includes(/^announce(\w+)$/.exec(name)?.[1]) ? 'announce' : name];

/**
 * "/timeout andy 10m spam" → { name: 'timeout', args: 'andy 10m spam' }; null if it isn't one of COMMANDS (so
 * "/r/funny" or "/shrug" is a message, as before; /me too: lib/twitch.js sends it).
 */
export function parseCommand(text) {
  const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m && commandOf(m[1].toLowerCase()) ? { name: m[1].toLowerCase(), args: (m[2] || '').trim() } : null;
}

/** "andy the rest" → ['andy', 'the rest'] (a login: lower case, no @). */
const nameAndRest = (args) => {
  const [first = '', ...rest] = args.split(/\s+/);
  return [first.replace(/^@/, '').toLowerCase(), rest.join(' ')];
};

/** A /timeout's words: { login, seconds (0: none given; -1: one Twitch doesn't take, like 3w), reason }. */
export function timeoutArgs(args) {
  const [login, rest] = nameAndRest(args);
  const [length = '', ...more] = rest.split(/\s+/);
  if (!/^\d+[smhdw]?$/i.test(length)) return { login, seconds: 0, reason: rest.trim() };
  return { login, seconds: parseDuration(length) || -1, reason: more.join(' ').trim() };
}

/** The commands whose name starts with `prefix` that work in `platform`'s chat ([name, { usage, about }]). */
export function commandsFor(prefix, platform) {
  return Object.entries(COMMANDS).filter(([name, c]) => name.startsWith(prefix) && (platform === 'twitch' || c.kick || name === 'help'));
}

/**
 * The commands as listed (/help, Settings → Moderation): [title, [[name, command, off]]] by group, for `platform`'s
 * chat; a mode's "off" (its name in `off`) and an alias go with the one they belong to.
 */
export function commandGroups(platform) {
  const commands = new Map(commandsFor('', platform));
  const listed = ([name, c]) => !c.alias && !(name.endsWith('off') && commands.has(name.slice(0, -3)));
  return COMMAND_GROUPS.map(([group, title]) => [
    title,
    [...commands].filter(([name, c]) => c.group === group && listed([name, c])).map(([name, c]) => [name, c, commands.has(`${name}off`) ? `${name}off` : '']),
  ]).filter(([, rows]) => rows.length);
}

/**
 * Do `command` ({ name, args }, from parseCommand) in `feed`'s chat (one you moderate): throws, saying why, when it can't. /help and
 * /chatters show something (pane.showCommands, pane.openChatters); the others go to Twitch or Kick.
 */
export async function runCommand(pane, feed, { name, args }) {
  const command = commandOf(name);
  const color = command === COMMANDS.announce && name !== 'announce' ? name.slice('announce'.length) : '';
  if (name === 'help') return pane.showCommands(feed);
  if (!feed.isMod) throw new Error(`/${name} is for moderators of ${feed.label}.`);
  if (feed.platform !== 'twitch' && !command.kick) throw new Error(`Kick doesn't have /${name}.`);
  if (name === 'chatters') return pane.openChatters(feed);
  const auth = pane.ctx.auth;
  const room = feed.roomId;
  const usage = () => new Error(`/${name} ${command.usage}`);
  // Someone by their name: from the chat (their id), or (Twitch) asked of Twitch.
  const user = async (login) => {
    if (!login) throw usage();
    const known = feed.chatters.get(login) || [...feed.chatters.values()].find((u) => u.name.toLowerCase() === login);
    if (known?.id) return known;
    const id = feed.platform === 'twitch' ? await twitchUserId(auth, login) : '';
    if (!id) throw new Error(feed.platform === 'twitch' ? `There's no ${login} on Twitch.` : `${login} hasn't chatted here lately (Kick needs their id).`);
    return { id, login, name: login, color: '', badges: [] };
  };
  const settings = (body) => twitchChatSettings(auth, room, body);
  switch (color ? 'announce' : name) {
    case 'timeout': {
      const { login, seconds, reason } = timeoutArgs(args);
      if (seconds < 0) throw new Error('/timeout takes 1 second to 2 weeks, like 10m or 1d.');
      return pane.modTools(feed, await user(login)).timeout(seconds || pane.ctx.settings.modTimeouts[0], reason);
    }
    case 'ban': {
      const [login, reason] = nameAndRest(args);
      return pane.modTools(feed, await user(login)).ban(reason);
    }
    case 'unban':
    case 'untimeout':
      return pane.modTools(feed, await user(nameAndRest(args)[0])).unban();
    case 'warn': {
      const [login, reason] = nameAndRest(args);
      if (!reason) throw usage();
      return pane.modTools(feed, await user(login)).warn(reason);
    }
    case 'clear':
      return twitchClearChat(auth, room);
    case 'slow': {
      const seconds = args ? parseDuration(args) : 30;
      if (!(seconds >= 3 && seconds <= 120)) throw new Error('/slow takes 3 seconds to 2 minutes.');
      return settings({ slow_mode: true, slow_mode_wait_time: seconds });
    }
    case 'slowoff':
      return settings({ slow_mode: false });
    case 'followers': {
      const seconds = args ? parseDuration(args) : 0;
      if (args && !seconds) throw new Error('/followers takes a length like 10m, 1h or 1d.');
      return settings({ follower_mode: true, follower_mode_duration: Math.round(seconds / 60) });
    }
    case 'followersoff':
      return settings({ follower_mode: false });
    case 'subscribers':
    case 'subscribersoff':
      return settings({ subscriber_mode: name === 'subscribers' });
    case 'emoteonly':
    case 'emoteonlyoff':
      return settings({ emote_mode: name === 'emoteonly' });
    case 'uniquechat':
    case 'uniquechatoff':
      return settings({ unique_chat_mode: name === 'uniquechat' });
    case 'shield':
    case 'shieldoff':
      return twitchSetShieldMode(auth, room, name === 'shield');
    case 'announce':
      if (!args) throw usage();
      return twitchAnnounce(auth, room, args, color || 'primary');
    case 'shoutout':
      return twitchShoutout(auth, room, (await user(nameAndRest(args)[0])).id);
    default:
      throw usage();
  }
}
