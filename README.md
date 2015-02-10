soundtrack.io
=============
[![Build Status](https://img.shields.io/travis/martindale/soundtrack.io.svg?branch=soundtrack.io&style=flat-square)](https://travis-ci.org/martindale/soundtrack.io)
[![Coverage Status](https://img.shields.io/coveralls/martindale/soundtrack.io/soundtrack.io.svg?style=flat-square)](https://coveralls.io/r/martindale/soundtrack.io)

soundtrack.io is a collaborative online jukebox.  It is an experimental Internet radio platform.  Vote on what plays next, like Reddit for music.  Aggregates streams from sources like YouTube and SoundCloud, so when a song is queued, it has multiple locations to play from if any one source fails for any particular reason.

## Getting Started

Before you begin you will need to have nodejs, redis, and mongodb installed.
Homebrew is recommended for OS X users.

    brew install nodejs mongodb redis
    redis-server &
    mongod &

Once you have them installed, go ahead and clone the repository.

    git clone git@github.com:martindale/soundtrack.io.git
    cd soundtrack.io

You will need to fetch the dependencies and then you can start up the server.

    npm install
    node soundtrack.js

## API

Deleting tracks:
`$.ajax('/playlist/520e6bda3cb680003700049c', { type: 'DELETE', data: { index: 1 } });`

## Contributing
Want to help?  Claim something in [the "ready" column on our Waffle.io](https://waffle.io/martindale/soundtrack.io) by assigning it to yourself.

[Fork. Commit. Pull request.](https://help.github.com/articles/fork-a-repo)
