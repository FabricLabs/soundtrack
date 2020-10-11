soundtrack.io
=============
collaborative music streaming

[![Build Status](https://img.shields.io/travis/martindale/soundtrack.io.svg?branch=soundtrack.io&style=flat-square)](https://travis-ci.org/martindale/soundtrack.io)
[![Coverage Status](https://img.shields.io/coveralls/martindale/soundtrack.io/soundtrack.io.svg?style=flat-square)](https://coveralls.io/r/martindale/soundtrack.io)

soundtrack.io is a collaborative online jukebox.  It is an experimental Internet radio platform.  Vote on what plays next, like Reddit for music.  Aggregates streams from sources like YouTube and SoundCloud, so when a song is queued, it has multiple locations to play from if any one source fails for any particular reason.

## Quick Start
1. `npm install -g FabricLabs/soundtrack`
2. `soundtrack`

## Configuration
Supply environment variables `FABRIC_PORT` and/or `FABRIC_SEED` for Fabric
peer-to-peer communication and persistent storage, respectively.

## Earning Bitcoin
Income can only be generated for online nodes, through an opt-in program.

To enable earning, be sure to provide `FABRIC_SEED` with a mnemonic and use:

```
$ soundtrack --earn
```

Be sure to back up your keys — we are not responsble for any losses!

## API
`TODO: npm run make:api`

## Contributing
Want to help?  Claim something in [the "ready" column on our Waffle.io](https://waffle.io/martindale/soundtrack.io) by assigning it to yourself.

[Fork. Commit. Pull request.](https://help.github.com/articles/fork-a-repo)
