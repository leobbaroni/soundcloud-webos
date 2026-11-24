// SoundCloud api-v2 client (public endpoints, client_id only) and data normalisation.
// XHR only: from the packaged app's file:// origin webOS allows cross-origin XHR without CORS.
(function () {
  "use strict";
  var SC = window.SC;
  var API = "https://api-v2.soundcloud.com";
  var cid = SC.store.get("cid", "");
  var cidPromise = null;

  function xhr(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var r = new XMLHttpRequest();
      r.open("GET", url, true);
      r.timeout = timeoutMs || 15000;
      r.onload = function () {
        if (r.status >= 200 && r.status < 300) resolve(r.responseText);
        else { var e = new Error("HTTP " + r.status); e.status = r.status; reject(e); }
      };
      r.onerror = function () { var e = new Error("network error"); e.status = 0; reject(e); };
      r.ontimeout = function () { var e = new Error("timeout"); e.status = 0; reject(e); };
      r.send();
    });
  }

  // The public web client id is embedded in m.soundcloud.com's HTML.
  function fetchClientId() {
    if (cidPromise) return cidPromise;
    cidPromise = xhr("https://m.soundcloud.com/", 20000).then(function (html) {
      var m = /"clientId":"([A-Za-z0-9]{32})"/.exec(html) || /client_id[=:]"?([A-Za-z0-9]{32})/.exec(html);
      cidPromise = null;
      if (!m) throw new Error("client id not found");
      cid = m[1];
      SC.store.set("cid", cid);
      SC.log("clientId extracted", cid.slice(0, 4) + "..." + cid.slice(-4));
      return cid;
    }, function (e) { cidPromise = null; throw e; });
    return cidPromise;
  }
  function ensureCid() { return cid ? Promise.resolve(cid) : fetchClientId(); }

  function withCid(url) {
    url = url.replace(/([?&])client_id=[^&]*&?/, "$1").replace(/[?&]$/, "");
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "client_id=" + cid;
  }

  // GET a JSON path (or a full next_href). A 401/403 refreshes the client id once.
  function get(pathOrUrl, params) {
    var url = pathOrUrl.indexOf("http") === 0 ? pathOrUrl : API + pathOrUrl;
    if (params) {
      var q = [];
      for (var k in params) if (params.hasOwnProperty(k) && params[k] !== undefined && params[k] !== null) {
        q.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      }
      if (q.length) url += (url.indexOf("?") >= 0 ? "&" : "?") + q.join("&");
    }
    return ensureCid().then(function () {
      return xhr(withCid(url)).catch(function (e) {
        if (e.status === 401 || e.status === 403) {
          SC.log("client id rejected (" + e.status + "), refreshing");
          cid = "";
          return fetchClientId().then(function () { return xhr(withCid(url)); });
        }
        throw e;
      });
    }).then(function (text) { return JSON.parse(text); });
  }

  // ---- normalisation: keep only what the UI and player need (memory on a 1 GB TV) ----
  function normUser(u) {
    if (!u) return { id: 0, username: "", avatar: "" };
    return {
      kind: "user", id: u.id, username: u.username || "", avatar: u.avatar_url || "",
      permalink: u.permalink || "", followers: u.followers_count, trackCount: u.track_count,
      playlistCount: u.playlist_count, likesCount: u.likes_count, playlistLikesCount: u.playlist_likes_count,
      city: u.city || "",
      country: u.country_code || "", fullName: u.full_name || ""
    };
  }
  // A transcoding the app will play: unencrypted HLS AAC (aac_160k / aac_96k), via MSE.
  // Encrypted (DRM) and abr_sq (a master playlist) are never used.
  function playableTranscodings(t) {
    var list = (t.media && t.media.transcodings) || [];
    return list.filter(function (x) {
      return x.format && x.format.protocol === "hls" && (x.preset === "aac_160k" || x.preset === "aac_96k");
    });
  }
  function normTrack(t) {
    if (!t) return null;
    if (!t.title && !t.media) return { kind: "track", id: t.id, stub: true };
    var tr = playableTranscodings(t);
    var full = tr.filter(function (x) { return !x.snipped; });
    var use = full.length ? full : tr;
    return {
      kind: "track", id: t.id, title: t.title || "", duration: t.full_duration || t.duration || 0,
      artwork: t.artwork_url || (t.user && t.user.avatar_url) || "",
      user: { id: t.user ? t.user.id : t.user_id, username: t.user ? t.user.username : "", avatar: t.user ? t.user.avatar_url : "" },
      auth: t.track_authorization || "",
      tc: use.map(function (x) { return { url: x.url, preset: x.preset, protocol: x.format.protocol, mime: x.format.mime_type }; }),
      preview: !full.length && tr.length > 0,
      playable: tr.length > 0,
      genre: t.genre || "", plays: t.playback_count, permalink: t.permalink_url || ""
    };
  }
  function normPlaylist(p) {
    if (!p) return null;
    var tracks = (p.tracks || []).map(normTrack);
    var firstArt = "";
    for (var i = 0; i < tracks.length && !firstArt; i++) if (tracks[i].artwork) firstArt = tracks[i].artwork;
    var system = p.kind === "system-playlist";
    return {
      kind: "playlist", system: system, id: system ? (p.urn || p.id) : p.id,
      title: p.title || p.short_title || "", subtitle: p.short_description || "",
      artwork: p.artwork_url || p.calculated_artwork_url || firstArt || (p.user && p.user.avatar_url) || "",
      user: normUser(p.user), isAlbum: !!p.is_album, setType: p.set_type || "",
      trackCount: p.track_count || tracks.length, duration: p.duration || 0,
      tracks: tracks, releaseYear: (p.release_date || p.display_date || "").slice(0, 4)
    };
  }
  function norm(item) {
    if (!item) return null;
    if (item.kind === "track") return normTrack(item);
    if (item.kind === "playlist" || item.kind === "system-playlist") return normPlaylist(item);
    if (item.kind === "user") return normUser(item);
    if (item.track) return normTrack(item.track);       // likes / chart entries
    if (item.playlist) return normPlaylist(item.playlist);
    return null;
  }
  // When an entry dates from, in ms (0 when unknown): a like's own date for likes, the last
  // change (else creation) for playlists, the upload for tracks.
  function dateOf(item) {
    var s = item.track || item.playlist ? item.created_at :
      item.kind === "playlist" ? item.last_modified || item.created_at : item.created_at;
    var t = s ? Date.parse(s) : 0;
    return t > 0 ? t : 0;
  }
  function collection(res) {
    return ((res && res.collection) || []).map(function (item) {
      var x = norm(item);
      if (x) x.at = dateOf(item);
      return x;
    }).filter(function (x) { return !!x; });
  }
  // Newest first, undated last, ties in their old order (V8 5.3's sort is not stable). In place,
  // so screens holding the array keep seeing it. Returns true when the order changed.
  function sortNewest(list) {
    var d = list.map(function (x, i) { return { x: x, i: i, at: x.at || 0 }; }), moved = false;
    d.sort(function (a, b) {
      if (a.at !== b.at) return !a.at ? 1 : !b.at ? -1 : b.at - a.at;
      return a.i - b.i;
    });
    for (var i = 0; i < d.length; i++) {
      if (list[i] !== d[i].x) moved = true;
      list[i] = d[i].x;
    }
    return moved;
  }
  function onlyPlayable(list) {
    return list.filter(function (t) { return t.kind !== "track" || t.stub || t.playable; });
  }
  function page(res) {
    return { items: collection(res), next: (res && res.next_href) || null };
  }

  // ---- whole collections: follow next_href to the end ----
  // The server returns fewer items than the limit asked (it leaves out removed and private
  // ones), so the only end marker is a missing next_href. sources: [[path, params], ...], read
  // one after the other into one list (a profile's playlists, then its albums). Items are
  // de-duplicated by kind and id, kept newest first, and capped (opts.cap, at most CAP).
  // opts.lite drops a playlist's track list (its screen fetches the playlist again).
  // pg.more() reads the next page and resolves with the number of items it added;
  // pg.all(onPage) reads to the end. pg.items is one array, changed in place.
  var CAP = 5000, PAGE_LIMIT = 200, MAX_PAGES = 100;
  function pager(sources, opts) {
    opts = opts || {};
    var cap = Math.min(opts.cap || CAP, CAP), src = sources.slice(), next = null, seen = {}, busy = null;
    var pg = { items: [], pages: 0, done: !src.length, resorted: false };
    pg.more = function () {
      if (pg.done) return Promise.resolve(0);
      if (busy) return busy;
      var url = next || src[0][0], params = next ? null : src[0][1];
      busy = get(url, params).then(function (res) {
        busy = null;
        pg.pages++;
        var nx = (res && res.next_href) || null, added = 0;
        if (nx && nx === next) nx = null;   // a cursor that does not move would loop forever
        next = nx;
        if (!next) src.shift();
        collection(res).forEach(function (x) {
          var k = x.kind + ":" + x.id;
          if (seen[k] || pg.items.length >= cap) return;
          seen[k] = 1;
          if (opts.lite && x.kind === "playlist") x.tracks = [];
          pg.items.push(x);
          added++;
        });
        if (added && sortNewest(pg.items)) pg.resorted = true;   // the server's order was not newest first
        if (!src.length || pg.items.length >= cap || pg.pages >= MAX_PAGES) pg.done = true;
        return added;
      }, function (e) { busy = null; throw e; });
      return busy;
    };
    pg.all = function (onPage) {
      return pg.more().then(function () {
        if (onPage) onPage(pg.items.length);
        return pg.done ? pg.items : pg.all(onPage);
      });
    };
    return pg;
  }
  function userPager(id, paths, opts) {
    return pager(paths.map(function (p) { return ["/users/" + id + "/" + p, { limit: PAGE_LIMIT }]; }), opts);
  }

  // A linked profile's data, kept in memory for the session (never in localStorage) so the
  // Profile screen comes back instantly. account(id, maxAge) starts over when the kept data
  // is older than maxAge ms.
  var accounts = {};
  function account(id, maxAge) {
    var a = accounts[id];
    if (a && !(maxAge && Date.now() - a.ts > maxAge)) return a;
    var info = null;
    a = accounts[id] = {
      id: id, ts: Date.now(),
      // /users/{id}: the counts shown in row titles (asked again after a failure)
      info: function () {
        if (!info) info = get("/users/" + id).then(normUser, function (e) { info = null; throw e; });
        return info;
      },
      likes: api.likesPager(id),
      sets: api.setsPager(id),
      likedSets: userPager(id, ["playlist_likes"], { lite: true }),
      tracks: userPager(id, ["tracks"])
    };
    return a;
  }

  var api = SC.api = {
    ensureCid: ensureCid,
    refreshClientId: function () { cid = ""; return fetchClientId(); },
    get: get,
    norm: norm,
    normTrack: normTrack,
    onlyPlayable: onlyPlayable,

    searchTracks: function (q, limit) {
      return get("/search/tracks", { q: q, limit: limit || 30 }).then(function (r) { return onlyPlayable(collection(r)); });
    },
    searchPlaylists: function (q, limit) {
      return get("/search/playlists_without_albums", { q: q, limit: limit || 12 }).catch(function () {
        return get("/search/playlists", { q: q, limit: limit || 12 });
      }).then(collection);
    },
    searchAlbums: function (q, limit) { return get("/search/albums", { q: q, limit: limit || 12 }).then(collection); },
    searchUsers: function (q, limit) { return get("/search/users", { q: q, limit: limit || 12 }).then(collection); },

    resolve: function (url) { return get("/resolve", { url: url }).then(norm); },
    user: function (id) { return get("/users/" + id).then(normUser); },
    userTracks: function (id, limit) { return get("/users/" + id + "/tracks", { limit: limit || 30 }).then(page); },
    userTopTracks: function (id, limit) { return get("/users/" + id + "/toptracks", { limit: limit || 20 }).then(page); },
    // Liked tracks, newest like first (one page; likesPager reads them all).
    userLikes: function (id, limit) { return get("/users/" + id + "/track_likes", { limit: limit || 40 }).then(page); },
    userPlaylists: function (id, limit) { return get("/users/" + id + "/playlists_without_albums", { limit: limit || 20 }).then(page); },
    userAlbums: function (id, limit) { return get("/users/" + id + "/albums", { limit: limit || 20 }).then(page); },
    pager: pager,
    likesPager: function (id) { return userPager(id, ["track_likes"]); },
    // Created playlists and albums as one list, newest change first; read whole before it is shown.
    setsPager: function (id) { return userPager(id, ["playlists_without_albums", "albums"], { lite: true, cap: 500 }); },
    account: account,
    forgetAccount: function (id) { delete accounts[id]; },

    playlist: function (pl) {
      if (pl.system) return get("/system-playlists/" + encodeURIComponent(pl.id)).then(normPlaylist);
      return get("/playlists/" + pl.id).then(normPlaylist);
    },
    // Full track objects for stubs, 50 ids per request, in the order asked.
    tracks: function (ids) {
      var chunks = [];
      for (var i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
      return Promise.all(chunks.map(function (c) { return get("/tracks", { ids: c.join(",") }); })).then(function (rs) {
        var byId = {};
        rs.forEach(function (arr) { (arr || []).forEach(function (t) { byId[t.id] = normTrack(t); }); });
        return ids.map(function (id) { return byId[id] || null; });
      });
    },
    related: function (id, limit) {
      return get("/tracks/" + id + "/related", { limit: limit || 20 }).then(function (r) { return onlyPlayable(collection(r)); });
    },
    trending: function (genre, limit) {
      return get("/charts", { kind: "trending", genre: "soundcloud:genres:" + (genre || "all-music"), limit: limit || 20 })
        .then(function (r) { return onlyPlayable(collection(r)); });
    },
    mixedSelections: function () {
      return get("/mixed-selections", { limit: 10 }).then(function (r) {
        return (r.collection || []).map(function (sel) {
          var items = ((sel.items && sel.items.collection) || []).map(norm).filter(function (x) { return !!x; });
          return { title: sel.title || "", urn: sel.urn || "", items: items };
        }).filter(function (s) { return s.items.length > 0; });
      });
    },
    // Resolve a transcoding to a short-lived stream URL.
    streamUrl: function (track, tc) {
      return get(tc.url, { track_authorization: track.auth }).then(function (r) {
        if (!r || !r.url) throw new Error("no stream url");
        return r.url;
      });
    }
  };
  api.API = API;
})();
