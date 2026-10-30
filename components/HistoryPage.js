'use strict';

// What a room played, newest first, as the original track history
// (`views/history.jade`), with a button to queue a song again.
function styles () {
  return `
    #history-list .skipped { font-size: 0.8em; }`;
}

/** @returns {string} */
function render () {
  return `<main id="history" hidden>
        <div class="well content-well">
          <a class="btn pull-right" href="#" id="history-back">&laquo; back to the room</a>
          <h1>Track History <small id="history-room"></small></h1>
          <p id="history-status" role="status"></p>
          <table class="table">
            <thead>
              <tr>
                <th>Who</th>
                <th>When</th>
                <th>Artist</th>
                <th>Title</th>
                <th>Controls</th>
              </tr>
            </thead>
            <tbody id="history-list"></tbody>
          </table>
        </div>
      </main>`;
}

module.exports = {
  id: 'history-page',
  styles,
  render
};
