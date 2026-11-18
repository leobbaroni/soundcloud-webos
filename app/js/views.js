// UI building blocks (cards, rows, track lists, headers) and the screens built from them.
(function () {
  "use strict";
  var SC = window.SC, api = SC.api, nav = SC.nav, el = SC.el;
  var V = SC.views = {};
  var ROW_MAX = 20;

  function go(name, params) { SC.router.open(name, params); }

  // ---------- small parts ----------
  function button(label, iconName, act, cls) {
    var b = el("div", "btn" + (cls ? " " + cls : ""));
    if (iconName) b.appendChild(SC.icon(iconName));
    if (label) b.appendChild(el("span", "btn-label", label));
    nav.bind(b, act);
    return b;
  }
  V.button = button;

  function message(text, retry) {
    var box = el("div", "message vis");
    box.appendChild(el("p", "message-text", text));
    if (retry) {
      var b = button("Try again", "refresh", retry);
      box.appendChild(b);
    }
    return box;
  }
  V.message = message;

  function spinner(text) {
    var box = el("div", "loading vis");
    box.appendChild(el("div", "spin"));
    if (text) box.appendChild(el("span", "loading-text", text));
    return box;
  }
  V.spinner = spinner;

  function errText(e) {
    if (!e) return "Something went wrong.";
    if (e.status === 0) return "Can't reach SoundCloud. Check the TV's internet connection.";
    if (e.status === 404) return "Not found on SoundCloud.";
    return "SoundCloud returned an error (" + (e.message || "unknown") + ").";
  }
  V.errText = errText;

  function trackSub(t) {
    return t.user && t.user.username ? t.user.username : "";
  }

  // ---------- cards ----------
  // ctx: {tracks: [...], index} so OK on a track plays the whole row from that track.
  function card(item, ctx) {
    var c = el("div", "card focusable");
    var isUser = item.kind === "user";
    if (isUser) c.className += " card-user";
    var art = el("div", "card-art");
    art.appendChild(SC.img(SC.art(isUser ? item.avatar : item.artwork, "t300x300"), "card-img"));
    if (item.kind === "track") {
      var play = el("div", "card-play");
      play.appendChild(SC.icon("play"));
      art.appendChild(play);
      if (item.preview) art.appendChild(el("span", "badge", "Preview"));
    } else if (item.kind === "playlist") {
      art.appendChild(el("span", "badge", item.system ? "Station" : item.isAlbum ? "Album" : SC.plural(item.trackCount || 0, "track", "tracks")));
    }
    c.appendChild(art);
    c.appendChild(el("div", "card-title", isUser ? item.username : item.title));
    var sub = "";
    if (item.kind === "track") sub = trackSub(item);
    else if (item.kind === "playlist") sub = item.system ? (item.subtitle || "SoundCloud") : (item.user.username || "");
    else if (isUser) sub = item.followers ? SC.fmtCount(item.followers) + " followers" : "Artist";
    c.appendChild(el("div", "card-sub", sub));
    nav.bind(c, function () {
      if (item.kind === "track") SC.player.playList(ctx.tracks, ctx.index);
      else if (item.kind === "playlist") go("playlist", { playlist: item });
      else if (isUser) go("artist", { user: item });
    });
    c._item = item;
    return c;
  }

  // A titled, horizontally scrolling row of cards.
  function row(title, items, opts) {
    opts = opts || {};
    var r = el("section", "row vis");
    r.setAttribute("data-mem", "");
    var head = el("div", "row-head");
    head.appendChild(el("h2", "row-title", title));
    if (opts.subtitle) head.appendChild(el("span", "row-subtitle", opts.subtitle));
    r.appendChild(head);
    var vp = el("div", "row-viewport");
    var track = el("div", "row-track");
    track.setAttribute("data-scroll", "x");
    var list = items.slice(0, opts.max || ROW_MAX);
    var tracks = list.filter(function (x) { return x.kind === "track"; });
    list.forEach(function (it) {
      track.appendChild(card(it, { tracks: tracks, index: tracks.indexOf(it) }));
    });
    vp.appendChild(track);
    r.appendChild(vp);
    if (opts.users) r.className += " row-users";
    return r;
  }
  V.row = row;

  // A placeholder that is replaced by a row once its data arrives (keeps row order stable).
  function slot(parent) {
    var s = el("div", "slot");
    parent.appendChild(s);
    return {
      fill: function (node) { if (s.parentNode) s.parentNode.replaceChild(node, s); },
      drop: function () { if (s.parentNode) s.parentNode.removeChild(s); }
    };
  }

  // ---------- vertical track list (playlist, likes, queue) ----------
  function trackRow(t, n, onOk, opts) {
    opts = opts || {};
    var r = el("div", "trow focusable vis");
    if (t.tc && !t.playable) r.className += " unavailable";
    r.appendChild(el("span", "trow-n", n !== null ? String(n) : ""));
    r.appendChild(SC.img(SC.art(t.artwork, "t300x300"), "trow-img"));
    var mid = el("div", "trow-mid");
    mid.appendChild(el("div", "trow-title", t.title || "Loading…"));
    var sub = trackSub(t);
    if (t.tc && !t.playable) sub = (sub ? sub + " · " : "") + "Not available on TV";
    else if (t.preview) sub = (sub ? sub + " · " : "") + "Preview only";
    mid.appendChild(el("div", "trow-sub", sub));
    r.appendChild(mid);
    if (opts.nowPlaying) {
      var eq = el("span", "trow-eq");
      eq.appendChild(el("i")); eq.appendChild(el("i")); eq.appendChild(el("i"));
      r.appendChild(eq);
    }
    r.appendChild(el("span", "trow-dur", t.duration ? SC.fmtTime(t.duration / 1000) : ""));
    nav.bind(r, onOk);
    r._track = t;
    return r;
  }
  V.trackRow = trackRow;

  // A list that hydrates stub tracks and appends 40 rows at a time as focus nears the end.
  function trackList(all, opts) {
    opts = opts || {};
    var box = el("div", "tlist");
    var rendered = 0, busy = false, PAGE = 40;
    function playFrom(i) { SC.player.playList(all, i); }
    function renderMore() {
      if (busy || rendered >= all.length) return Promise.resolve();
      busy = true;
      var end = Math.min(all.length, rendered + PAGE);
      var stubIds = [];
      for (var i = rendered; i < end; i++) if (all[i] && !all[i].tc) stubIds.push(all[i].id);
      var p = stubIds.length ? api.tracks(stubIds).then(function (full) {
        var byId = {};
        full.forEach(function (f) { if (f) byId[f.id] = f; });
        for (var j = rendered; j < end; j++) {
          if (all[j] && !all[j].tc) all[j] = byId[all[j].id] || { kind: "track", id: all[j].id, title: "Unavailable track", tc: [], playable: false, user: { username: "" } };
        }
      }) : Promise.resolve();
      return p.then(function () {
        for (var k = rendered; k < end; k++) {
          (function (idx) { box.appendChild(trackRow(all[idx], idx + 1, function () { playFrom(idx); })); })(k);
        }
        rendered = end;
        busy = false;
      }, function (e) { busy = false; SC.log("track page failed", e.message); });
    }
    function onFocus(f) {
      if (!SC.inDoc(box)) { SC.off("nav:focus", onFocus); return; }
      if (f.parentNode === box) {
        var idx = Array.prototype.indexOf.call(box.children, f);
        if (idx >= rendered - 8) renderMore();
      }
    }
    SC.on("nav:focus", onFocus);
    box._ready = renderMore();
    box._all = all;
    return box;
  }
  V.trackList = trackList;

  // ---------- page scaffolding ----------
  function page(cls) {
    var screen = el("div", "screen " + (cls || ""));
    var scroller = el("div", "scroller");
    scroller.setAttribute("data-scroll", "y");
    var body = el("div", "page");
    scroller.appendChild(body);
    screen.appendChild(scroller);
    return { el: screen, scroller: scroller, body: body };
  }
  V.page = page;

  // Header used by playlist / artist / profile screens.
  function header(opts) {
    var h = el("header", "hero vis");
    h.setAttribute("data-top", "");
    var art = el("div", "hero-art" + (opts.round ? " round" : ""));
    art.appendChild(SC.img(SC.art(opts.art, "t500x500"), "hero-img", true));
    h.appendChild(art);
    var info = el("div", "hero-info");
    if (opts.eyebrow) info.appendChild(el("div", "eyebrow", opts.eyebrow));
    info.appendChild(el("h1", "hero-title", opts.title));
    if (opts.byline) {
      var by = el("div", "hero-by");
      if (opts.onBy) { by.className += " link focusable"; nav.bind(by, opts.onBy); }
      by.textContent = SC.text(opts.byline);
      info.appendChild(by);
    }
    if (opts.meta) info.appendChild(el("div", "hero-meta", opts.meta));
    var actions = el("div", "hero-actions");
    (opts.actions || []).forEach(function (a, i) {
      var b = button(a.label, a.icon, a.act, i === 0 ? "primary" : "");
      if (i === 0) b.setAttribute("data-autofocus", "");
      actions.appendChild(b);
    });
    info.appendChild(actions);
    h.appendChild(info);
    h._actions = actions;
    return h;
  }
  V.header = header;

  function sectionTitle(text) { return el("h2", "section-title", text); }

  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  // =====================================================================
  // Screens. Each returns {el, focusEl?, onShow?, destroy?}.
  // =====================================================================
  var screens = SC.screens = {};

  // ---------- Home ----------
  screens.home = function () {
    var p = page("home");
    var top = el("div", "page-head vis");
    top.setAttribute("data-top", "");
    top.appendChild(el("h1", "page-title", greeting()));
    var profile = SC.store.get("profile", null);
    top.appendChild(el("p", "page-lede", profile ? "Picked for you, " + (profile.name || profile.username) + "." : "Fresh tracks, stations and playlists from SoundCloud."));
    p.body.appendChild(top);
    var rows = el("div", "rows");
    p.body.appendChild(rows);
    var status = spinner("Loading music…");
    rows.appendChild(status);

    function build() {
      SC.clear(rows);
      rows.appendChild(status);
      var recent = SC.store.get("recent", []);
      var jobs = [], counts = {};
      function add(name, promise, render) {
        var s = slot(rows);
        var j = promise.then(function (data) {
          var node = data && render(data);
          counts[name] = node ? (data.length || (data.items && data.items.length) || 1) : 0;
          if (node) s.fill(node); else s.drop();
          return !!node;
        }, function (e) { counts[name] = "error:" + e.message; s.drop(); return false; });
        jobs.push(j);
      }
      if (recent.length) add("recent", Promise.resolve(recent), function (d) { return row("Recently played", d); });
      add("trending", api.trending("all-music", 20), function (d) { return d.length ? row("Trending on SoundCloud", d) : null; });
      if (recent.length) {
        add("related", api.related(recent[0].id, 20), function (d) {
          return d.length ? row("More like “" + recent[0].title + "”", d) : null;
        });
      }
      if (profile) {
        add("likes", api.userLikes(profile.id, 30), function (pg) {
          var t = pg.items.filter(function (x) { return x.kind === "track" && x.playable; });
          return t.length ? row("From your likes", t) : null;
        });
      }
      var mixed = api.mixedSelections().catch(function () { return []; });
      var s2 = slot(rows);
      jobs.push(mixed.then(function (sels) {
        var frag = document.createDocumentFragment();
        sels.slice(0, 6).forEach(function (sel) {
          frag.appendChild(row(sel.title, sel.items));
        });
        counts.selections = sels.length;
        if (sels.length) { s2.fill(frag.childNodes.length > 1 ? wrap(frag) : frag.firstChild); return true; }
        // Fallback when mixed-selections is unavailable: a few genre searches.
        s2.drop();
        return Promise.all(["lofi", "deep house", "hip hop", "ambient"].map(function (g) {
          return api.searchPlaylists(g, 12).then(function (l) { return { g: g, l: l }; }, function () { return { g: g, l: [] }; });
        })).then(function (res) {
          res.forEach(function (x) { if (x.l.length) rows.appendChild(row(x.g.charAt(0).toUpperCase() + x.g.slice(1), x.l)); });
          counts.genres = res.length;
          return true;
        });
      }));
      return Promise.all(jobs).then(function (ok) {
        if (status.parentNode) status.parentNode.removeChild(status);
        if (!rows.querySelector(".row")) rows.appendChild(message("Couldn't load music right now.", build));
        SC.log("home ready", counts);
        SC.lastHome = counts;
        SC.emit("home:ready", counts);
        if (!nav.current() || !SC.inDoc(nav.current())) nav.focusFirst(p.el);
        return ok;
      });
    }
    function wrap(frag) { var d = el("div", "rowgroup"); d.appendChild(frag); return d; }
    build();
    return { el: p.el, scroller: p.scroller, refresh: build };
  };

  // ---------- Search ----------
  screens.search = function (params) {
    var p = page("search");
    var bar = el("div", "search-bar vis");
    bar.setAttribute("data-top", "");
    var field = el("label", "search-field");
    field.appendChild(SC.icon("search"));
    var input = document.createElement("input");
    input.type = "text";
    input.className = "search-input focusable";
    input.setAttribute("data-autofocus", "");
    input.placeholder = "Search tracks, artists, playlists";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    field.appendChild(input);
    bar.appendChild(field);
    p.body.appendChild(bar);
    var results = el("div", "results");
    p.body.appendChild(results);
    var reqId = 0, lastQ = "", debounce = 0;

    function showRecent() {
      SC.clear(results);
      var recent = SC.store.get("searches", []);
      if (!recent.length) {
        results.appendChild(el("p", "hint vis", "Press OK to type. Results appear as you type."));
        return;
      }
      var sec = el("section", "row vis chips-row");
      sec.setAttribute("data-mem", "");
      sec.appendChild(el("h2", "row-title", "Recent searches"));
      var chips = el("div", "chips");
      recent.forEach(function (q) {
        var c = el("div", "chip", q);
        nav.bind(c, function () { input.value = q; run(q); });
        chips.appendChild(c);
      });
      sec.appendChild(chips);
      results.appendChild(sec);
    }

    function run(q) {
      q = (q || "").trim();
      if (q === lastQ && results.querySelector(".row")) return Promise.resolve();
      lastQ = q;
      if (!q) { showRecent(); return Promise.resolve(); }
      var my = ++reqId;
      SC.clear(results);
      results.appendChild(spinner("Searching…"));
      var parts = [
        api.searchTracks(q, 24).catch(function () { return []; }),
        api.searchUsers(q, 12).catch(function () { return []; }),
        api.searchPlaylists(q, 12).catch(function () { return []; }),
        api.searchAlbums(q, 12).catch(function () { return []; })
      ];
      return Promise.all(parts).then(function (r) {
        if (my !== reqId) return;
        SC.clear(results);
        var n = 0;
        if (r[0].length) { results.appendChild(row("Tracks", r[0])); n += r[0].length; }
        if (r[1].length) { results.appendChild(row("Artists", r[1], { users: true })); n += r[1].length; }
        if (r[2].length) { results.appendChild(row("Playlists", r[2])); n += r[2].length; }
        if (r[3].length) { results.appendChild(row("Albums", r[3])); n += r[3].length; }
        if (!n) results.appendChild(message("No results for “" + q + "”."));
        else saveQuery(q);
        SC.log("search", JSON.stringify(q), "tracks=" + r[0].length, "users=" + r[1].length, "playlists=" + r[2].length, "albums=" + r[3].length);
        SC.emit("search:done", { q: q, tracks: r[0].length, users: r[1].length, playlists: r[2].length, albums: r[3].length });
      });
    }
    function saveQuery(q) {
      var s = SC.store.get("searches", []).filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
      s.unshift(q);
      if (s.length > 10) s.length = 10;
      SC.store.set("searches", s);
    }
    input.addEventListener("input", function () {
      clearTimeout(debounce);
      var v = input.value;
      debounce = setTimeout(function () { if (v.trim().length >= 2) run(v); }, 800);
    });
    input._submit = function () { clearTimeout(debounce); run(input.value); };
    if (params && params.q) { input.value = params.q; run(params.q); } else showRecent();
    return { el: p.el, scroller: p.scroller, run: function (q) { input.value = q; return run(q); }, input: input };
  };

  // ---------- Playlist / album / station ----------
  screens.playlist = function (params) {
    var pl = params.playlist;
    var p = page("playlist");
    var content = el("div");
    p.body.appendChild(content);
    content.appendChild(spinner("Opening…"));
    var list = null;
    function load() {
      SC.clear(content);
      content.appendChild(spinner("Opening…"));
      return api.playlist(pl).then(function (full) {
        SC.clear(content);
        var tracks = full.tracks;
        var kind = full.system ? "Station" : full.isAlbum ? "Album" : "Playlist";
        var mins = Math.round((full.duration || tracks.reduce(function (a, t) { return a + (t.duration || 0); }, 0)) / 60000);
        var meta = SC.plural(full.trackCount || tracks.length, "track", "tracks") + (mins ? " · " + (mins >= 60 ? Math.floor(mins / 60) + " h " + (mins % 60) + " min" : mins + " min") : "") + (full.releaseYear && full.isAlbum ? " · " + full.releaseYear : "");
        content.appendChild(header({
          art: full.artwork || pl.artwork, eyebrow: kind, title: full.title || pl.title,
          byline: full.system ? (full.subtitle || "SoundCloud") : (full.user.username ? "by " + full.user.username : ""),
          onBy: full.system || !full.user.id ? null : function () { go("artist", { user: full.user }); },
          meta: meta,
          actions: [
            { label: "Play", icon: "play", act: function () { SC.player.playList(list._all, 0); } },
            { label: "Shuffle", icon: "shuffle", act: function () { SC.player.playList(list._all, 0, { shuffle: true }); } }
          ]
        }));
        if (!tracks.length) { content.appendChild(message("This playlist is empty.")); return; }
        list = trackList(tracks);
        content.appendChild(list);
        return list._ready.then(function () {
          SC.log("playlist open", String(full.id), "tracks=" + tracks.length, "rendered=" + list.children.length);
          SC.emit("playlist:ready", { id: full.id, count: tracks.length, list: list });
          nav.focusFirst(p.el);
        });
      }, function (e) {
        SC.clear(content);
        content.appendChild(message(errText(e), load));
        nav.focusFirst(p.el);
      });
    }
    load();
    return { el: p.el, scroller: p.scroller };
  };

  // ---------- Artist ----------
  screens.artist = function (params) {
    var u = params.user;
    var p = page("artist");
    var content = el("div");
    p.body.appendChild(content);
    function load() {
      SC.clear(content);
      content.appendChild(spinner());
      var top = [], latest = [];
      return Promise.all([
        api.user(u.id).catch(function () { return u; }),
        api.userTopTracks(u.id, 20).catch(function () { return { items: [] }; }),
        api.userTracks(u.id, 30).catch(function () { return { items: [] }; }),
        api.userAlbums(u.id, 20).catch(function () { return { items: [] }; }),
        api.userPlaylists(u.id, 20).catch(function () { return { items: [] }; })
      ]).then(function (r) {
        var user = r[0];
        top = api.onlyPlayable(r[1].items); latest = api.onlyPlayable(r[2].items);
        SC.clear(content);
        var meta = [];
        if (user.followers) meta.push(SC.fmtCount(user.followers) + " followers");
        if (user.trackCount) meta.push(SC.plural(user.trackCount, "track", "tracks"));
        if (user.city || user.country) meta.push([user.city, user.country].filter(Boolean).join(", "));
        var playable = top.length ? top : latest;
        content.appendChild(header({
          art: user.avatar || u.avatar, round: true, eyebrow: "Artist", title: user.username || u.username,
          byline: user.fullName && user.fullName !== user.username ? user.fullName : "",
          meta: meta.join(" · "),
          actions: playable.length ? [
            { label: "Play", icon: "play", act: function () { SC.player.playList(playable, 0); } },
            { label: "Shuffle", icon: "shuffle", act: function () { SC.player.playList(playable, 0, { shuffle: true }); } }
          ] : []
        }));
        if (top.length) content.appendChild(row("Popular", top));
        if (latest.length) content.appendChild(row("Latest tracks", latest));
        if (r[3].items.length) content.appendChild(row("Albums", r[3].items));
        if (r[4].items.length) content.appendChild(row("Playlists", r[4].items));
        if (!top.length && !latest.length && !r[3].items.length && !r[4].items.length) content.appendChild(message("Nothing playable here yet."));
        nav.focusFirst(p.el);
      }, function (e) { SC.clear(content); content.appendChild(message(errText(e), load)); nav.focusFirst(p.el); });
    }
    load();
    return { el: p.el, scroller: p.scroller };
  };

  // ---------- Your profile ----------
  screens.profile = function () {
    var p = page("profile");
    var content = el("div");
    p.body.appendChild(content);

    function setup(errMsg) {
      SC.clear(content);
      var box = el("div", "setup vis");
      box.setAttribute("data-top", "");
      box.appendChild(el("div", "eyebrow", "Your profile"));
      box.appendChild(el("h1", "page-title", "Bring your library"));
      box.appendChild(el("p", "page-lede", "Type your SoundCloud username — the part after soundcloud.com/ — to see your public likes, playlists and tracks. No password needed."));
      var field = el("label", "search-field");
      field.appendChild(SC.icon("user"));
      var input = document.createElement("input");
      input.type = "text"; input.className = "search-input focusable";
      input.placeholder = "username";
      input.setAttribute("data-autofocus", "");
      input.setAttribute("autocomplete", "off"); input.setAttribute("spellcheck", "false");
      field.appendChild(input);
      box.appendChild(field);
      var err = el("p", "form-error", errMsg || "");
      box.appendChild(err);
      var go2 = button("Connect", "check", function () { connect(input.value); }, "primary");
      box.appendChild(go2);
      input._submit = function () { connect(input.value); };
      content.appendChild(box);
      nav.focusFirst(p.el);
    }

    function connect(name) {
      name = (name || "").trim().replace(/^https?:\/\/(m\.)?soundcloud\.com\//, "").replace(/\/.*$/, "");
      if (!name) return;
      SC.clear(content);
      content.appendChild(spinner("Looking up " + name + "…"));
      api.resolve("https://soundcloud.com/" + encodeURIComponent(name)).then(function (u) {
        if (!u || u.kind !== "user") throw { status: 404 };
        var prof = { id: u.id, username: u.permalink || name, name: u.username, avatar: u.avatar };
        SC.store.set("profile", prof);
        SC.log("profile set", prof.username, String(prof.id));
        SC.emit("profile:changed");
        show(prof);
      }).catch(function (e) {
        setup(e && e.status === 404 ? "No SoundCloud user called “" + name + "”." : errText(e));
      });
    }

    function show(prof) {
      SC.clear(content);
      content.appendChild(spinner());
      Promise.all([
        api.user(prof.id).catch(function () { return { username: prof.name, avatar: prof.avatar }; }),
        api.userLikes(prof.id, 60).catch(function () { return { items: [] }; }),
        api.userPlaylists(prof.id, 20).catch(function () { return { items: [] }; }),
        api.userTracks(prof.id, 30).catch(function () { return { items: [] }; })
      ]).then(function (r) {
        SC.clear(content);
        var user = r[0];
        var liked = r[1].items.filter(function (x) { return x.kind === "track" && x.playable; });
        var likedSets = r[1].items.filter(function (x) { return x.kind === "playlist"; });
        var meta = [];
        if (user.followers) meta.push(SC.fmtCount(user.followers) + " followers");
        if (user.likesCount) meta.push(SC.fmtCount(user.likesCount) + " likes");
        var acts = [];
        if (liked.length) {
          acts.push({ label: "Play likes", icon: "play", act: function () { SC.player.playList(liked, 0); } });
          acts.push({ label: "Shuffle", icon: "shuffle", act: function () { SC.player.playList(liked, 0, { shuffle: true }); } });
        }
        acts.push({ label: "Change user", icon: "user", act: function () { setup(); } });
        content.appendChild(header({ art: user.avatar || prof.avatar, round: true, eyebrow: "Your profile", title: user.username || prof.name, byline: "soundcloud.com/" + prof.username, meta: meta.join(" · "), actions: acts }));
        if (liked.length) {
          content.appendChild(sectionTitle("Liked tracks"));
          var list = el("div", "tlist");
          liked.forEach(function (t, i) { list.appendChild(trackRow(t, i + 1, function () { SC.player.playList(liked, i); })); });
          content.appendChild(list);
        }
        if (r[2].items.length) content.appendChild(row("Your playlists", r[2].items));
        if (likedSets.length) content.appendChild(row("Liked playlists", likedSets));
        var own = api.onlyPlayable(r[3].items);
        if (own.length) content.appendChild(row("Your tracks", own));
        if (!liked.length && !r[2].items.length && !likedSets.length && !own.length) content.appendChild(message("Nothing public on this profile yet. Likes and playlists must be public to show here."));
        SC.emit("profile:ready", { likes: liked.length, playlists: r[2].items.length });
        nav.focusFirst(p.el);
      });
    }

    var prof = SC.store.get("profile", null);
    if (prof) show(prof); else setup();
    return { el: p.el, scroller: p.scroller };
  };

  // ---------- Queue ----------
  screens.queue = function () {
    var p = page("queue");
    var head = el("div", "page-head vis");
    head.setAttribute("data-top", "");
    head.appendChild(el("h1", "page-title", "Queue"));
    var lede = el("p", "page-lede", "");
    head.appendChild(lede);
    var actions = el("div", "hero-actions");
    actions.appendChild(button("Clear upcoming", "clear", function () { SC.player.clearQueue(); SC.toast("Queue cleared"); }));
    head.appendChild(actions);
    p.body.appendChild(head);
    var list = el("div", "tlist");
    p.body.appendChild(list);

    function render(focusCurrent) {
      var q = SC.player.queue();
      var focusedIdx = -1, f = nav.current();
      if (f && f.parentNode === list) focusedIdx = f._qpos;
      SC.clear(list);
      if (!q.items.length) {
        lede.textContent = "Nothing queued. Play something from Home or Search.";
        return;
      }
      var auto = SC.player.state.autoplay ? " Autoplay adds similar tracks when it ends." : "";
      lede.textContent = SC.plural(q.items.length, "track", "tracks") + "." + auto;
      var from = Math.max(0, q.pos - 3), to = Math.min(q.items.length, from + 120);
      var curRow = null, target = null;
      for (var i = from; i < to; i++) {
        (function (k) {
          var t = q.items[k];
          var r = trackRow(t, k === q.pos ? null : k + 1, function () { SC.player.jumpTo(k); }, { nowPlaying: k === q.pos });
          r._qpos = k;
          if (k === q.pos) { r.className += " current"; curRow = r; }
          if (k < q.pos) r.className += " played";
          if (k === focusedIdx) target = r;
          list.appendChild(r);
        })(i);
      }
      var active = SC.router.top() === api_self;
      if (active && (focusCurrent === true || focusedIdx >= 0 || !nav.current()) && (target || curRow)) nav.focus(focusCurrent === true ? (curRow || target) : (target || curRow));
    }
    var api_self = { el: p.el, scroller: p.scroller, onShow: function () { render(true); } };
    function onQ() { if (SC.inDoc(p.el)) render(false); }
    SC.on("player:queue", onQ);
    api_self.destroy = function () { SC.off("player:queue", onQ); };
    render(false);
    return api_self;
  };

  // ---------- Settings ----------
  screens.settings = function () {
    var p = page("settings");
    var head = el("div", "page-head vis");
    head.setAttribute("data-top", "");
    head.appendChild(el("h1", "page-title", "Settings"));
    p.body.appendChild(head);
    var list = el("div", "settings-list");
    p.body.appendChild(list);
    function item(label, desc, valueFn, act) {
      var r = el("div", "setting focusable vis");
      var txt = el("div", "setting-text");
      txt.appendChild(el("div", "setting-label", label));
      if (desc) txt.appendChild(el("div", "setting-desc", desc));
      r.appendChild(txt);
      var val = el("div", "setting-value");
      r.appendChild(val);
      function upd() { val.textContent = valueFn ? valueFn() : ""; }
      upd();
      nav.bind(r, function () { act(); upd(); });
      list.appendChild(r);
      return r;
    }
    item("Autoplay", "When the queue ends, keep playing similar tracks.", function () { return SC.player.state.autoplay ? "On" : "Off"; },
      function () { SC.player.setAutoplay(!SC.player.state.autoplay); });
    item("Your profile", "The SoundCloud username used for your likes and playlists.", function () {
      var pr = SC.store.get("profile", null); return pr ? pr.username : "Not set";
    }, function () { SC.router.root("profile"); });
    item("Forget your profile", "Remove the saved username from this TV.", null, function () {
      SC.store.set("profile", null); SC.emit("profile:changed"); SC.toast("Profile removed");
    });
    item("Clear recently played", "", null, function () { SC.store.set("recent", null); SC.toast("Recently played cleared"); });
    item("Clear search history", "", null, function () { SC.store.set("searches", null); SC.toast("Search history cleared"); });
    item("Reconnect to SoundCloud", "Fetch a fresh access key if music stops loading.", null, function () {
      api.refreshClientId().then(function () { SC.toast("Reconnected"); }, function (e) { SC.toast(errText(e)); });
    });
    if ((window.SC_CONFIG || {}).selftestButton) {
      item("Run self-test (debug build)", "Drives the app and plays short clips; results go to the debug log.", function () {
        return SC.selftestLoaded ? "Started" : "";
      }, function () { SC.runSelftest(); });
    }
    var about = el("p", "about vis", "Version " + (SC.version || "") + ". An unofficial player for SoundCloud's public catalogue. Volume is controlled by the TV.");
    p.body.appendChild(about);
    return { el: p.el, scroller: p.scroller };
  };
})();
