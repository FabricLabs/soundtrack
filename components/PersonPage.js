'use strict';

// A listener's page, as the original profile (`views/person.jade`): their
// name, then tabs for the songs they queue most, their sets, the rooms they
// run, and what they played lately.
function styles () {
  return `
    .avatar-large {
      max-height: 4em;
      margin: 0 0.6em 0.6em 0;
    }
    #person h1 { line-height: 1.2em; }
    #person-lastfm a { font-size: 0.6em; }
    #person .tab-content { clear: both; }
    #person .queue-bar { margin: 0 0 0.6em; }
    #person .queue-bar select { width: auto; margin: 0; }
    #set-creation-form textarea, #set-creation-form input[type="text"] { width: 100%; box-sizing: border-box; }
    #person-top li, #person-room-list li { padding: 2px 0; }`;
}

/** @returns {string} */
function render () {
  return `<main id="person" hidden>
        <div class="well content-well">
          <div class="pull-right">
            <div class="btn-group">
              <a class="btn" href="#" id="person-rename" hidden><i class="icon-pencil"></i> edit name</a>
              <a class="btn" href="/services/soundtrack/lastfm/connect" id="lastfm-connect" hidden>add last.fm &raquo;</a>
              <a class="btn" href="#" id="lastfm-disconnect" hidden>remove last.fm</a>
            </div>
          </div>
          <img class="avatar-large pull-left" src="/img/user-avatar.png" alt="">
          <h1><span id="person-name"></span> <small id="person-lastfm"></small></h1>
          <p class="muted" id="person-since"></p>

          <p class="queue-bar form-inline">
            <label for="person-queue-room">&#9835; queue songs from here in</label>
            <select id="person-queue-room"></select>
            <span id="person-status" role="status"></span>
          </p>

          <ul class="nav nav-tabs" id="person-tabs">
            <li class="active"><a href="#profile" data-pane="person-profile">Profile</a></li>
            <li><a href="#sets" data-pane="person-sets">Sets</a></li>
            <li><a href="#rooms" data-pane="person-rooms">Rooms</a></li>
            <li><a href="#plays" data-pane="person-plays">Plays</a></li>
          </ul>

          <div class="tab-content">
            <div class="tab-pane active" id="person-profile">
              <h3>Most Queued Tracks</h3>
              <ol id="person-top"></ol>
            </div>
            <div class="tab-pane" id="person-sets">
              <h3><a class="pull-right btn btn-default" href="#" id="set-new" hidden>Add New &raquo;</a>Sets</h3>
              <form id="set-creation-form" hidden>
                <label for="new-set-name">Name</label>
                <input type="text" id="new-set-name" name="name" maxlength="64" required>
                <label for="new-set-description">Description</label>
                <textarea id="new-set-description" name="description" maxlength="280" rows="2"></textarea>
                <div><input class="btn" type="submit" value="create &raquo;"></div>
              </form>
              <table class="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Tracks</th>
                    <th>Controls</th>
                  </tr>
                </thead>
                <tbody id="person-set-list"></tbody>
              </table>
            </div>
            <div class="tab-pane" id="person-rooms">
              <h3>Rooms</h3>
              <ul id="person-room-list"></ul>
            </div>
            <div class="tab-pane" id="person-plays">
              <h3>Recent Plays</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Artist</th>
                    <th>Title</th>
                    <th>Room</th>
                    <th>Controls</th>
                  </tr>
                </thead>
                <tbody id="person-play-list"></tbody>
              </table>
            </div>
          </div>
        </div>
      </main>`;
}

module.exports = {
  id: 'person-page',
  styles,
  render
};
