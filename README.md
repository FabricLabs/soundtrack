soundtrack.io
=============
[![Build Status](https://img.shields.io/travis/martindale/soundtrack.io.svg?branch=soundtrack.io&style=flat-square)](https://travis-ci.org/martindale/soundtrack.io)
[![Coverage Status](https://img.shields.io/coveralls/martindale/soundtrack.io/soundtrack.io.svg?style=flat-square)](https://coveralls.io/r/martindale/soundtrack.io)

soundtrack.io is a collaborative online jukebox.  It is an experimental Internet radio platform.  Vote on what plays next, like Reddit for music.  Aggregates streams from sources like YouTube and SoundCloud, so when a song is queued, it has multiple locations to play from if any one source fails for any particular reason.

## Getting Started

Before you begin you will need to have nodejs, redis, and mongodb installed.
Homebrew is recommended for OS X users.

```
brew install nodejs mongodb redis
```

In the logged output, you'll find some instructions for starting both mongodb and redis – you can follow those instructions, or execute once with `redis-server & mongod &`

Once you have them installed (and running!), go ahead and clone the repository.

    git clone git@github.com:martindale/soundtrack.io.git
    cd soundtrack.io

You will need to fetch the dependencies and then you can start up the server.

    npm install
    node soundtrack.js
    
### Testing Rooms
Now that soundtrack has multiple rooms, you'll need to configure your local hostname lookups to point at the appropriate locations.  In `/etc/hosts` (or equivalent for your OS):

```
127.0.0.1 localhost.localdomain
127.0.0.1 test.localhost.localdomain
```

You'll need to add an entry for each subdomain you want to test.  Also, the `.localdomain` component is important for sessions, as some browsers expect a top level domain for cookies to work correctly!

## API

Deleting tracks:
`$.ajax('/playlist/520e6bda3cb680003700049c', { type: 'DELETE', data: { index: 1 } });`

## Contributing
Want to help?  Claim something in [the "ready" column on our Waffle.io](https://waffle.io/martindale/soundtrack.io) by assigning it to yourself.

[Fork. Commit. Pull request.](https://help.github.com/articles/fork-a-repo)
