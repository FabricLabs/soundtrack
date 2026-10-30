'use strict';

const escapeHtml = require('../functions/escapeHtml');

// The page around every view: the fixed navbar, the shadowed module, and the
// textured footer of the original soundtrack.io (`views/layout.jade`).
function styles () {
  return `
    body {
      padding-top: 41px;
      padding-bottom: 40px;
      background: url('/img/binding_dark.png') rgb(22,22,22);
      color: rgb(208,208,208);
    }
    textarea, input[type="text"], input[type="password"], input[type="number"], input[type="search"], input[type="url"], .uneditable-input {
      background: rgb(33,33,33);
      border-radius: 0;
      border: 0;
      color: rgb(208,208,208);
    }
    input[disabled], input[readonly] { background: rgb(28,28,28); }
    [hidden] { display: none !important; }
    .btn { text-shadow: none; }
    .nav-list { padding: 0; }
    .nav-list>li {
      border-top: 1px solid rgb(33,33,33);
      border-bottom: 1px solid black;
    }
    .nav-list>li:hover {
      border-bottom: 1px solid rgb(22,22,22);
      background: rgb(33,33,33);
    }
    .nav-list>li>a {
      text-shadow: none;
      padding: 3px 15px 3px 22px;
    }
    .module {
      background: rgb(22,22,22);
      padding-top: 19px;
    }
    .container.module {
      box-shadow: rgba(0, 0, 0, 0.8) 0 1px 7px 0px;
      border-bottom-right-radius: 3px;
      border-bottom-left-radius: 3px;
    }
    .well { padding: 12px; }
    .content-well { margin: 0 12px 12px; }
    .messages { margin: 0 12px; }
    .navbar .brand { padding: 10px 0px 10px; }
    .navbar a.brand {
      padding-left: 12px;
      margin-left: 0;
    }
    .navbar a.brand img {
      max-height: 1em;
      margin-bottom: -0.2em;
      vertical-align: top;
    }
    .navbar a.brand img:hover {
      animation: spin 1300ms linear infinite;
    }
    .navbar .navbar-text.pull-right { margin-left: 10px; }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .user-avatar-small {
      max-height: 1.2em;
      margin-right: 0.2em;
    }
    .highlight { background: rgb(33,33,33); }
    .tooltip { pointer-events: none; }
    footer {
      font-size: 0.9em;
      box-shadow: 0px -1px 10px rgba(0, 0, 0, 0.75);
      border-top: 1px solid rgb(44,44,44);
      padding: 24px;
      background: url('/img/txture.png') rgb(22,22,22);
      border-bottom-right-radius: 3px;
      border-bottom-left-radius: 3px;
      margin: -5px;
    }
    footer .container { width: auto; }
    @media (max-width: 979px) {
      body { padding: 0; }
      .container {
        width: 100%;
        margin-left: 0;
        margin-right: 0;
      }
      footer { margin: 0; }
    }
    @media (max-width: 767px) {
      .navbar-fixed-top, .navbar-fixed-bottom, .navbar-static-top {
        margin-right: 0;
        margin-left: 0;
      }
    }`;
}

/**
 * @param {Object} props
 * @param {string} props.name Site name (the brand when no room is open).
 * @param {string} props.sourceUrl Where the code lives.
 * @param {string} props.body Trusted HTML: the views.
 * @returns {string}
 */
function render (props) {
  const name = escapeHtml(props.name);
  return `<div class="navbar navbar-fixed-top">
      <div class="navbar-inner">
        <div class="container">
          <button type="button" class="btn btn-navbar" id="nav-toggle" aria-label="Menu">
            <i class="icon-bar"></i>
            <i class="icon-bar"></i>
            <i class="icon-bar"></i>
          </button>
          <a class="brand" href="/" title="browse all rooms"><img src="/favicon.ico" alt=""></a>
          <a class="brand" href="/" id="brand-name">${name}</a>
          <div class="nav-collapse collapse" id="nav-collapse">
            <ul class="nav">
              <li id="nav-rooms"><a href="/" title="browse all rooms">Rooms</a></li>
            </ul>
            <ul class="nav pull-right" id="session"></ul>
          </div>
        </div>
      </div>
    </div>

    <div class="container module">
      <div class="messages" id="flash"></div>

      ${props.body}

      <footer>
        <div class="container">
          <p>&#9835; ${name} is a collaborative online jukebox. It&rsquo;s a way to listen to music with your friends, here or in a Discord voice channel. It&rsquo;s also <a href="${escapeHtml(props.sourceUrl)}">open-source</a>.</p>
          <div class="row-fluid">
            <div class="span6">
              <a class="btn btn-default" href="/">Browse Rooms &raquo;</a>
            </div>
            <div class="span6">
              <a href="${escapeHtml(props.sourceUrl)}">Source</a>
            </div>
          </div>
        </div>
      </footer>
    </div>`;
}

module.exports = {
  id: 'site-layout',
  styles,
  render
};
