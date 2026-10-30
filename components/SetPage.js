'use strict';

// A set of songs, as the original playlist page (`views/playlist.jade`):
// its name and maker, a queue button, and its tracks; its maker edits it here.
function styles () {
  return `
    #set h1 { line-height: 1.2em; }
    #set .queue-bar select { width: auto; margin: 0; }
    #set-edit-form textarea, #set-edit-form input[type="text"] { width: 100%; box-sizing: border-box; }
    #set-add-form .input-block-level { width: 300px; }
    #set-tracks .remove { cursor: pointer; }`;
}

/** @returns {string} */
function render () {
  return `<main id="set" hidden>
        <div class="well content-well">
          <div class="pull-right queue-bar form-inline">
            <select id="set-queue-room" aria-label="Room to queue the set in"></select>
            <a class="btn" href="#" id="set-queue">&#9835; queue &raquo;</a>
          </div>
          <h1><span id="set-name"></span> <small>by <a id="set-owner" href="#"></a></small></h1>
          <p id="set-description"></p>
          <p id="set-status" role="status"></p>

          <div id="set-owner-controls" hidden>
            <form id="set-add-form" class="input-append">
              <input class="input-block-level" type="text" id="set-add-query" name="song" autocomplete="off" placeholder="add a link or search">
              <button class="btn" type="submit"><i class="icon-plus"></i> add</button>
            </form>
            <a class="btn btn-mini" href="#" id="set-edit"><i class="icon-pencil"></i> edit</a>
            <a class="btn btn-mini btn-danger" href="#" id="set-delete"><i class="icon-white icon-remove"></i> delete set</a>
            <form id="set-edit-form" hidden>
              <label for="set-edit-name">Name</label>
              <input type="text" id="set-edit-name" name="name" maxlength="64" required>
              <label for="set-edit-description">Description</label>
              <textarea id="set-edit-description" name="description" maxlength="280" rows="2"></textarea>
              <div><input class="btn" type="submit" value="save &raquo;"></div>
            </form>
          </div>

          <table class="table">
            <thead>
              <tr>
                <th>Artist</th>
                <th>Title</th>
                <th>Length</th>
                <th>Controls</th>
              </tr>
            </thead>
            <tbody id="set-tracks"></tbody>
          </table>
        </div>
      </main>`;
}

module.exports = {
  id: 'set-page',
  styles,
  render
};
