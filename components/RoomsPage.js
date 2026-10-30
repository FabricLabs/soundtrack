'use strict';

const escapeHtml = require('../functions/escapeHtml');

// Every room, as on the original front page (`views/rooms.jade`).
function styles () {
  return `
    .super-soundtrack {
      margin-top: -1em;
      padding: 2em;
    }
    .super-soundtrack p {
      font-size: 1.2em;
      line-height: 1.75em;
      max-width: 30em;
    }
    .super-soundtrack .hero {
      max-height: 20em;
      max-width: 50%;
      margin-left: 1em;
    }
    #room-creation-form { margin: 0 0 1em; }
    #room-creation-form textarea { width: 100%; box-sizing: border-box; }
    #rooms-table h3 { line-height: 1.1em; margin: 0; }
    #rooms-table h5 { margin: 0; }
    #rooms-table p { margin: 0.6em 0 0; }
    #rooms-table td:first-child { width: 60%; }
    @media (max-width: 767px) {
      .super-soundtrack .hero { display: none; }
    }`;
}

/**
 * @param {Object} props
 * @param {string} props.name Site name.
 * @param {string} props.sourceUrl Where the code lives.
 * @returns {string}
 */
function render (props) {
  return `<main id="home" hidden>
        <div class="well content-well">
          <img class="pull-right hero" src="/img/soundtrack.gif" alt="">
          <div class="super-soundtrack">
            <h1>Music for everyone.</h1>
            <h2>Listen to music with your friends.</h2>
            <p><strong>${escapeHtml(props.name)}</strong> is an <em>experimental</em> Internet radio platform. Vote on what plays next, like Reddit for music. We aggregate streams from sources like YouTube and SoundCloud, so when you pick a song, <em>it just plays</em> &mdash; on this page, and in your Discord voice channels.</p>
            <p>We&rsquo;re also <a href="${escapeHtml(props.sourceUrl)}">completely open-source</a> and non-commercial.</p>
            <p><a class="btn btn-large" id="get-started" href="#" hidden>Get Started &raquo;</a></p>
            <div class="clearfix"></div>
          </div>

          <hr>

          <form id="room-creation-form" hidden>
            <label for="new-room-name">Name</label>
            <input type="text" id="new-room-name" name="name" maxlength="64" required>
            <label for="new-room-description">Description</label>
            <textarea id="new-room-description" name="description" maxlength="280" rows="3"></textarea>
            <div><input class="btn" type="submit" value="create &raquo;"> <span id="room-status"></span></div>
          </form>

          <a class="btn pull-right" href="#" id="create-room" hidden>create your own &raquo;</a>
          <h3><span id="room-count">0 Rooms</span> <small>with <strong id="listener-total">0</strong> active listeners</small></h3>

          <table class="table" id="rooms-table">
            <thead>
              <tr>
                <td>Room</td>
                <td>Currently</td>
                <td>Listeners</td>
              </tr>
            </thead>
            <tbody id="rooms"></tbody>
          </table>
        </div>
      </main>

      <main id="missing" hidden>
        <div class="well content-well">
          <h1>No such room!</h1>
          <p>We couldn&rsquo;t find that room. <a href="/">Browse every room &raquo;</a></p>
        </div>
      </main>`;
}

module.exports = {
  id: 'rooms-page',
  styles,
  render
};
