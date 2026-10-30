'use strict';

// One room's stage, as in the original (`views/index.jade`): the track well
// with the queue on the left, the screen and chat in the middle, and who is
// listening on the right.
function styles () {
  return `
    .row-fluid [class*="span"].unpadded {
      padding: 0;
      width: 541px;
      margin: 0 12px;
    }
    .row-fluid [class*="span"].padded-left {
      padding-left: 12px;
      width: 302px;
    }
    .row-fluid [class*="span"].padded-right {
      padding-right: 12px;
      margin-left: 0;
      width: 302px;
    }
    #track-info a:hover { text-decoration: none; }
    #track-title, #attribution {
      text-transform: uppercase;
      font-weight: bold;
      display: block;
      height: 1.2em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #current-track #track-title {
      height: 1.5em;
      font-size: 1.5em;
      line-height: 1.5em;
    }
    #track-curator { font-weight: normal; text-transform: none; }
    #track-progress { position: relative; }
    #time {
      position: absolute;
      top: 0;
      width: 100%;
      text-align: center;
      font-weight: bold;
      display: block;
    }
    .progress { margin-bottom: 10px; }
    .track-controls { margin-bottom: 10px; }
    .track-controls input[type="range"] { width: 100%; margin: 4px 0 0; accent-color: #08c; }
    .btn-group.sound-controls { margin: 0 0 10px; float: none; }
    .btn-group.sound-controls .btn {
      min-height: 0;
      padding: 0.5em;
      width: 50%;
      box-sizing: border-box;
    }
    #messages, #playlist, #userlist {
      height: 262px;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-color: rgb(51,51,51) transparent;
      scrollbar-width: thin;
    }
    #messages { padding-bottom: 0.2em; }
    #playlist {
      height: 382px;
      clear: both;
    }
    #userlist { height: 508px; }
    #userlist li.current-curator { font-weight: bold; }
    #userlist .user-actions { float: right; margin: 3px 8px 0 0; }
    #userlist .user-actions i, #playlist-list .mod i { cursor: pointer; opacity: 0.5; }
    #userlist .user-actions i:hover, #playlist-list .mod i:hover { opacity: 1; }
    .room-description { margin: 0 12px 12px; }
    #room-settings { margin-bottom: 12px; }
    #room-settings textarea, #room-settings input[type="text"] { width: 100%; box-sizing: border-box; }
    #room-settings ul li { padding: 2px 0; }
    #room-settings ul a { margin-left: 0.5em; }
    .save-controls { margin: 0 0 10px; }
    .save-controls select { width: 140px; margin: 0; }
    .room-links { font-size: 0.85em; margin: 0 0 10px; }
    .muted-row { opacity: 0.6; }
    #userlist .guests { padding: 3px 15px 3px 22px; color: rgb(140,140,140); }
    .playlist-controls {
      float: left;
      margin-right: 5px;
    }
    .playlist-controls .score {
      float: right;
      margin: 7px 0 0 15px;
    }
    .playlist-controls i {
      display: block;
      cursor: pointer;
      opacity: 0.5;
    }
    .playlist-controls i:hover, .playlist-controls i.on { opacity: 1; }
    #playlist-list li {
      clear: both;
      text-transform: uppercase;
      font-weight: bold;
      font-size: 0.8em;
      padding-left: 0.2em;
    }
    #playlist-list .track-details { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #playlist-list .remove { cursor: pointer; }
    .thumbnail-medium {
      max-height: 2.4em;
      margin-right: 0.2em;
    }
    #search-form .input-block-level { width: 227px; }
    #add-status { font-size: 0.85em; min-height: 1.2em; margin: 0.3em 0 0; }
    #screen-one {
      margin-left: auto;
      margin-right: auto;
      height: 295px;
      background: black;
      position: relative;
      overflow: hidden;
    }
    #screen-one iframe, #screen-one img {
      width: 100%;
      height: 295px;
      border: 0;
      display: block;
      object-fit: cover;
    }
    #player-note {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      margin: 0;
      padding: 0.5em;
      background: rgba(0,0,0,0.7);
      text-align: center;
    }
    #player-note:empty { display: none; }
    .chat-container { margin-left: auto; margin-right: auto; }
    .message { clear: both; }
    .message abbr.timestamp { font-size: 0.75em; }
    .message strong[data-role="author"] { cursor: default; }
    .fadeout-top { box-shadow: inset 0 20px 20px -20px #000000; }
    #chat-form .input-block-level { width: 464px; }
    @media (max-width: 1199px) {
      #chat-form .input-block-level { width: 382px; }
      .row-fluid [class*="span"].unpadded { width: 614px; }
      .row-fluid .span3.padded-right {
        margin-left: 1em;
        width: calc(100% - 1em);
      }
      .row-fluid .span3.padded-right .nav-list { border: 0; }
      .row-fluid .span3.padded-right .nav-list > li {
        display: inline-block;
        margin: 1.5em;
        border: 0;
      }
      .row-fluid .span3.padded-right .nav-list > li a { padding: 0.5em; }
      .row-fluid .span3.padded-right #userlist { height: auto; }
    }
    @media (max-width: 1199px) and (min-width: 980px) {
      #chat-form .input-block-level { width: 536px; }
    }
    @media (max-width: 979px) and (min-width: 768px) {
      #chat-form .input-block-level { width: 85%; }
    }
    @media (max-width: 979px) and (min-width: 945px) {
      .row-fluid [class*="span"].padded-left {
        padding-left: 0;
        width: 290px;
      }
    }
    @media (max-width: 944px) {
      .row-fluid [class*="span"].padded-left {
        width: 100%;
        padding-left: 12px;
        padding-right: 12px;
        box-sizing: border-box;
      }
      #playlist {
        height: auto;
        max-height: 200px;
      }
      .row-fluid [class*="span"].unpadded {
        width: 100%;
        padding: 0 12px;
        margin: 0;
        box-sizing: border-box;
      }
      #search-form .input-block-level { width: 90%; }
    }
    @media (max-width: 781px) {
      #chat-form .input-block-level { width: 100%; }
      #chat-form button {
        display: block;
        width: 100%;
      }
    }`;
}

/** @returns {string} */
function render () {
  return `<main id="room" hidden>
        <div class="alert alert-info room-description" id="room-description" hidden></div>
        <form class="well content-well" id="room-settings" hidden>
          <h3><a class="close" href="#" id="room-settings-close" title="close">&times;</a>Room settings</h3>
          <div class="row-fluid">
            <div class="span6">
              <label for="room-settings-name">Name</label>
              <input type="text" id="room-settings-name" name="name" maxlength="64" required>
              <label for="room-settings-description">Description</label>
              <textarea id="room-settings-description" name="description" maxlength="280" rows="3"></textarea>
              <div id="room-rules">
                <label for="room-rule-add">Who may add songs</label>
                <select id="room-rule-add" name="add">
                  <option value="everyone">everyone</option>
                  <option value="moderators">moderators</option>
                </select>
                <label for="room-rule-skip">Who may skip</label>
                <select id="room-rule-skip" name="skip">
                  <option value="curator">whoever added it</option>
                  <option value="everyone">everyone</option>
                  <option value="moderators">moderators</option>
                </select>
                <label for="room-rule-remove">Who may take songs out of the queue</label>
                <select id="room-rule-remove" name="remove">
                  <option value="curator">whoever added it</option>
                  <option value="moderators">moderators</option>
                </select>
                <label class="checkbox"><input type="checkbox" id="room-autoplay" name="autoplay"> Auto-DJ: when the queue runs out, play songs people chose here before</label>
              </div>
              <div><input class="btn btn-primary" type="submit" value="save &raquo;"> <span id="room-settings-status"></span></div>
            </div>
            <div class="span6">
              <h4>Owner</h4>
              <p id="room-owner"></p>
              <h4>Moderators</h4>
              <ul class="unstyled" id="room-moderators"></ul>
              <h4>Banned songs</h4>
              <ul class="unstyled" id="room-banned-tracks"></ul>
              <h4>Banned listeners</h4>
              <ul class="unstyled" id="room-banned-people"></ul>
            </div>
          </div>
        </form>
        <div id="stage">
          <div class="row-fluid">
            <div class="span3 padded-left">
              <div class="well">
                <div id="current-track">
                  <div id="track-info">
                    <div id="attribution">
                      <span id="track-curator" class="pull-right"></span>
                      <a id="track-artist" href="#" target="_blank" rel="noopener noreferrer"></a>
                    </div>
                    <a id="track-title" href="#" target="_blank" rel="noopener noreferrer">Nothing is playing</a>
                  </div>
                  <div id="track-progress" class="progress active">
                    <div class="bar" id="track-bar" style="width: 0%;"></div>
                    <span id="time">00:00</span>
                  </div>
                </div>

                <div class="row-fluid track-controls">
                  <div class="span2">
                    <a class="btn btn-mini" href="#" id="volume-toggle" title="mute"><i class="icon-white icon-volume-up" id="volume-icon"></i></a>
                  </div>
                  <div class="span10">
                    <input type="range" id="volume" min="0" max="100" value="80" aria-label="Volume">
                  </div>
                </div>

                <div class="btn-group sound-controls">
                  <a class="btn btn-mini" href="#" id="listen"><i class="icon-white icon-play" id="listen-icon"></i> <span id="listen-label">listen</span></a>
                  <a class="btn btn-mini" href="#" id="skip" hidden><i class="icon-white icon-step-forward"></i> skip</a>
                </div>

                <form class="form-inline save-controls" id="save-form" hidden>
                  <select id="save-set" aria-label="Set to save the song to"></select>
                  <button class="btn btn-mini" type="submit" title="save what is playing to a set"><i class="icon-white icon-plus"></i> save</button>
                  <a class="btn btn-mini btn-danger" href="#" id="ban-current" title="ban this song from the room" hidden><i class="icon-white icon-ban-circle"></i> ban</a>
                </form>

                <p class="room-links">
                  <a href="#" id="room-history">history</a>
                  <span id="room-stream-link" hidden>&middot; <a href="#" id="room-stream" title="this room as an MP3 stream, for any player">stream</a></span>
                  <span id="room-settings-link" hidden>&middot; <a href="#" id="room-settings-open">settings</a></span>
                </p>

                <div id="playlist">
                  <h5 style="text-transform: uppercase; margin: 0; margin-top: 5px;">Coming Up Next...</h5>
                  <ul id="playlist-list" class="nav nav-list"></ul>
                </div>

                <h5><span class="pull-right" id="queue-length" title="Length of all tracks in the playlist">00:00</span>Add Track</h5>
                <form id="search-form" class="input-append" style="display: block;">
                  <input class="input-block-level" type="text" id="search-query" name="song" autocomplete="off" disabled placeholder="sign in to add a track">
                  <button class="btn" type="submit" id="search-submit" disabled><i class="icon-share-alt"></i></button>
                </form>
                <p id="add-status" role="status"></p>
              </div>
            </div>

            <div class="span6 unpadded">
              <div id="screen-one">
                <div id="player"></div>
                <p id="player-note"></p>
              </div>
              <div class="chat-container">
                <div id="messages" class="fadeout-top"></div>
                <form id="chat-form" class="input-append" style="display: block;">
                  <input class="input-block-level" type="text" id="chat-input" name="text" maxlength="500" autocomplete="off" disabled placeholder="sign in to join the conversation">
                  <button class="btn" type="submit" id="chat-submit" disabled><i class="icon-share-alt"></i></button>
                </form>
              </div>
            </div>

            <div class="span3 padded-right">
              <div class="well">
                <div id="audience">
                  <h3><small class="pull-right user-count" id="user-count"></small>Users</h3>
                  <ul class="nav nav-list" id="userlist"></ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>`;
}

module.exports = {
  id: 'room-page',
  styles,
  render
};
