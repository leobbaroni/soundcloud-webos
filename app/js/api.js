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
      playlistCount: u.playlist_count, likesCount: u.likes_count, city: u.city || "",
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
  function collection(res) {
    return ((res && res.collection) || []).map(norm).filter(function (x) { return !!x; });
  }
  function onlyPlayable(list) {
    return list.filter(function (t) { return t.kind !== "track" || t.stub || t.playable; });
  }
  function page(res) {
    return { items: collection(res), next: (res && res.next_href) || null };
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
    userLikes: function (id, limit) { return get("/users/" + id + "/likes", { limit: limit || 40 }).then(page); },
    userPlaylists: function (id, limit) { return get("/users/" + id + "/playlists_without_albums", { limit: limit || 20 }).then(page); },
    userAlbums: function (id, limit) { return get("/users/" + id + "/albums", { limit: limit || 20 }).then(page); },
    more: function (nextHref) { return get(nextHref).then(page); },

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
