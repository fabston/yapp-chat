# Changelog

What changed in each version of Yapp Chat, newest first. Get it from the [Chrome Web Store](https://chromewebstore.google.com/detail/yapp-chat/ocebmcgmildjdidagnnifoegheabnpgd).

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
