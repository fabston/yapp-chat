# Changelog

What changed in each version of Yapp Chat, newest first. Get it from the [Chrome Web Store](https://chromewebstore.google.com/detail/yapp-chat/ocebmcgmildjdidagnnifoegheabnpgd).

## 1.0.25
- Predictions, polls and pinned messages, above the chat on Twitch and Kick, as on their own sites:
  - A prediction shows its outcomes with their share of the points, how many predicted each, and the time left to predict; then *Locked*, then its result with the winner marked.
  - A poll shows its choices with their votes and the time left; when it ends, the winner is marked.
  - A pinned message shows as a line of the chat (emotes, the name opening their card) with who pinned it.
  - They're to look at: voting and predicting stay on Twitch and Kick. ✕ puts one away; Settings → *Chat* → *Pinned messages, polls and predictions* turns them all off. In a combined chat each says whose it is.
- The raid bar (in channels you moderate) is a card now, like those: the raid's icon, its viewers as a pill, and buttons with icons that tick off once done.

## 1.0.24
- More commands in the message box (Twitch; sign in again once for them, Settings shows it):
  - For everyone: `/clip` makes a clip of the stream's last moments and gives you its link, `/block name` blocks someone on Twitch and hides their messages here (`/unblock` undoes both), `/w name message` whispers them (answers arrive on twitch.tv for now).
  - In your own channel: `/mod` and `/unmod`, `/vip` and `/unvip`, `/raid channel` and `/unraid`, `/commercial` for an ad break, and `/marker` for a stream marker (editors can use that one too).
  - Typing `/` now suggests commands to everyone, only the ones you can use in that chat; `/help` lists the same. Settings → *Moderation* marks which are for everyone or the broadcaster.
  - A command typed in full that takes nothing (`/clip`, `/clear`) runs at the first Enter, instead of needing a second one.
- Channel points on Twitch stand out: a *Highlighted message* says so above it, and a reward redeemed with a message shows which reward and what it cost ("Redeemed Hydrate · 500"). They're never folded into repeats.
- Mentions can make themselves heard: Settings → *Notifications* has *Play a sound for mentions* (a short ping) and *Flash the window for mentions* (the taskbar or Dock asks for attention when the chat isn't in front). Both are off until you turn them on.
- Nicknames: your own name for someone, shown in chat instead of theirs (hover it for their real name). Set one in their user card, next to the note, or in Settings → *Friends*; typing `@` finds them by it too. Only you see it.
- The message box shows emotes as pictures: type an emote's name and it turns into the emote once you type on (as it will look in chat). Backspace right after one turns it back into its name, to change it. A thread's reply box does the same. The message box is also a little bigger.
- In a combined chat, being banned in one of its channels shows as a small hammer in the header (hover it for which), leaving the names their room; in the list under it, *Banned* is a small tag beside the channel's name, not a wide bar under it.
- Tab completes emotes too, from their first two letters, without typing `:`; Tab again goes to the next one that fits, then to names. `@` before the letters keeps it to names.

## 1.0.23
- Mod tools, much better (Twitch moderators: sign in again once, Settings shows it, for the new ones):
  - Your own timeout lengths, in Settings → *Moderation*: in one row on a message's menu and the user card, the first also on a message's buttons. The user card offers to lift a timeout or ban while one holds.
  - *Moderate…*, on a message's menu and the user card: what this chat saw of them ("Timed out until 16:20 · 2 timeouts here lately"), a reason (typed, or one you saved), any of your lengths or one you type, a ban, lifting a timeout or ban, and on Twitch a warning.
  - Lift a timeout or ban from its line in the chat, or from the user card.
  - Who timed someone out or banned them, and why, on its line; what else moderators do (chat modes, warnings, VIPs, unbans…) as quiet lines of their own. On Kick, who banned and unbanned.
  - Twitch: messages AutoMod holds show up in the chat, with who sent them and *Allow* and *Deny* right under them.
  - Twitch: change the chat modes from the chat's header: slow mode, followers-only, subscribers-only, emote-only, unique chat and Shield Mode.
  - Twitch: suspicious users get a *Monitored* or *Restricted* badge before their name.
  - Keys on the message you point at: D deletes it, T times them out, B bans them. Mod buttons on every message, if you like.
  - Commands in the message box: type `/` for the list (`/timeout name 10m reason`, `/ban`, `/unban`, `/warn`, `/slow`, `/followers`, `/emoteonly`, `/shield`, `/clear`, `/announce`, `/shoutout`… and `/help`). Twitch stopped taking them through chat; these go through its API. On Kick: timeout, ban and unban.
  - Settings → *Moderation* lists the commands too (folded away, for those who moderate), by group, with what each takes; the search at the top finds them ("slow", "shoutout").
  - Twitch: who's in chat, by role (broadcaster, moderators, VIPs, viewers) and with a search (`/chatters`, or the chat's header).
  - Twitch: announcements (in the channel's colour or another) from the chat's header, and shoutouts from a raid or `/shoutout`.
  - Twitch: raid protection. When a raid of 20 or more comes in, a bar offers followers-only for 10 minutes, Shield Mode and a shoutout (Settings → *Moderation* turns it off).
  - Twitch: a first-time chatter whose account is under a month old gets a badge before their name with the account's age, like 🌱 3d (point at it for the date).
- The panel that opens when you click a reply is now called *Thread*, and you can answer right from it: a box at the bottom replies to its newest message (keeping it in the same thread). New replies, yours too, show up in it as they come, and what you'd typed in the message box stays. Its lines now use the chat's text size, so emotes there are no longer oversized.
- Drag a user card or a thread by its top to move it, and 📌 pin it: it stays open when you click elsewhere (its ✕ closes it), and the next name or reply you click opens in a box of its own, so you can keep several open. A pinned thread keeps taking in new replies.
- A message you jump to (from a reply's quote, a thread or a mention) stays lit longer, so it's easy to spot.
- When Twitch refuses a message you sent (followers-only, subscribers-only, slow mode, a duplicate…), the chat says so plainly: "Not sent: …" in the warning colour, and your message is greyed and marked *Not sent* rather than looking sent. Failed mod actions and commands stand out the same way.
- In a chat that combines platforms, who you're writing to shows its platform (a Twitch or Kick badge on the picture), on the button and in its menu, so the same name on Twitch and Kick is told apart.
- Settings → *Notifications*: the channels you follow fold away under one line that says how many notify ("Notifying for 12 of the 240 channels you follow"); open it to choose.
- Settings → *Appearance*: the choices line up, the preview has a header level with them, and in a narrow window the preview comes first and stays in view while you go through the choices. *Lines* is now *Spacing*.
- Settings → *About*: the shortcuts in groups (in chat, typing, mouse), `/` among them, with ⌘ and ⌥ on a Mac, and the new mod keys folded away for those who moderate; the search at the top finds them too.
- Settings: ⌘F (Ctrl+F) goes to the search at the top, as `/` already did; the search box shows both.
- Settings' parts that fold away (like *Build a regex*) look like the rest of Settings, with an arrow that turns as they open; its checkboxes are in the theme's colours and line up with their words. Links in Settings' text look like yapp.chat's, not the browser's purple.
- In a narrow chat, "Reconnecting…" in the header no longer runs into the channel's live time and viewers: it's shortened instead (point at it for all of it).

## 1.0.22
- The chat preview in Settings → *Appearance* shows real badges (moderator, VIP and subscriber ranks) instead of letters.

## 1.0.21
- The mentions inbox, improved:
  - It collects messages with your name. Highlight words still stand out in chat, but go to the inbox only if you turn on *Also collect highlight words in Mentions* (Settings → *Highlights*), so a common word doesn't fill it.
  - Mentions look like chat: the channel's picture with its platform, emotes as pictures, your name (or highlight word) marked, and "5 minutes ago".
  - New ones are marked until you've seen them.
  - Clicking one goes to that message in its chat (and flashes it), not just to the chat.
  - It keeps the last 100 after the browser closes (on this device; Settings → *Privacy & data* clears it), and the count on the toolbar icon comes back with them.
  - Empty, it says what it's waiting for (your name) and, signed out, offers to sign in.
  - New in Settings → *Notifications*: a desktop notification for each mention (off at first). More at once update one notification ("3 new mentions"); a click opens that chat at the message.
  - The unread count on the toolbar icon and the bell is red with white figures, easier to see on the yellow duck.
- Open a streamer who's live on several platforms at once (like xQc on Twitch and Kick) and a bar offers to combine their chats into one. It looks for the same name on Twitch, Kick and YouTube (for YouTube, first the channel on their Kick profile), and only offers where they're live right now. ✕ hides it for that streamer until the browser restarts; Settings → *Chat* turns it off.

## 1.0.20
- Settings → *About*: the help links (Discord, the website, the changelog, GitHub, the privacy policy) as cards with their icons.

## 1.0.19
- What's new in each version is now on the website too, at [yapp.chat/changelog](https://yapp.chat/changelog), linked under Settings → *About*.
- A deleted message no longer gets the buttons over it when you point at it to read what it said (right-click still has them).

## 1.0.18
- Replies, improved:
  - Click the quote above a reply for the whole conversation: the message it started with and every reply in the chat, in order, with their times; click one to go to it. One that started before you opened the chat shows its first message as quoted.
  - The quote shows emotes, and the name in its chat colour, also once the message it answers has left the chat (from their chatting lately).
  - Pointing at a reply makes the message it answers glow, if it's on screen.
  - Pointing at a reply's quote previews its conversation: the message it started with and the replies up to that one (+N more); a click shows it all.

## 1.0.17
- Settings, reorganized: *Hidden* is its own section next to *Highlights* (bots and commands, people, words), with headings like the rest; *People* is now *Friends*.
- Search settings: a box at the top shows only what matches as you type (press / to get there).
- *Reset all settings* under *Privacy & data* (it asks once more first); sign-ins, notes and the chat window's chats stay.
- A new dropdown, the same look as the rest of Yapp Chat in both themes, in place of the browser's own (the regex builder's *Where*); keys work as in a menu.
- The shortcut list shows `:lul` and `@na` as one key each.

## 1.0.16
- Highlight words take regexes too, written between slashes (`/gg+/i`), next to plain words and phrases.
- New in Settings → People → *Hidden*: hide messages with certain words, phrases or regexes (spoilers, spam).
- *Build a regex*, under both lists: type the words, pick where they count (as whole words, anywhere, at the start, as the whole message), match case or not, stretched letters too (lol, LOOOOL), spam tricks too (look-alikes like fr3e, letters spaced or dotted like f.r.e.e, no space like freesub); see the regex it makes, try it on a message (what matches is marked), and add it. A regex that doesn't work is refused with the reason. Regexes in the lists and the builder show their parts in colour, as regex tools do.
- A message you hid (by its sender or its words) no longer lands in your mentions or the toolbar count.

## 1.0.15
- Go-live notifications, channel by channel: under the switch in Settings → *Notifications*, every Twitch channel you follow is listed with its own switch, all on at first, with a search and *All on* / *All off*. Channels you follow later are on too (or off, after *All off*). A notification has a *Turn off for this channel* button.

## 1.0.14
- More link previews: Twitch videos (past broadcasts, highlights and uploads: title, length, views, category) and channel links on Twitch and Kick (live: the stream's picture, title, viewers and game; offline: the channel's picture, followers and last game).
- A preview picture that won't load is left out instead of showing as broken.
- Laughing folds, however it's typed: "HAHAHAHA", "ahahaha", "Hahahahahah", "AHHAAHAHAH", "bahahaha", "hehehe" are one message, "×12", and so are "LMAOAOAO" and "LMFAOOOO", "lolol" and "lol", "xddd" and "xd". With *Fold similar messages*, mixed laughs ("hahaha lmfao") join in too.
- In a merged chat, the same message folds across its channels: a simulcast's "W" from Twitch, Kick and YouTube is one line, "W ×77", and reaction waves fold across them too. Pointing at the count shows each sender with their platform (the same name on another platform counts as someone else). Timeouts and bans still fold only within their channel.
- A timeout on Twitch and one on Kick at the same moment, for people with the same user id, both show (one was taken for a copy of the other).

## 1.0.13
- Folding repeated messages, much better:
  - It catches copypasta it used to miss: the same message with an invisible character added (as some chat apps do to get past Twitch's duplicate check), different punctuation, stretched letters ("deaddddd", "GOOOO"), a plural s, a word spelled out ("k e y"), the same word more or fewer times ("KEKW KEKW KEKW"), or one mistyped letter in a longer message ("all 3 are ther"). Numbers still count: "rank 1" isn't "rank 2".
  - Repeats fold among a chat's earlier messages too, and a new repeat joins the earlier line.
  - A message said again after a moderator deleted it gets its own line instead of disappearing into the struck-through one.
  - A repeated message that mentions you counts once in your mentions and on the toolbar icon.
  - Point at "×12" to see who sent it: the first eight names in their colours, and how many others; it keeps up as the count grows.
  - The count gets louder as it grows, so big waves stand out: quiet from ×2, brighter from ×5, filled from ×20. It pops briefly as it grows (not with reduced motion).
- New in Settings → Chat: *Fold similar messages* (off unless you turn it on), for busy chats:
  - Messages that mostly say the same within 30 seconds (two or more words in common: "all 3 dead", "ALL 3 DED", "u got all 3") fold into one line, "×8 similar", with a dashed edge.
  - Reaction waves too: once a word fills the chat (in 8 or more messages within 30 seconds, and at least a quarter of them, like "key" when everyone tells the streamer to craft it), short reactions with it (the word and at most one other: "rip LOL", "craft the key") fold into one line, also the ones from just before.
  - Messages that say more stay apart ("kek is lol in orcish"), and so do a word only a few people share ("sums", "sum is right") and opposites ("I love this game", "I hate this game").
  - The line shows the most-sent version in its plainest wording ("the key", not "the key!!!!!!!!"); point at the count for every version and who sent it ("213 messages · 7 versions", most sent first).
- Holding the chat still, improved:
  - In a busy chat, it no longer stays paused after you point at a name (it took the oldest lines going meanwhile for you scrolling up); it follows again once you move off.
  - While it's held, or you've scrolled up to read, the oldest lines aren't dropped, so nothing moves under you (up to twice the usual 600).
  - Moving from one name to the next no longer lets it jump in between: it waits half a second before following again.
  - Pointing at "×N" holds it, and the count goes up where it is instead of the line jumping to the bottom from under the pointer.
  - Pointing at a deleted (struck-through) message holds it, so you can read what it said.
  - Selecting text holds it, so you can copy from a fast chat.
  - New in Settings → Chat: *Hold the chat anywhere under the pointer* (off unless you turn it on). It holds while the pointer moves over the chat, and follows again once it rests for a moment.
- Kick clips and videos get link previews like YouTube links and Twitch clips: point at a kick.com clip link for its picture, title, length, views and who clipped it, or at a past stream's link for its title, length, views and category. A deleted or private video shows none.
- Subs, Super Chats, cheers and KICKs with a message name the person once, in the headline ("name resubscribed"); the message below no longer repeats the name. Announcements keep it, since their headline doesn't say who.
- Things that only show something when you point at them (emotes, badges, channel pictures in merged chats, times, the "×N" count and chat modes) show the "?" cursor; names, links and replies, which you can click, keep the hand.
- Tooltips near the top or bottom of a chat stay inside the window.

## 1.0.12
- Loaded from source (*Load unpacked*), Yapp Chat now has the same ID as the Chrome Web Store version (`ocebmcgmildjdidagnnifoegheabnpgd`), so signing in to Twitch and Kick works there too.

## 1.0.11
- Touch screens: tapping a name no longer leaves the chat paused afterwards (a finger never "leaves" the chat as a mouse does); it holds still only while your finger is on it, and scrolling up still stops it. The card no longer opens under the tap's tooltip.

## 1.0.10
- YouTube chats get a "Write on YouTube" link where the message box would be: it opens the stream's own YouTube chat in a small window, to write there while signed in to YouTube (a menu picks the channel when several are merged).
- YouTube chat is quicker: new messages show within about 2 seconds instead of up to 11 (YouTube's "ask again in 10 s" is meant for its own page, which a push wakes sooner; the chat now asks every second while messages come, every 3 s when it's quiet), and a stream's earlier messages show without waiting for its 1.3 MB watch page.

## 1.0.9
- User cards in a short chat (a small side panel or window): the bio and the note box no longer squeeze into each other; only their messages give way.

## 1.0.8
- Fixes: closing a chat no longer silences the same Twitch channel in your other chats on the page (the connection they share left it); a user card opens again for someone who cheered; a short outage of Twitch or yapp.chat no longer signs you out of Twitch (only a sign-in Twitch refuses is dropped); a sign-in renewed in one window is picked up by the others instead of failing; messages filled in after a reconnect keep their deletions and timeouts, and their mentions reach the inbox; a YouTube chat closed while connecting stops for good; the private note can't be typed in before it has loaded (or lost while notes are still syncing); signing in to Twitch again revokes the old sign-in; the friend button's tooltip follows it.
- Light theme: an "off" switch's knob, placeholders, friends' gold and the sub star are readable on white.
- Screen readers: the channel suggestions, the mentions list and the Settings preview say what they are.
- Clean-up: one shared token code for Twitch and Kick (`lib/tokens.js`), one Helix request helper, about 260 lines of unused styles and two unused icon files removed, leftover comments from the "own app" sign-in updated.

## 1.0.7
- Yapp Chat is open source (MIT): Settings → *About* links the code on GitHub (yapp.chat/github), as do the website and the privacy policy.
- Signing in is one click with Yapp Chat's own apps only: the *Use your own … app* options (Client ID, Kick's Client Secret, the redirect address to copy) are gone from Settings. Twitch sign-ins always renew themselves now.

## 1.0.6
- Twitch sign-ins renew themselves, so you stay signed in: a token that's (nearly) out is renewed before it's used, for the chat connection and every Twitch request, on every open page. The renewal passes through Yapp Chat's sign-in helper on yapp.chat, which adds the app's secret and keeps nothing.
- Settings, tidied: one *Accounts* section for Twitch and Kick (a card each); *Highlights* (your name, your words) apart from *Notifications*; one short line per setting; empty lists say so; live notifications wait for the Twitch sign-in and say why; *Privacy & data* sums up in a line and links the policy; *About* has the Discord, website and privacy links and the version.
- Private notes about people sync with your settings, so they follow your browser profile like friends and highlights (they stay on the device only if they outgrow synced storage). Settings → *Privacy & data* → *Backup* exports your settings, friends, notes and emote history to a file and imports them on another browser or device (not your sign-ins).

## 1.0.5
- Settings: the Twitch and Kick accounts you're signed in with show your profile picture, with the platform's badge on its corner, next to your name.
- Settings: *Sign in with Twitch* and *Sign in with Kick* are in each platform's colours with its logo; Kick's note on yapp.chat is one short line beside the button; "Signed in" and "Signed out" messages fade after a few seconds (errors stay).
- Signing in shows what's happening: the button spins with "Waiting for Twitch…" (or Kick) while its window is open and "Signing in…" once you've approved, then your account fades in. Closing the window says "Sign-in cancelled." instead of an error.

## 1.0.4
- Sign in to Twitch and Kick with one click, through Yapp Chat's own apps; using your own app stays possible under *Use your own … app*. Kick's sign-in passes through a small helper on yapp.chat that adds the app's secret, which can't ship in the extension, and keeps nothing; the privacy policy says so.

## 1.0.3
- The toolbar icon is as big as other extensions' icons: at 16, 32 and 48 px the duck fills the square (it kept the 128 px icon's margin and looked small). The 128 px icon keeps its margin, as the Web Store asks.
- User cards: a new account or follow stands out. Under 30 days old, it reads "Joined 4 days ago" or "Following 3 days" in the warning orange, the first sign of a throwaway account; older ones keep the month ("Joined Oct 2013"), with the exact day on hover. The sub line says what it is, "Subbed 14 months", with the tier only when it's 2 or 3 (always on hover).

## 1.0.2
- Channel suggestions: each picture has its platform's badge on the corner (Twitch or Kick), as on the chats' own pictures, instead of a Kick logo before Kick names.
- YouTube's play mark on the platform badges is centred (it sat a pixel too far right).
- User cards: the friend, platform and close buttons on the banner take clicks along their lower edge too (the picture's row covered it).
- User cards: pointing at the picture shows it big (Twitch's 600 px size, YouTube's and Kick's larger ones); the picture fades in once loaded instead of popping in.
- Buttons on the message you point at: mention, reply, and for moderators delete and a 10-minute timeout, with ⋯ for the whole menu (right-click still opens it too).
- Yapp Chat's colour is the duck's yellow (as on yapp.chat) instead of green, which looked like Kick's: buttons, switches, focus and links. Highlights (your name, your words) and the toolbar's mention count are the duck's orange, so they stay apart from it and from friends' gold.
- Settings: the sidebar marks the section you're in also at the very top and bottom (with a short Twitch section, signed in, it marked Kick and Twitch did nothing), and the one you click; its highlight slides from section to section and the page glides to the one you click.
- The "new messages" button stays on one line in a narrow pane.
- Fixes: a notice no longer grows a few pixels while you point at it; for moderators the chat holds still over a message with its mod buttons (a busy chat can't slide another message under a Timeout click); first messages and friends keep their tint with *Shade every other line*; in Settings, keys scroll the page freely after you click a section, and the section gets keyboard focus; switches and checkboxes that are on have a dark-gold edge in the light theme.
- The website and privacy policy moved to [yapp.chat](https://yapp.chat), linked in Settings and as the extension's homepage.
- The live time ("2h 5m") stays in a side panel of usual width; only a very narrow pane (under 340 px) drops it. Before, any pane under 440 px hid it.
- User cards say "Following Sep 2022" (was "Following since Sep 2022"), so it fits beside the other stats.
- A chat's header shows its platform as a small tile in the platform's colour (as on yapp.chat), so Twitch, Kick and YouTube are the same size there; before, Kick's mark looked biggest and YouTube's smallest.
- First messages stand out in magenta (a tinted line, the stripe and the "First message" label) instead of the colour that also means "on".

## 1.0.1
- The install warning names the sites ("all kick.com sites, all twitch.tv sites, and www.youtube.com") instead of "a number of websites": the auto-open script runs on the same sites as the extension's access.
- Settings (*About*, *Privacy & data*) link the website and the privacy policy, also the extension's homepage.
- Code: the user card moved to `lib/card.js` (with `lib/ui.js` and `lib/notices.js`); no change in what it does.
- Kick: if Kick's live chat connection is turned away (as when Kick changes it), the chat says so and shows new messages every few seconds instead of going quiet; it tries the live connection again every few minutes.
- Messages deleted, or whose sender is timed out, the moment they're sent (moderation bots) are struck through; before, they could show as if nothing happened.
- The emote picker: arrow keys move through the emotes (↓ from the search, Enter picks); Kick chats list Kick's own global emotes; it no longer jumps a few pixels when you first point at an emote.
- User cards list someone's subs, gifts and raids from the chat too, and say when a month of chat logs couldn't load.
- The Settings preview uses made-up names.
- Accessibility: the user card and the emote picker are announced as dialogs, letter badges read as "Moderator", "Subscriber"…
- New logo: a cleaner yapping duck mascot without a background tile, shared by the store art, toolbar, panel headers and website.

## 1.0.0
- Initial release.
- Letter badges (signed out) line up with the name instead of sitting a few pixels low.
- First messages in a channel (Twitch) say "First message" above them, not only the coloured stripe.
- Watch streaks (Twitch) show as a short headline with the count ("name is on a watch streak · 3 streams") instead of Twitch's long sentence.
- User cards say since when someone follows the channel, where you're a moderator or the broadcaster (needs signing in again once).
- Timeouts and bans show as a line in the chat, styled like subs and raids ("name was timed out · 10 minutes" with a muted speaker, "name was banned" with a hammer), not only as struck-through messages; the name opens their card.
- Review fixes: signing in to Kick no longer reloads every chat when its token is renewed; your own Kick messages are known by account id; emotes you send on Kick show on kick.com; timeouts in a chat's earlier messages only strike out what came before them; mentions arriving together are all kept; the card shows the first month of logs without waiting for the count; plus smaller fixes (stale replies across channels, late card updates, the emote picker after the message box goes, the side panel leaving a stream site).
- User cards: from 10,000 logged messages on, the count is short ("439.5K logged").
- Kick in channel suggestions: a few Kick channels under Twitch's as you type a name; `kick:…` searches Kick only.
- Kick support: Kick chats on their own or merged with Twitch and YouTube (`kick:name`, kick.com links, the side panel on kick.com), with emotes, badges, replies, modes, notices, moderation, user cards, and sending and mod tools with your own Kick app.
- User cards: the messages header is one line (the log server, or what's loading); what's loaded and the buttons for earlier months (*Load Sep 2026*, *All (13)*) sit in a bar above the list, always in view.
- User cards: the chat logs come from whichever log server has the most months of them (all three asked at once), with their total message count; the search also searches the months not loaded; earlier names show under the name, one chip each with the years they were used ("xqcow 2017–2022"; the first three, then *+N more*).
- User cards show Twitch's verified check for Partners instead of the word (Affiliate and Staff stay words; Twitch has no affiliate icon).
- User cards: followers and joined, then sub and following since, always in that order; "Last live" is gone.
- Names in subs, gifts (and who got them), raids, watch streaks, Super Chats and memberships open the user card, like names in chat.
- Starring or unstarring an emote updates Favourites in the open picker right away.
- Ctrl/⌘+E opens the emote picker, and Enter in its search picks the first match. Emotes sit closer together, and starred ones stand out more.
