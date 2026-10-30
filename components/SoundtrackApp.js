'use strict';

const clientScript = require('../functions/clientScript');

/**
 * The browser side of every view: routing, the session in the navbar, the
 * rooms table, a room's stage (kept live from `/services/soundtrack`: JSON
 * plus a Server-Sent Events stream per room) and its history, listener
 * pages, and sets. Builds DOM with `textContent` only.
 * @param {Window} window
 */
function soundtrackClient (window) {
  const document = window.document;
  const API = '/services/soundtrack';
  const state = {
    user: null,
    passport: false,
    lastfm: null, // null when Last.fm is off here
    mySets: null,
    set: null, // the set page's set
    signingIn: false,
    siteName: '',
    slug: null,
    view: null,
    offset: 0, // server clock minus ours
    listening: false,
    muted: false,
    volume: 80,
    loaded: null, // entry id in the player
    kind: null, // youtube | audio | soundcloud | still
    yt: null,
    audio: null,
    widget: null,
    events: null,
    reload: null
  };
  const scripts = {};

  function $ (id) {
    return document.getElementById(id);
  }

  function el (tag, attrs) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else if (key === 'onclick') node.addEventListener('click', attrs[key]);
      else node.setAttribute(key, attrs[key]);
    });
    for (let i = 2; i < arguments.length; i++) {
      const child = arguments[i];
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function clear (node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function pad (value) {
    return value < 10 ? '0' + value : String(value);
  }

  // Seconds as the original showed them: MM:SS, or HH:MM:SS past an hour.
  function hhmmss (seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = pad(minutes) + ':' + pad(total % 60);
    return hours ? pad(hours) + ':' + rest : rest;
  }

  function api (path, options) {
    options = options || {};
    const init = { method: options.method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return window.fetch(API + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || ('Request failed (' + res.status + ')'));
        return body;
      });
    });
  }

  function loadScript (src) {
    if (!scripts[src]) {
      scripts[src] = new Promise(function (resolve, reject) {
        const tag = document.createElement('script');
        tag.src = src;
        tag.async = true;
        tag.onload = resolve;
        tag.onerror = function () { reject(new Error('Could not load ' + src)); };
        document.head.appendChild(tag);
      });
    }
    return scripts[src];
  }

  function serverNow () {
    return Date.now() + state.offset;
  }

  function position () {
    const current = state.view && state.view.current;
    return current ? Math.max(0, (serverNow() - current.startedAt) / 1000) : 0;
  }

  function flash (kind, text) {
    const box = $('flash');
    box.appendChild(el('div', { class: 'alert alert-' + kind },
      el('button', { type: 'button', class: 'close', text: '\u00d7', onclick: function (event) { box.removeChild(event.target.parentNode); } }),
      text));
  }

  function trackLink (track, id) {
    const attrs = { href: track.source.uri, target: '_blank', rel: 'noopener noreferrer', text: track.title };
    if (id) attrs.id = id;
    return el('a', attrs);
  }

  // A listener's name, linked to their page when there is one.
  function personLink (id, name) {
    return id ? el('a', { href: '/people/' + id, text: name || 'someone' }) : document.createTextNode(name || 'someone');
  }

  function when (at) {
    const date = new Date(at);
    return el('abbr', { title: date.toISOString(), text: date.toLocaleString() });
  }

  function button (label, title, onclick) {
    return el('a', {
      class: 'btn btn-mini',
      href: '#',
      title,
      onclick: function (event) {
        event.preventDefault();
        onclick();
      }
    }, label);
  }

  function mine () {
    return state.user && state.user.person;
  }

  // Rooms to queue songs in from listener and set pages: the last room
  // opened here first.
  function fillRoomPicker (select) {
    return api('').then(function (body) {
      let last = null;
      try { last = window.localStorage.getItem('soundtrack.room'); } catch (_) { /* private mode */ }
      const pick = body.rooms.some(function (item) { return item.slug === last; }) ? last : body.defaultRoom;
      clear(select);
      body.rooms.forEach(function (item) {
        const option = el('option', { value: item.slug, text: item.name });
        if (item.slug === pick) option.selected = true;
        select.appendChild(option);
      });
    });
  }

  function queueIn (slug, body, status) {
    status.textContent = 'Queueing\u2026';
    return api('/rooms/' + slug + '/queue', { method: 'POST', body }).then(function (result) {
      if (result.added) {
        status.textContent = 'Queued ' + result.added.length + (result.added.length === 1 ? ' song' : ' songs') +
          (result.skipped ? ' (' + result.skipped + ' passed over)' : '') + '.';
      } else {
        status.textContent = 'Queued ' + result.track.title + '.';
      }
    }).catch(function (error) { status.textContent = error.message; });
  }

  // Sign-in with Fabric Passport (v2). Passport answers only on the
  // MessagePort handed over with each message, so nothing else on the page
  // can read or forge its answer.

  const PASSPORT_ERRORS = {
    rejected: 'Sign-in was rejected in Passport.',
    cancelled: 'Sign-in was cancelled.',
    timeout: 'Timed out waiting for approval. Unlock Passport and try again.',
    expired: 'The sign-in expired before it was approved. Try again.',
    busy: 'Passport is busy with other sign-ins. Finish those first.',
    replaced: 'Another sign-in on this page replaced this one.',
    challenge_replayed: 'Passport already answered that sign-in. Try again.',
    passport_unavailable: 'Passport is not ready. Unlock it and try again.',
    invalid_challenge: 'Passport could not read the sign-in request.',
    origin_mismatch: 'Passport saw a different address than this page.',
    passport_outdated: 'Update Fabric Passport to sign in here.'
  };

  function askOnPort (message, wait, read) {
    return new Promise(function (resolve) {
      const channel = new window.MessageChannel();
      let done = false;
      const finish = function (result) {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        try { channel.port1.close(); } catch (_) {}
        resolve(result);
      };
      const timer = window.setTimeout(function () { finish(null); }, wait);
      channel.port1.onmessage = function (event) {
        const answer = read(event && event.data);
        if (answer) finish(answer);
      };
      try {
        window.postMessage(Object.assign({ source: 'fabric-site' }, message), window.location.origin, [channel.port2]);
      } catch (_) {
        finish(null);
      }
    });
  }

  // The protocol version of the Passport on this page; 1 when only an older
  // Passport's marker is there; null when there is none.
  function detectPassport () {
    if (typeof window.MessageChannel !== 'function') return Promise.resolve(null);
    return askOnPort({ type: 'PASSPORT_HELLO', v: 2 }, 600, function (d) {
      return d && d.type === 'PASSPORT_HELLO' && typeof d.v === 'number' ? { v: d.v } : null;
    }).then(function (hello) {
      if (hello) return hello.v;
      return document.documentElement.hasAttribute('data-fabric-passport') ? 1 : null;
    });
  }

  function signIn (event) {
    if (event) event.preventDefault();
    if (state.signingIn) return;
    state.signingIn = true;
    renderSession();
    detectPassport().then(function (version) {
      if (version === null) throw new Error('Fabric Passport was not found. Install or enable it, then reload this page.');
      if (version !== 2) throw new Error(PASSPORT_ERRORS.passport_outdated);
      return api('/passport/challenges', { method: 'POST', body: {} });
    }).then(function (issued) {
      const wait = Math.min(210000, Math.max(5000, Number(issued.expiresAt) - Date.now() || 0));
      return askOnPort({ type: 'PASSPORT_CHALLENGE', challenge: issued.challenge }, wait, function (d) {
        if (!d || typeof d !== 'object') return null;
        if (d.ok === true && d.type === 'PASSPORT_ASSERTION' && typeof d.assertion === 'string') return d;
        if (d.ok === false) return { ok: false, error: typeof d.error === 'string' && d.error ? d.error : 'rejected' };
        return null;
      });
    }).then(function (answer) {
      if (!answer) throw new Error(PASSPORT_ERRORS.timeout);
      if (!answer.ok) throw new Error(PASSPORT_ERRORS[answer.error] || 'Passport: ' + answer.error);
      return api('/passport', { method: 'POST', body: { assertion: answer.assertion } });
    }).then(function (body) {
      if (!body.named) return rename('Signed in. Pick the name others will see:', body.user.name);
    }).then(function () {
      window.location.reload();
    }).catch(function (error) {
      state.signingIn = false;
      renderSession();
      flash('error', error.message);
    });
  }

  function rename (question, current) {
    const name = window.prompt(question || 'The name others see:', current || (state.user && state.user.name) || '');
    if (name === null || !name.trim()) return Promise.resolve(null);
    return api('/session', { method: 'PATCH', body: { name } }).then(function (body) {
      state.user = body.user;
      renderSession();
      return body.user;
    });
  }

  // Navbar

  function renderSession () {
    const box = clear($('session'));
    if (state.user) {
      box.appendChild(el('li', null, el('a', {
        href: '/people/' + state.user.person,
        title: 'signed in with Fabric Passport; your page'
      }, el('img', { class: 'user-avatar-small', src: '/img/user-avatar.png', alt: '' }), state.user.name)));
      box.appendChild(el('li', null, el('a', {
        href: '#',
        text: 'Logout',
        onclick: function (event) {
          event.preventDefault();
          api('/logout', { method: 'POST', body: {} }).then(function () { window.location.reload(); });
        }
      })));
    } else if (state.passport) {
      box.appendChild(el('li', null, el('div', { class: 'navbar-form' },
        el('a', { class: 'btn btn-primary', href: '#', onclick: signIn, text: state.signingIn ? 'Approve in Passport\u2026' : 'Sign In with Passport \u00bb' }))));
    }
    $('get-started').hidden = !!state.user || !state.passport;
    $('create-room').hidden = !state.user;
    const signedIn = !!state.user;
    $('search-query').disabled = !signedIn;
    $('search-submit').disabled = !signedIn;
    $('search-query').placeholder = signedIn ? 'type here and press [ENTER] to add a track' : 'sign in to add a track';
    $('chat-input').disabled = !signedIn;
    $('chat-submit').disabled = !signedIn;
    $('chat-input').placeholder = signedIn ? 'click here to join the conversation' : 'sign in to join the conversation';
  }

  // Views

  function route () {
    const path = window.location.pathname;
    const roomMatch = path.match(/^\/rooms\/([a-z0-9-]+)\/?$/);
    const historyMatch = path.match(/^\/rooms\/([a-z0-9-]+)\/history\/?$/);
    const personMatch = path.match(/^\/people\/([0-9a-f]{16})\/?$/);
    const setMatch = path.match(/^\/sets\/([0-9a-f]{12})\/?$/);
    ['home', 'room', 'history', 'person', 'set', 'missing'].forEach(function (id) { $(id).hidden = true; });
    $('nav-rooms').className = '';
    $('brand-name').textContent = state.siteName;
    let done = null;
    if (path === '/') done = home();
    else if (roomMatch) done = room(roomMatch[1]);
    else if (historyMatch) done = history(historyMatch[1]);
    else if (personMatch) done = person(personMatch[1]);
    else if (setMatch) done = set(setMatch[1]);
    else done = Promise.reject(new Error('not found'));
    return done.catch(missing);
  }

  function missing (error) {
    ['home', 'room', 'history', 'person', 'set'].forEach(function (id) { $(id).hidden = true; });
    document.title = 'Not found | ' + state.siteName;
    $('missing').hidden = false;
    if (error) window.console.warn(error);
  }

  function home () {
    $('home').hidden = false;
    $('nav-rooms').className = 'active';
    document.title = state.siteName + ' | music for all.';
    return api('').then(function (body) {
      const list = clear($('rooms'));
      let listening = 0;
      body.rooms.forEach(function (item) {
        listening += item.listeners || 0;
        const name = el('td', null,
          el('h3', null, el('a', { href: '/rooms/' + item.slug, text: item.name })),
          item.createdBy ? el('small', null, 'hosted by ', el('img', { class: 'user-avatar-small', src: '/img/user-avatar.png', alt: '' }), item.createdBy) : null,
          item.description ? el('p', { text: item.description }) : null);
        const now = el('td', null, item.current
          ? el('h5', null, trackLink(item.current), item.current.artist ? ' by ' + item.current.artist : '')
          : el('h5', { class: 'muted', text: item.upcoming ? item.upcoming + ' up next' : 'quiet' }));
        const count = el('td', null, el('h5', null, el('abbr', { text: (item.listeners || 0) + ' listeners' })));
        list.appendChild(el('tr', { 'data-room-id': item.slug }, name, now, count));
      });
      $('room-count').textContent = body.rooms.length === 1 ? '1 Room' : body.rooms.length + ' Rooms';
      $('listener-total').textContent = String(listening);
    });
  }

  function room (slug) {
    state.slug = slug;
    $('room').hidden = false;
    try { window.localStorage.setItem('soundtrack.room', slug); } catch (_) { /* private mode */ }
    if (mine()) loadMySets();
    return Promise.all([refresh(), refreshChat()]).then(function () {
      if (state.events) state.events.close();
      state.events = new window.EventSource(API + '/rooms/' + slug + '/events');
      ['queue', 'play', 'idle', 'room'].forEach(function (name) {
        state.events.addEventListener(name, scheduleRefresh);
      });
      state.events.addEventListener('chat', function (event) {
        try { appendChat(JSON.parse(event.data)); } catch (_) { /* ignore */ }
      });
      state.events.addEventListener('listeners', function (event) {
        let listeners;
        try { listeners = JSON.parse(event.data); } catch (_) { return; }
        if (state.view) state.view.listeners = listeners;
        renderListeners(listeners);
      });
    });
  }

  function loadMySets () {
    return api('/people/' + state.user.person).then(function (me) {
      state.mySets = me.sets;
      renderSaveForm();
    }).catch(function () { state.mySets = []; });
  }

  function scheduleRefresh () {
    window.clearTimeout(state.reload);
    state.reload = window.setTimeout(refresh, 150);
  }

  function refresh () {
    const sent = Date.now();
    return api('/rooms/' + state.slug).then(function (view) {
      const received = Date.now();
      state.offset = view.now - Math.round((sent + received) / 2);
      state.view = view;
      renderRoom();
      syncPlayer();
    });
  }

  function refreshChat () {
    return api('/rooms/' + state.slug + '/chat?limit=50').then(function (body) {
      clear($('messages'));
      body.messages.forEach(appendChat);
    });
  }

  function appendChat (message) {
    const list = $('messages');
    const at = new Date(message.at);
    const text = String(message.text || '');
    const me = text.slice(0, 4) === '/me ';
    list.appendChild(el('div', { class: 'message', 'data-message-id': message.id },
      el('abbr', { class: 'timestamp pull-right', title: at.toISOString(), text: pad(at.getHours()) + ':' + pad(at.getMinutes()) + ':' + pad(at.getSeconds()) }),
      el('img', { class: 'user-avatar-small', src: '/img/user-avatar.png', alt: '' }),
      el('strong', { 'data-role': 'author' }, personLink(message.authorId, message.author), me ? ' ' : ':'),
      el('span', { class: 'message-content', text: ' ' + (me ? text.slice(4) : text) })));
    list.scrollTop = list.scrollHeight;
  }

  function renderListeners (listeners) {
    listeners = listeners || { count: 0, names: [], people: [] };
    const list = clear($('userlist'));
    const view = state.view;
    const curator = view && view.current ? view.current.curatorId : null;
    const role = view && view.you ? view.you.role : null;
    const staff = {};
    if (view && view.owner) staff[view.owner.id] = 'owner';
    ((view && view.moderators) || []).forEach(function (item) { staff[item.id] = 'moderator'; });
    (listeners.people || []).forEach(function (item) {
      const actions = el('span', { class: 'user-actions' });
      if (role && item.id !== mine() && !staff[item.id]) {
        actions.appendChild(el('i', {
          class: 'icon-ban-circle icon-white',
          title: 'ban ' + item.name + ' from this room',
          onclick: function () {
            if (window.confirm('Ban ' + item.name + ' from this room? Their waiting songs go too.')) act('POST', '/rooms/' + state.slug + '/bans', { person: item.id });
          }
        }));
      }
      if ((role === 'owner' || role === 'admin') && item.id !== mine() && staff[item.id] !== 'owner') {
        const on = staff[item.id] === 'moderator';
        actions.appendChild(el('i', {
          class: (on ? 'icon-star' : 'icon-star-empty') + ' icon-white',
          title: on ? 'take ' + item.name + ' off the moderators' : 'make ' + item.name + ' a moderator',
          onclick: function () {
            if (on) act('DELETE', '/rooms/' + state.slug + '/moderators/' + item.id);
            else act('POST', '/rooms/' + state.slug + '/moderators', { person: item.id });
          }
        }));
      }
      list.appendChild(el('li', { class: item.id === curator ? 'current-curator' : '' }, actions,
        el('a', { href: '/people/' + item.id, title: staff[item.id] || '' },
          el('img', { class: 'user-avatar-small pull-left', src: '/img/user-avatar.png', alt: '' }), item.name)));
    });
    const guests = listeners.count - (listeners.people || listeners.names).length;
    if (guests > 0) list.appendChild(el('li', { class: 'guests', text: guests === 1 ? '1 guest or stream' : guests + ' guests and streams' }));
    clear($('user-count')).appendChild(el('strong', { text: String(listeners.count) }));
    $('user-count').appendChild(document.createTextNode(' online'));
  }

  function renderRoom () {
    const view = state.view;
    document.title = view.name + ' | ' + state.siteName + ' | music for all.';
    $('brand-name').textContent = view.name;
    const current = view.current;
    const title = $('track-title');
    const artist = $('track-artist');
    if (current) {
      title.textContent = current.track.title;
      title.href = current.track.source.uri;
      artist.textContent = current.track.artist || '';
      artist.href = current.track.source.uri;
    } else {
      title.textContent = 'Nothing is playing';
      title.removeAttribute('href');
      artist.textContent = '';
      artist.removeAttribute('href');
    }
    const curator = clear($('track-curator'));
    if (current && current.auto) curator.appendChild(document.createTextNode('auto-DJ'));
    else if (current && current.curator) curator.appendChild(el('span', null, 'from ', personLink(current.curatorId, current.curator)));
    const you = view.you || {};
    $('skip').hidden = !(current && you.canSkip);
    $('ban-current').hidden = !(current && you.role);
    renderSaveForm();

    const description = $('room-description');
    description.textContent = view.description || '';
    description.hidden = !view.description;
    $('room-history').href = '/rooms/' + view.slug + '/history';
    $('room-stream-link').hidden = !view.stream;
    if (view.stream) $('room-stream').href = view.stream;
    $('room-settings-link').hidden = !you.role;
    if (!you.role) $('room-settings').hidden = true;
    if (!$('room-settings').hidden) renderSettings();

    if (state.user) {
      const canAdd = !!you.canAdd;
      $('search-query').disabled = !canAdd;
      $('search-submit').disabled = !canAdd;
      $('search-query').placeholder = canAdd
        ? 'type here and press [ENTER] to add a track'
        : you.banned ? 'you are banned from this room' : 'only this room\u2019s moderators add tracks';
      $('chat-input').disabled = !!you.banned;
      $('chat-submit').disabled = !!you.banned;
    }
    $('listen-label').textContent = state.listening ? 'stop' : 'listen';
    $('listen-icon').className = 'icon-white ' + (state.listening ? 'icon-stop' : 'icon-play');

    const list = clear($('playlist-list'));
    let length = 0;
    view.queue.forEach(function (entry) {
      length += entry.track.duration || 0;
      list.appendChild(queueRow(entry));
    });
    if (!view.queue.length) {
      list.appendChild(el('li', null, el('h4', { text: 'The queue is empty!' }), el('p', { text: 'Add a track using the box below.' })));
    }
    $('queue-length').textContent = hhmmss(length);
    renderListeners(view.listeners);
  }

  function queueRow (entry) {
    const controls = el('div', { class: 'playlist-controls' },
      el('div', { class: 'score badge', text: String(entry.score) }),
      voteIcon(entry, 1, 'icon-chevron-up'),
      voteIcon(entry, -1, 'icon-chevron-down'));
    const remove = entry.removable
      ? el('a', {
        class: 'remove',
        title: 'take it out',
        onclick: function (event) {
          event.preventDefault();
          act('DELETE', '/rooms/' + state.slug + '/queue/' + entry.id);
        }
      }, el('i', { class: 'icon-remove icon-white' }))
      : null;
    const ban = state.view.you && state.view.you.role
      ? el('span', { class: 'mod' }, el('i', {
        class: 'icon-ban-circle icon-white',
        title: 'ban this song from the room',
        onclick: function () {
          if (window.confirm('Ban \u201c' + entry.track.title + '\u201d from this room?')) act('POST', '/rooms/' + state.slug + '/bans', { track: entry.track.id });
        }
      }))
      : null;
    const who = el('div', { style: 'font-size: 0.75em;' },
      el('span', { class: 'pull-right', text: hhmmss(entry.track.duration) }),
      personLink(entry.curatorId, entry.curator), ' wants to play ', remove, ' ', ban);
    const details = el('div', { class: 'track-details', style: 'font-size: 1.1em;' },
      entry.track.thumbnail ? el('img', { class: 'thumbnail-medium pull-left', src: entry.track.thumbnail, alt: '' }) : null,
      trackLink(entry.track));
    const by = el('div', { class: 'track-details clearfix' },
      el('div', { class: 'text-right', text: entry.track.artist ? ' by ' + entry.track.artist : '' }));
    return el('li', { 'data-entry-id': entry.id }, controls, who, details, by);
  }

  function voteIcon (entry, value, icon) {
    const chosen = entry.yours === value;
    return el('i', {
      class: icon + ' icon-white' + (chosen ? ' on' : ''),
      title: state.user ? (value > 0 ? 'vote up' : 'vote down') : 'sign in to vote',
      onclick: function () {
        if (!state.user) return;
        act('POST', '/rooms/' + state.slug + '/queue/' + entry.id + '/votes', { vote: chosen ? 0 : value });
      }
    });
  }

  function act (method, path, body) {
    return api(path, { method, body: body === undefined ? (method === 'POST' ? {} : undefined) : body })
      .then(scheduleRefresh)
      .catch(function (error) { $('add-status').textContent = error.message; });
  }

  // Save what is playing to one of your sets (or a new one).
  function renderSaveForm () {
    const form = $('save-form');
    const current = state.view && state.view.current;
    form.hidden = !(state.user && current);
    const select = $('save-set');
    const chosen = select.value;
    clear(select);
    (state.mySets || []).forEach(function (item) {
      select.appendChild(el('option', { value: item.id, text: item.name }));
    });
    select.appendChild(el('option', { value: '', text: 'new set\u2026' }));
    if (chosen && (state.mySets || []).some(function (item) { return item.id === chosen; })) select.value = chosen;
  }

  function saveCurrent (event) {
    event.preventDefault();
    const current = state.view && state.view.current;
    if (!current) return;
    const status = $('add-status');
    let target = $('save-set').value;
    const made = target
      ? Promise.resolve(target)
      : Promise.resolve(window.prompt('Name the new set:', '')).then(function (name) {
        if (!name || !name.trim()) return null;
        return api('/sets', { method: 'POST', body: { name } }).then(function (created) {
          state.mySets = (state.mySets || []).concat([{ id: created.id, name: created.name, size: 0 }]);
          return created.id;
        });
      });
    made.then(function (id) {
      if (!id) return;
      target = id;
      return api('/sets/' + id + '/tracks', { method: 'POST', body: { track: current.track.id } }).then(function (saved) {
        status.textContent = 'Saved to ' + saved.name + '.';
        renderSaveForm();
        $('save-set').value = target;
      });
    }).catch(function (error) { status.textContent = error.message; });
  }

  // Room settings, for its moderators (rules and the auto-DJ for its owner).
  function renderSettings () {
    const view = state.view;
    const you = view.you || {};
    const owner = you.role === 'owner' || you.role === 'admin';
    const form = $('room-settings');
    if (!form.dataset.dirty) {
      $('room-settings-name').value = view.name;
      $('room-settings-description').value = view.description || '';
      $('room-rule-add').value = view.permissions.add;
      $('room-rule-skip').value = view.permissions.skip;
      $('room-rule-remove').value = view.permissions.remove;
      $('room-autoplay').checked = !!view.autoplay;
    }
    $('room-rules').hidden = !owner;
    clear($('room-owner')).appendChild(view.owner ? personLink(view.owner.id, view.owner.name) : document.createTextNode('nobody (made by the site)'));
    const moderators = clear($('room-moderators'));
    view.moderators.forEach(function (item) {
      moderators.appendChild(el('li', null, personLink(item.id, item.name), owner
        ? button('remove', 'take them off the moderators', function () {
          act('DELETE', '/rooms/' + state.slug + '/moderators/' + item.id);
        })
        : null));
    });
    if (!view.moderators.length) moderators.appendChild(el('li', { class: 'muted', text: owner ? 'none yet; make listeners moderators with the \u2606 beside their names' : 'none' }));
    const bans = view.bans || { tracks: [], people: [] };
    const tracks = clear($('room-banned-tracks'));
    bans.tracks.forEach(function (track) {
      tracks.appendChild(el('li', null, trackLink(track), button('unban', 'let this song play here again', function () {
        act('DELETE', '/rooms/' + state.slug + '/bans/tracks/' + track.id);
      })));
    });
    if (!bans.tracks.length) tracks.appendChild(el('li', { class: 'muted', text: 'none' }));
    const people = clear($('room-banned-people'));
    bans.people.forEach(function (item) {
      people.appendChild(el('li', null, personLink(item.id, item.name), button('unban', 'let them back in', function () {
        act('DELETE', '/rooms/' + state.slug + '/bans/people/' + item.id);
      })));
    });
    if (!bans.people.length) people.appendChild(el('li', { class: 'muted', text: 'none' }));
  }

  function saveSettings (event) {
    event.preventDefault();
    const you = state.view.you || {};
    const body = { name: $('room-settings-name').value, description: $('room-settings-description').value };
    if (you.role === 'owner' || you.role === 'admin') {
      body.permissions = { add: $('room-rule-add').value, skip: $('room-rule-skip').value, remove: $('room-rule-remove').value };
      body.autoplay = $('room-autoplay').checked;
    }
    const status = $('room-settings-status');
    status.textContent = 'Saving\u2026';
    api('/rooms/' + state.slug, { method: 'PATCH', body }).then(function () {
      delete $('room-settings').dataset.dirty;
      status.textContent = 'Saved.';
      scheduleRefresh();
    }).catch(function (error) { status.textContent = error.message; });
  }

  // A room's history

  function history (slug) {
    $('history').hidden = false;
    $('history-back').href = '/rooms/' + slug;
    return Promise.all([api('/rooms/' + slug), api('/rooms/' + slug + '/plays?limit=100')]).then(function (results) {
      const view = results[0];
      document.title = 'History | ' + view.name + ' | ' + state.siteName;
      $('brand-name').textContent = view.name;
      $('history-room').textContent = view.name;
      const canAdd = view.you && view.you.canAdd;
      const list = clear($('history-list'));
      results[1].plays.forEach(function (play) {
        const who = play.auto ? el('em', { text: 'auto-DJ' }) : personLink(play.curatorId, play.curator);
        const note = play.skipped
          ? el('div', { class: 'skipped muted', text: 'skipped' + (play.skipped.by ? ' by ' + play.skipped.by : '') })
          : play.down ? el('div', { class: 'skipped muted', text: 'could not play' }) : null;
        list.appendChild(el('tr', { class: play.skipped || play.down ? 'muted-row' : '' },
          el('td', null, who),
          el('td', null, when(play.startedAt)),
          el('td', { text: play.track.artist || '' }),
          el('td', null, trackLink(play.track), note),
          el('td', null, canAdd
            ? button('\u266b queue again', 'add it to the queue', function () {
              queueIn(slug, { track: play.track.id }, $('history-status'));
            })
            : null)));
      });
      if (!results[1].plays.length) list.appendChild(el('tr', null, el('td', { colspan: '5', text: 'Nothing has played here yet.' })));
    });
  }

  // Listener pages

  function showPane (tabs, pane) {
    Array.prototype.forEach.call(tabs.querySelectorAll('a[data-pane]'), function (link) {
      const on = link.getAttribute('data-pane') === pane;
      link.parentNode.className = on ? 'active' : '';
      $(link.getAttribute('data-pane')).className = 'tab-pane' + (on ? ' active' : '');
    });
  }

  function person (id) {
    $('person').hidden = false;
    const params = new window.URLSearchParams(window.location.search);
    const lastfm = params.get('lastfm');
    if (lastfm === 'linked') flash('success', 'Last.fm is linked: songs you hear here will be scrobbled.');
    else if (lastfm) flash('error', lastfm === 'expired' ? 'That Last.fm link took too long; try again.' : 'Last.fm did not allow the link.');
    if (lastfm) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    const pane = { '#sets': 'person-sets', '#rooms': 'person-rooms', '#plays': 'person-plays' }[window.location.hash] || 'person-profile';
    showPane($('person-tabs'), pane);
    return Promise.all([api('/people/' + id), fillRoomPicker($('person-queue-room'))]).then(function (results) {
      renderPerson(results[0]);
    });
  }

  function renderPerson (who) {
    const status = $('person-status');
    const queue = function (body) {
      return button('\u266b queue \u00bb', 'add to the queue in the room chosen above', function () {
        queueIn($('person-queue-room').value, body, status);
      });
    };
    document.title = who.name + ' | ' + state.siteName;
    $('person-name').textContent = who.name;
    $('person-since').textContent = 'Listening since ' + new Date(who.since).toLocaleDateString() + ', ' + who.plays + (who.plays === 1 ? ' play' : ' plays') + '.';
    $('person-rename').hidden = !who.you;
    const linked = who.lastfm && who.lastfm.linked;
    $('lastfm-connect').hidden = !(who.you && who.lastfm && !linked);
    $('lastfm-disconnect').hidden = !(who.you && linked);
    const badge = clear($('person-lastfm'));
    if (linked) badge.appendChild(el('a', { href: 'https://www.last.fm/user/' + encodeURIComponent(linked.name), target: '_blank', rel: 'noopener noreferrer', text: 'last.fm/' + linked.name }));
    $('person-queue-room').parentNode.hidden = !state.user;

    const top = clear($('person-top'));
    who.top.forEach(function (item) {
      top.appendChild(el('li', null, trackLink(item.track), item.track.artist ? ' by ' + item.track.artist : '', ' ',
        el('strong', { text: String(item.plays) }), item.plays === 1 ? ' time ' : ' times ', state.user ? queue({ track: item.track.id }) : null));
    });
    if (!who.top.length) top.appendChild(el('li', { class: 'muted', text: 'Nothing yet.' }));

    $('set-new').hidden = !who.you;
    const sets = clear($('person-set-list'));
    who.sets.forEach(function (item) {
      sets.appendChild(el('tr', null,
        el('td', null, el('a', { href: '/sets/' + item.id, text: item.name })),
        el('td', { text: String(item.size) }),
        el('td', null, state.user ? queue({ set: item.id }) : null)));
    });
    if (!who.sets.length) sets.appendChild(el('tr', null, el('td', { colspan: '3', text: who.you ? 'Save songs from a room, or add a set here.' : 'No sets yet.' })));

    const rooms = clear($('person-room-list'));
    who.rooms.forEach(function (item) {
      rooms.appendChild(el('li', null, el('a', { href: '/rooms/' + item.slug, text: item.name }), ' (' + item.role + ')'));
    });
    if (!who.rooms.length) rooms.appendChild(el('li', { class: 'muted', text: 'Runs no rooms.' }));

    const plays = clear($('person-play-list'));
    who.recent.forEach(function (play) {
      plays.appendChild(el('tr', null,
        el('td', null, when(play.at)),
        el('td', { text: play.track.artist || '' }),
        el('td', null, trackLink(play.track)),
        el('td', null, el('a', { href: '/rooms/' + play.room, text: play.roomName })),
        el('td', null, state.user ? queue({ track: play.track.id }) : null)));
    });
    if (!who.recent.length) plays.appendChild(el('tr', null, el('td', { colspan: '5', text: 'Nothing played yet.' })));
  }

  // Sets

  function set (id) {
    $('set').hidden = false;
    return Promise.all([api('/sets/' + id), fillRoomPicker($('set-queue-room'))]).then(function (results) {
      state.set = results[0];
      renderSet();
    });
  }

  function renderSet () {
    const current = state.set;
    document.title = current.name + ' | ' + state.siteName;
    $('set-name').textContent = current.name;
    $('set-owner').textContent = current.owner.name;
    $('set-owner').href = '/people/' + current.owner.id;
    $('set-description').textContent = current.description || '';
    $('set-owner-controls').hidden = !current.mine;
    $('set-queue').parentNode.hidden = !state.user || !current.tracks.length;
    const list = clear($('set-tracks'));
    current.tracks.forEach(function (track) {
      list.appendChild(el('tr', null,
        el('td', { text: track.artist || '' }),
        el('td', null, trackLink(track)),
        el('td', { text: hhmmss(track.duration) }),
        el('td', null,
          state.user
            ? button('\u266b queue \u00bb', 'add it to the queue', function () {
              queueIn($('set-queue-room').value, { track: track.id }, $('set-status'));
            })
            : null,
          current.mine
            ? button('remove', 'take it out of this set', function () {
              setAction('DELETE', '/sets/' + current.id + '/tracks/' + track.id);
            })
            : null)));
    });
    if (!current.tracks.length) list.appendChild(el('tr', null, el('td', { colspan: '4', text: current.mine ? 'Add songs above, or save them from a room.' : 'This set is empty.' })));
  }

  function setAction (method, path, body) {
    const status = $('set-status');
    return api(path, { method, body }).then(function (updated) {
      state.set = updated;
      status.textContent = '';
      renderSet();
    }).catch(function (error) { status.textContent = error.message; });
  }

  // Playback in the page

  function stopPlayer () {
    if (state.yt && state.yt.destroy) state.yt.destroy();
    if (state.audio) state.audio.pause();
    state.yt = null;
    state.audio = null;
    state.widget = null;
    state.kind = null;
    state.loaded = null;
    clear($('player'));
  }

  function showStill (track) {
    stopPlayer();
    state.kind = 'still';
    if (track && track.thumbnail) $('player').appendChild(el('img', { src: track.thumbnail, alt: '' }));
  }

  function volume () {
    return state.muted ? 0 : state.volume;
  }

  function applyVolume () {
    $('volume-icon').className = 'icon-white ' + (state.muted || !state.volume ? 'icon-volume-off' : 'icon-volume-up');
    if (state.yt && state.yt.setVolume) state.yt.setVolume(volume());
    if (state.audio) state.audio.volume = volume() / 100;
    if (state.widget) state.widget.setVolume(volume());
    try {
      window.localStorage.setItem('soundtrack.volume', JSON.stringify({ volume: state.volume, muted: state.muted }));
    } catch (_) { /* private mode */ }
  }

  function syncPlayer () {
    const current = state.view && state.view.current;
    const note = $('player-note');
    note.textContent = '';
    if (!current) return showStill(null);
    if (!state.listening) {
      if (state.loaded !== 'still:' + current.id) {
        showStill(current.track);
        state.loaded = 'still:' + current.id;
      }
      note.textContent = 'Press listen to hear it with everyone else.';
      return;
    }
    if (state.loaded === current.id) return;
    const source = current.track.source;
    if (source.type === 'youtube') return playYouTube(current, source.id);
    if (source.type === 'direct') return playAudio(current, source.uri);
    if (source.type === 'soundcloud') return playSoundCloud(current, source.uri);
    showStill(current.track);
    state.loaded = current.id;
    note.textContent = 'This one plays in Discord voice; open the link to hear it here.';
  }

  function playYouTube (current, videoId) {
    const start = position();
    if (state.kind === 'youtube' && state.yt && state.yt.loadVideoById) {
      state.yt.loadVideoById({ videoId, startSeconds: start });
      state.loaded = current.id;
      return;
    }
    stopPlayer();
    state.kind = 'youtube';
    state.loaded = current.id;
    const mount = el('div');
    $('player').appendChild(mount);
    const ready = window.YT && window.YT.Player
      ? Promise.resolve()
      : new Promise(function (resolve) {
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function () {
          if (previous) previous();
          resolve();
        };
        loadScript('https://www.youtube.com/iframe_api');
      });
    ready.then(function () {
      if (state.loaded !== current.id) return;
      state.yt = new window.YT.Player(mount, {
        videoId,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: function (event) {
            event.target.setVolume(volume());
            event.target.seekTo(position(), true);
            event.target.playVideo();
          }
        }
      });
    });
  }

  function playAudio (current, url) {
    stopPlayer();
    state.kind = 'audio';
    state.loaded = current.id;
    if (current.track.thumbnail) $('player').appendChild(el('img', { src: current.track.thumbnail, alt: '' }));
    const audio = new window.Audio(url);
    audio.preload = 'auto';
    audio.volume = volume() / 100;
    audio.addEventListener('loadedmetadata', function () {
      audio.currentTime = position();
      audio.play().catch(function () { $('player-note').textContent = 'Press listen again to start the audio.'; });
    });
    state.audio = audio;
  }

  function playSoundCloud (current, uri) {
    stopPlayer();
    state.kind = 'soundcloud';
    state.loaded = current.id;
    const frame = el('iframe', {
      allow: 'autoplay',
      title: 'SoundCloud player',
      src: 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(uri) + '&auto_play=true&visual=true&show_comments=false'
    });
    $('player').appendChild(frame);
    loadScript('https://w.soundcloud.com/player/api.js').then(function () {
      if (state.loaded !== current.id || !window.SC) return;
      const widget = window.SC.Widget(frame);
      state.widget = widget;
      widget.bind(window.SC.Widget.Events.READY, function () {
        widget.setVolume(volume());
        widget.seekTo(position() * 1000);
        widget.play();
      });
    });
  }

  function tick () {
    if (!state.view || $('room').hidden) return;
    const current = state.view.current;
    const bar = $('track-bar');
    if (!current) {
      bar.style.width = '0%';
      $('time').textContent = '00:00';
      return;
    }
    const duration = current.track.duration || 1;
    const at = Math.min(position(), duration);
    bar.style.width = (100 * at / duration).toFixed(2) + '%';
    $('time').textContent = hhmmss(at) + '/' + hhmmss(current.track.duration);
  }

  // Controls

  function bind () {
    $('nav-toggle').addEventListener('click', function () {
      const menu = $('nav-collapse');
      const open = !/\bin\b/.test(menu.className);
      menu.className = 'nav-collapse collapse' + (open ? ' in' : '');
      menu.style.height = open ? 'auto' : '';
    });

    $('listen').addEventListener('click', function (event) {
      event.preventDefault();
      state.listening = !state.listening;
      state.loaded = null;
      if (!state.listening) stopPlayer();
      renderRoom();
      syncPlayer();
    });
    $('skip').addEventListener('click', function (event) {
      event.preventDefault();
      act('POST', '/rooms/' + state.slug + '/skip');
    });
    $('volume-toggle').addEventListener('click', function (event) {
      event.preventDefault();
      state.muted = !state.muted;
      applyVolume();
    });
    $('volume').addEventListener('input', function (event) {
      state.volume = Number(event.target.value) || 0;
      state.muted = false;
      applyVolume();
    });

    $('search-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const input = $('search-query');
      const status = $('add-status');
      if (!input.value.trim()) return;
      status.textContent = 'Looking it up\u2026';
      api('/rooms/' + state.slug + '/queue', { method: 'POST', body: { song: input.value } }).then(function (entry) {
        status.textContent = 'Added ' + entry.track.title + '.';
        input.value = '';
        scheduleRefresh();
      }).catch(function (error) { status.textContent = error.message; });
    });

    $('chat-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const input = $('chat-input');
      const text = input.value;
      if (!text.trim()) return;
      input.value = '';
      api('/rooms/' + state.slug + '/chat', { method: 'POST', body: { text } }).catch(function (error) {
        input.value = text;
        $('add-status').textContent = error.message;
      });
    });

    $('save-form').addEventListener('submit', saveCurrent);
    $('ban-current').addEventListener('click', function (event) {
      event.preventDefault();
      const current = state.view && state.view.current;
      if (current && window.confirm('Ban \u201c' + current.track.title + '\u201d from this room? It stops now.')) {
        act('POST', '/rooms/' + state.slug + '/bans', { track: current.track.id });
      }
    });
    $('room-settings-open').addEventListener('click', function (event) {
      event.preventDefault();
      const form = $('room-settings');
      form.hidden = !form.hidden;
      delete form.dataset.dirty;
      if (!form.hidden) renderSettings();
    });
    $('room-settings-close').addEventListener('click', function (event) {
      event.preventDefault();
      $('room-settings').hidden = true;
    });
    $('room-settings').addEventListener('input', function () { $('room-settings').dataset.dirty = '1'; });
    $('room-settings').addEventListener('change', function () { $('room-settings').dataset.dirty = '1'; });
    $('room-settings').addEventListener('submit', saveSettings);

    $('person-tabs').addEventListener('click', function (event) {
      const link = event.target.closest('a[data-pane]');
      if (!link) return;
      event.preventDefault();
      showPane($('person-tabs'), link.getAttribute('data-pane'));
      window.history.replaceState(null, '', window.location.pathname + link.getAttribute('href'));
    });
    $('person-rename').addEventListener('click', function (event) {
      event.preventDefault();
      rename().then(function (user) {
        if (user) $('person-name').textContent = user.name;
      }).catch(function (error) { flash('error', error.message); });
    });
    $('lastfm-disconnect').addEventListener('click', function (event) {
      event.preventDefault();
      api('/lastfm', { method: 'DELETE' }).then(function () { window.location.reload(); })
        .catch(function (error) { flash('error', error.message); });
    });
    $('set-new').addEventListener('click', function (event) {
      event.preventDefault();
      $('set-creation-form').hidden = !$('set-creation-form').hidden;
    });
    $('set-creation-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const form = event.target;
      api('/sets', { method: 'POST', body: { name: form.elements.name.value, description: form.elements.description.value } }).then(function (created) {
        window.location.href = '/sets/' + created.id;
      }).catch(function (error) { $('person-status').textContent = error.message; });
    });

    $('set-queue').addEventListener('click', function (event) {
      event.preventDefault();
      if (state.set) queueIn($('set-queue-room').value, { set: state.set.id }, $('set-status'));
    });
    $('set-add-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const input = $('set-add-query');
      if (!input.value.trim() || !state.set) return;
      $('set-status').textContent = 'Looking it up\u2026';
      setAction('POST', '/sets/' + state.set.id + '/tracks', { song: input.value }).then(function () {
        if (!$('set-status').textContent) input.value = '';
      });
    });
    $('set-edit').addEventListener('click', function (event) {
      event.preventDefault();
      const form = $('set-edit-form');
      form.hidden = !form.hidden;
      $('set-edit-name').value = state.set.name;
      $('set-edit-description').value = state.set.description || '';
    });
    $('set-edit-form').addEventListener('submit', function (event) {
      event.preventDefault();
      setAction('PATCH', '/sets/' + state.set.id, { name: $('set-edit-name').value, description: $('set-edit-description').value }).then(function () {
        $('set-edit-form').hidden = true;
      });
    });
    $('set-delete').addEventListener('click', function (event) {
      event.preventDefault();
      if (!window.confirm('Delete \u201c' + state.set.name + '\u201d?')) return;
      api('/sets/' + state.set.id, { method: 'DELETE' }).then(function () {
        window.location.href = '/people/' + state.user.person + '#sets';
      }).catch(function (error) { $('set-status').textContent = error.message; });
    });

    $('get-started').addEventListener('click', signIn);

    $('create-room').addEventListener('click', function (event) {
      event.preventDefault();
      $('room-creation-form').hidden = !$('room-creation-form').hidden;
    });
    $('room-creation-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const form = event.target;
      api('/rooms', { method: 'POST', body: { name: form.elements.name.value, description: form.elements.description.value } }).then(function (created) {
        window.location.href = '/rooms/' + created.slug;
      }).catch(function (error) { $('room-status').textContent = error.message; });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    state.siteName = $('brand-name').textContent;
    try {
      const saved = JSON.parse(window.localStorage.getItem('soundtrack.volume') || 'null');
      if (saved) {
        state.volume = Math.max(0, Math.min(100, Number(saved.volume) || 0));
        state.muted = !!saved.muted;
      }
    } catch (_) { /* private mode */ }
    $('volume').value = String(state.volume);
    applyVolume();
    bind();
    window.setInterval(tick, 500);
    api('/session').then(function (session) {
      state.user = session.user;
      state.passport = session.passport;
      state.lastfm = session.lastfm;
    }).catch(function () {}).then(function () {
      renderSession();
      route();
    });
  });
}

module.exports = {
  id: 'soundtrack-app',
  client: clientScript('/scripts/soundtrack.js', soundtrackClient, __filename)
};
