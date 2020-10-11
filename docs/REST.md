soundtrack api
==============

While soundtrack does not yet utilize [the maki framework](http://maki.ericmartindale.com) directly, it was actually one of the first iterations upon which maki was based.  Herein we will present the soundtrack API as it would be expectedly served if it were directly powered by Maki.

**A note on URLs:** soundtrack does not currently provide explicit collections; instead, it attempts to merge all "entity" resources into a single root collection.  For example, an Artist and a Person might share a namespace, and subsequently will be rendered as one item.  A "claiming" mechanism may be introduced in the future.

**Content Negotiation:** all endpoints will attempt to serve an HTML representation of that resource by default.  To override this, supply the `Accept: application/json` header to perform Content Negotiation and retrieve a JSON version of that resource.

**Slugs:** slugs are used as the normalization mechanism for potentially complex strings.  These use [the `speakingurl` package](https://github.com/pid/speakingurl), which should run in both node and the browser.

# Resources

## Queue
`:roomSlug\.yourdomain\.tld/playlist.json`
Deprecated, still functional.  Retrieves room's queue.

`:roomSlug\.yourdomain\.tld/queue`
Retrieves the specified room's queue.  Not yet working.

## Person
Registered users of the soundtrack application.

`/register`
`POST` to create a user (deprecated!!!)

`/login`
`POST` to initiate a session (deprecated!!!)

`/people`
`POST` to create a user, `GET` to retrieve a list of users.

`/people/:usernameSlug`
`GET` to retrieve a specific user, `PATCH` to update specific fields, `PUT` to create a user.

`/:usernameSlug`
Retrieves a specific user, if it exists.  Falls back wherever possible or 404s.

### Auths
These will add an external profile to the currently established session's user, or **create a new user if not**.

`/auth/lastfm`
`/auth/spotify`
`/auth/google`

## Artist
Artists which have been recognized by the soundtrack server.

`/artists`
`POST` to create an artist, `GET` to retrieve a list of artists.

`/artists/:artistSlug`
`GET` to retrieve a specific artist, `PATCH` to update specific fields, `PUT` to create an artist.

## Chat
Chat messages for a specific room.

`:roomSlug\.yourdomain\.tld/chat`
`GET` retrives a list of the most recent messages, `POST` to create a message.

## Play
Moments when a track has been "played" in a Room; there are special rules for when it's considered a play, following last.fm's scrobbling rules.  Only if more than 30s of a track has been listened to, and counting as a play when 2 minutes or half the track has been played, whichever happens first.

`:roomSlug\.yourdomain\.tld/plays`
`GET` retrieves a list of all plays for a room.

`/:usernameSlug/plays`
`GET` to retrieve a list of all plays by a specific user.

## Source
Audio sources and their appropriate metadata.  Not yet functional.

## Set
Bundles of `Track` resources that are meant to be played together (also, `Playlists`).

`/:usernameSlug/sets`
`GET` to retrieve a list of the users' sets, `POST` to create one.

`/:usernameSlug/:setSlug`
`GET` to retrieve a specific set, `PATCH` to update it.

`/sets`
`GET` to retrieve a list of all public sets.

## Track
Tracks which have been recognized by the soundtrack server.

`/tracks`
`GET` to retrieve a list of tracks, `POST` to create a track.

`/tracks/:trackID`
`GET` to retrive a specific track by its `_id`, `PATCH` to update specific components of that track (e.g., editing the title)
