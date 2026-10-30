🎧️ [soundtrack.io][soundtrack]
=============
listen to music together, on the web and in Discord

[![GitHub contributors][badge-contributors]][contributor-list]
[![Community][badge-community]][chat]

[soundtrack.io][soundtrack] is a collaborative online radio, almost like a jukebox for the Internet.

### Vote on what plays next, like Reddit for music.
Each room has a queue everyone adds to. Upvote or downvote a song to push it
toward the top or the bottom; the highest score plays next, and among equal
scores the oldest request goes first. Everyone in a room hears the same song at
the same moment.

### On the web and in Discord voice
The web player plays YouTube, SoundCloud, and audio file links in the page.
Through [Doorman][doorman], the bot joins a Discord voice channel and plays the
room there, with slash commands to add, vote, and skip, and a now-playing post
in the channel you choose.

### A room never goes quiet
When the queue runs out and someone is listening (on the page, in Discord
voice, or on the room's stream), the auto-DJ plays a song people chose in that
room before, at random, skipping anything played there in the last three hours
and anything banned. Its picks are labelled as such and credit nobody.

### Rooms with owners and moderators
Whoever makes a room owns it: they set its description, its rules (who may
add songs, who may skip, who may take songs out), whether the auto-DJ plays,
and its moderators. Moderators ban songs (out of the queue and the auto-DJ,
skipped if playing) and listeners (their waiting songs go; they can't add,
vote, or chat there). Accounts in `SOUNDTRACK_ADMINS` moderate every room.

### Listener pages and sets
Every listener has a page: the songs they chose most, what they played lately,
their sets, and the rooms they run. A set is a named list of songs to queue in
any room, one at a time or all at once; any song in a room's history can be
saved to a set or queued again.

### Listen anywhere, scrobble to Last.fm
Each room is also an endless MP3 stream for any player, radio app, or speaker
that takes a URL, following the room's clock and silent while it is idle.
Listeners who link Last.fm see each song as now playing there while they have
the room open, and it is scrobbled once they have heard enough of it.

## Quick Start
Requires Node.js 26.12.1 (`.nvmrc`), [yt-dlp][yt-dlp], and ffmpeg (with
ffprobe) on the `PATH`.

```
npm i
npm start
```

Then open <http://localhost:15005> and sign in with [Fabric Passport][passport]
to add songs, vote, and chat. Everyone else can listen.

## Signing in
Sign-in is Passport v2 (`@fabric/core` `docs/PASSPORT.md`, through
`@fabric/http`'s relying party): the page asks for a challenge, Passport signs
it for the origin its browser shows, and the server checks the signature, the
origin, and the one-time nonce before opening a session. There are no
passwords and no third-party accounts; you are your Passport key
(`fabric:<x-only pubkey>`). Passport doesn't share a name, so the first sign-in
asks which name to show, and clicking it later changes it.

Challenges are issued only for pinned origins, never for whatever `Host` a
request names: `SOUNDTRACK_PASSPORT_ORIGINS`, else `SOUNDTRACK_URL`. Locally,
any loopback origin works. In production with nothing to pin, sign-in is off and
the site is read-only.

## Configuration
`settings/default.js` holds the defaults; `settings/local.js` (gitignored)
overrides them when present. Secrets come from the environment:

| Variable | Purpose |
|----------|---------|
| `DISCORD_BOT_TOKEN` | Bot token. Turns on Discord (slash commands and voice). |
| `SOUNDTRACK_URL` | Public origin (default `http://localhost:15005`): links, and the origin Passport sign-in is pinned to. |
| `SOUNDTRACK_PASSPORT_ORIGINS` | Comma list of origins to issue Passport challenges for instead (e.g. a second hostname). |
| `SOUNDTRACK_PORT` / `SOUNDTRACK_INTERFACE` | HTTP port (15005) and bind address (`127.0.0.1`). |
| `SOUNDTRACK_STORE` | Fabric Store directory (`stores/soundtrack`). |
| `SOUNDTRACK_ROOM` / `SOUNDTRACK_ROOM_NAME` | Room made on start, which Discord servers play until someone picks another (`lobby`). |
| `SOUNDTRACK_YTDLP` / `SOUNDTRACK_FFPROBE` / `SOUNDTRACK_FFMPEG` | Paths to the tools (ffmpeg plays Discord voice and the room streams). |
| `SOUNDTRACK_ADMINS` | Comma list of account keys (`fabric:<pubkey>`, `discord:<id>`) that moderate every room. |
| `SOUNDTRACK_AUTOPLAY` | `0` turns the auto-DJ off everywhere (owners can also turn it off per room). |
| `SOUNDTRACK_STREAM` / `SOUNDTRACK_STREAM_MAX` | `0` turns the room streams off; most stream listeners across every room (200). |
| `LASTFM_API_KEY` / `LASTFM_API_SECRET` | A [Last.fm API account][lastfm-api]; turns on scrobbling. Its callback is `<SOUNDTRACK_URL>/services/soundtrack/lastfm/callback`. |

## Discord
Invite the bot with the `bot applications.commands` scopes and the View
Channels, Send Messages, Connect, and Speak permissions. It asks Discord only
for the Guilds and GuildVoiceStates intents (nothing privileged). Commands are
registered globally when the bot is ready; only these names are touched, so the
application can be shared with other bots.

| Command | What it does |
|---------|--------------|
| `/play song` | Add a link or a search to the room. Run from a voice channel when the bot isn't playing anywhere in the server, it joins you there. |
| `/queue` | What is playing and the next ten (only you see it). |
| `/np` | What is playing now. |
| `/vote song up\|down\|clear` | Vote on an upcoming song (the song autocompletes). |
| `/skip` | Whoever the room's rules allow (by default whoever added the song, and its moderators), or anyone who can manage channels, skips it. Listeners in the bot's voice channel vote to skip; more than half skips. |
| `/join [channel] [room]` | Play in your voice channel (or the one named) and post songs in this text channel; pick another room. Moving the bot away from listeners needs Manage Channels. |
| `/leave` | Stop playing in voice. Others still listening need someone who can manage channels. |

Replies and posts never ping anyone. If a song's source refuses to play, it is
marked down and the room moves on.

## API
JSON under `/services/soundtrack`. Writes need a Passport session, a JSON body,
and no foreign `Origin`. Responses carry display names and listener ids (16
hex characters, not derived from any key without the server's secret) only,
never keys or Discord ids.

| Route | |
|-------|--|
| `GET /services/soundtrack` | Rooms and what each plays. |
| `GET /services/soundtrack/session` | `{ user: { id, name, person }, passport, lastfm }` (`passport`: sign-in is available; `lastfm`: null when scrobbling is off, else `{ linked }`). |
| `POST /services/soundtrack/passport/challenges` | A Passport challenge for this origin; sets the HttpOnly binding cookie. |
| `POST /services/soundtrack/passport { assertion }` | Redeem the signed assertion (once, with that cookie): `{ user, named }`. |
| `PATCH /services/soundtrack/session { name }`, `POST …/logout` | Change your display name; sign out. |
| `POST /services/soundtrack/rooms { name, description? }` | Make a room (you own it). |
| `GET /services/soundtrack/rooms/<slug>` | The room: current song and position, the queue in play order, owner, moderators, rules, `stream`, and `you` (`role`, `canAdd`, `canSkip`); moderators also get its `bans`. |
| `PATCH /services/soundtrack/rooms/<slug> { name?, description?, permissions?, autoplay? }` | Owner or moderator. `permissions`: `add` `everyone \| moderators`, `skip` `curator \| everyone \| moderators`, `remove` `curator \| moderators` (defaults `everyone`, `curator`, `curator`). |
| `POST …/moderators { person }`, `DELETE …/moderators/<person>` | Owner: choose moderators by listener id. |
| `POST …/bans { track \| person }`, `DELETE …/bans/tracks/<id>`, `DELETE …/bans/people/<person>` | Moderators: ban and unban songs and listeners. |
| `GET /services/soundtrack/rooms/<slug>/events` | Server-Sent Events: `queue`, `play`, `idle`, `chat`, `room`, `listeners` (`{ count, names, people }`: signed-in display names and listener ids, guests and stream listeners counted). |
| `GET /services/soundtrack/rooms/<slug>/stream` | The room as `audio/mpeg` (404 when streams are off). |
| `POST /services/soundtrack/rooms/<slug>/queue { song \| track \| set }` | Add a link or search, a known song by id, or every song of a set (`{ added, skipped }`). |
| `POST …/queue/<entry>/votes { vote: 1 \| -1 \| 0 }` | Vote. |
| `DELETE …/queue/<entry>` | Take a song out, as the room's rules allow. |
| `POST …/skip` | Skip the current song, as the room's rules allow. |
| `GET\|POST …/chat`, `GET …/plays` | Chat and play history. |
| `GET /services/soundtrack/tracks/<id>` | A track and how often it played. |
| `GET /services/soundtrack/people/<person>` | A listener's page: name, top songs, recent plays, sets, rooms they run; on your own, `you` and `lastfm`. |
| `POST /services/soundtrack/sets { name, description? }` | Make a set. |
| `GET\|PATCH\|DELETE /services/soundtrack/sets/<id>` | A set and its songs; its owner renames or deletes it. |
| `POST …/sets/<id>/tracks { song \| track }`, `DELETE …/sets/<id>/tracks/<track>` | Its owner adds and removes songs. |
| `GET /services/soundtrack/lastfm/connect`, `GET …/lastfm/callback`, `DELETE …/lastfm` | Link Last.fm (a state cookie ties the callback to your session) and unlink it. |

## Development
```
npm run build              # compile components/ into assets/index.html + assets/scripts/
npm test
npm run lint
npm run link:fabric        # use ../fabric-clean, ../fabric-http, ../fabric-discord, ../doorman
npm run link:fabric -- doorman
```

Code lives in `functions/` (pure: sources, queue order, ids, Last.fm
signatures), `services/` (`soundtrack.js` rooms, the room clock, the auto-DJ,
listeners, and sets in a Fabric Store, `resolver.js` yt-dlp, `discord.js` the
Doorman plugin, `broadcast.js` the room streams, `lastfm.js` scrobbling,
`web.js` the HTTP API), and
`components/` (the web UI). `scripts/node.js` wires them to an `@fabric/http`
server and, with a bot token, a Doorman host.

The web UI keeps the original soundtrack.io look: Bootstrap 2 with Darkstrap
(`assets/css/`, `assets/img/`), the rooms table under the turntable hero, and
a room's three columns (now playing and the queue, the player and chat, the
listeners). Each component exports its `styles()` and `render()`;
`components/SoundtrackApp.js` holds the browser code as one function, which
only reaches the browser as its own source text. `npm run build`
(`types/SoundtrackSPA.js`, `types/HTMLCompiler.js`) writes the one page every
route serves, `assets/index.html`, and the script it loads,
`assets/scripts/soundtrack.js?v=<hash>`. Both are build output, committed:
`tests/site.js` fails when either is stale or hand-edited. Edit the component,
then rebuild. The current script URL is served `immutable`; the page
revalidates. Site name and links come from `site` in `settings/`.

## Contributing
[Fork. Commit. Pull request.](https://help.github.com/articles/fork-a-repo)

## Special Thanks
Based on ideas from @chrisinajar's `hivemind` project on the original turntable.fm, we've assembled a developer-friendly API that is free for everyone to use (that's free as is freedom, not as in free beer).  Credit to @gordonwritescode for solving most of the distributed systems problems, @chjj for authoring `blessed`, and @melnx for endless testing & debugging.

## Credits
- @martindale primary application design
- @chrisinajar hivemind and design review
- @gordonowritescode distributed systems
- @chjj bytecode
- @melnx testing & debugging

[soundtrack]: https://soundtrack.io
[doorman]: https://github.com/FabricLabs/doorman
[passport]: https://github.com/FabricLabs/fabric-browser-extension
[yt-dlp]: https://github.com/yt-dlp/yt-dlp
[lastfm-api]: https://www.last.fm/api/account/create
[badge-contributors]: https://img.shields.io/github/contributors/FabricLabs/soundtrack.svg?style=flat-square
[badge-community]: https://img.shields.io/matrix/soundtrack:fabric.pub.svg?style=flat-square
[contributor-list]: https://github.com/FabricLabs/soundtrack/graphs/contributors
[chat]: https://chat.fabric.pub/#/room/#soundtrack:fabric.pub
