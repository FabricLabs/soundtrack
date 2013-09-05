# soundtrack.io

soundtrack.io is a collaborative online jukebox.

## Getting Started

Before you begin you will need to have nodejs, redis, and mongodb installed.
Homebrew is recommended for OS X users.

    brew install nodejs mongodb redis
    redis-server &
    mongod &

Once you have them installed, go ahead and clone the repository.

    git clone git@github.com:fractaloop/soundtrack.io.git
    cd soundtrack.io

You will need to fetch the dependencies and then you can start up the server.

    npm install
    node soundtrack.js

## Contributing

[Fork. Commit. Pull request.](https://help.github.com/articles/fork-a-repo)
