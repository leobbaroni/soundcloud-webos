// Debug-only self-test: drives the app on the TV and reports each step through the debug
// beacon. Loaded only when SC_CONFIG.selftest is true (debug packages); not shipped in release.
(function () {
  "use strict";
  var SC = window.SC, player = SC.player, nav = SC.nav, router = SC.router;
  function log() { SC.log.apply(null, ["ST"].concat(Array.prototype.slice.call(arguments))); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function once(ev, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { SC.off(ev, h); reject(new Error("timeout waiting for " + ev)); }, ms || 30000);
      function h(d) { clearTimeout(t); SC.off(ev, h); resolve(d); }
      SC.on(ev, h);
    });
  }
  function until(fn, ms, what) {
    var start = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        var v; try { v = fn(); } catch (e) { v = false; }
        if (v) return resolve(v);
        if (Date.now() - start > (ms || 30000)) return reject(new Error("timeout: " + what));
        setTimeout(tick, 250);
      })();
    });
  }
  function key(code) {
    var e = document.createEvent("Event");
    e.initEvent("keydown", true, true);
    Object.defineProperty(e, "keyCode", { value: code });
    document.dispatchEvent(e);
  }
  function desc(n) {
    if (!n) return "none";
    var t = (n.querySelector && (n.querySelector(".card-title, .trow-title, .btn-label, .rail-label, .setting-label")) || n);
    return n.className.split(" ")[0] + ":" + String(t.textContent || n.value || "").slice(0, 40);
  }
  function heap() { return window.performance && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + "MB" : "?"; }

  var homeCounts = null;
  SC.on("home:ready", function (c) { homeCounts = c; });

  var steps = [
    ["home", function () {
      return until(function () { return homeCounts || (homeCounts = SC.lastHome); }, 45000, "home:ready").then(function () {
        var rows = document.querySelectorAll(".home .row");
        log("home rows=" + rows.length, "cards=" + document.querySelectorAll(".home .card").length, homeCounts, "focus=" + desc(nav.current()));
        if (!rows.length) throw new Error("no home rows");
      });
    }],
    ["keys", function () {
      key(39); key(39); key(40); key(37);
      log("after R,R,D,L focus=" + desc(nav.current()));
      key(37); key(37); key(37);
      log("after 3xL focus=" + desc(nav.current()));
      key(39);
      log("after R focus=" + desc(nav.current()));
    }],
    ["search", function () {
      router.root("search");
      var scr = router.top();
      var p = once("search:done", 30000);
      scr.run("lofi");
      return p.then(function (d) {
        log("search lofi", d, "rows=" + document.querySelectorAll(".search .row").length);
        if (!d.tracks) throw new Error("no track results");
      });
    }],
    ["playlist", function () {
      var cards = document.querySelectorAll(".search .card");
      var target = null;
      for (var i = 0; i < cards.length; i++) if (cards[i]._item.kind === "playlist" && cards[i]._item.trackCount > 3) { target = cards[i]; break; }
      if (!target) throw new Error("no playlist card");
      nav.focus(target);
      log("open playlist", target._item.title, String(target._item.id));
      var p = once("playlist:ready", 30000);
      key(13);
      return p.then(function (d) {
        log("playlist ready count=" + d.count, "rows=" + d.list.children.length, "focus=" + desc(nav.current()));
      });
    }],
    ["play5s", function () {
      log("press OK on", desc(nav.current()));
      key(13);
      return until(function () { return player.audio.currentTime > 5.2; }, 45000, "currentTime>5").then(function () {
        log("PLAYBACK OK >5s", player.debugInfo(), "title=" + (player.current() || {}).title);
      });
    }],
    // Five consecutive track switches with the remote's next key; each must play past 2 s.
    ["switch5", function () {
      var n = 0;
      function one() {
        if (n >= 5) return;
        n++;
        var before = player.current().id, loads = player.debugInfo().loads, t0 = Date.now();
        key(176);
        return until(function () {
          var c = player.current(); return c && c.id !== before && player.debugInfo().loads > loads && player.audio.currentTime > 2;
        }, 30000, "switch " + n + " playing").then(function () {
          log("SWITCH " + n + " OK in " + ((Date.now() - t0) / 1000).toFixed(1) + "s", player.debugInfo());
          return one();
        });
      }
      return one();
    }],
    // Three next presses 200 ms apart must coalesce into a single load.
    ["rapid", function () {
      var loads = player.debugInfo().loads, startPos = player.queue().pos;
      key(176);
      return sleep(200).then(function () { key(176); return sleep(200); }).then(function () { key(176); }).then(function () {
        return until(function () { return player.debugInfo().loads > loads && player.audio.currentTime > 2; }, 30000, "rapid playing");
      }).then(function () {
        return sleep(2000);
      }).then(function () {
        var d = player.debugInfo();
        log("RAPID loads +" + (d.loads - loads) + " pos " + startPos + "->" + d.pos, d);
        if (d.loads - loads !== 1) throw new Error("expected exactly 1 load, got " + (d.loads - loads));
      });
    }],
    ["seekkeys", function () {
      var t0 = player.audio.currentTime;
      key(417);
      return sleep(1500).then(function () { log("FF: " + t0.toFixed(1) + " -> " + player.audio.currentTime.toFixed(1)); });
    }],
    ["aac96", function () {
      return SC.api.searchTracks("ambient piano", 20).then(function (list) {
        var t = list.filter(function (x) { return x.tc.some(function (c) { return c.preset === "aac_96k"; }); })[0];
        if (!t) { log("no aac_96k track found"); return; }
        player._forcePreset("aac_96k");
        var loads = player.debugInfo().loads;
        player.playList([t], 0);
        return until(function () { var d = player.debugInfo(); return d.loads > loads && d.id === t.id && d.preset === "aac_96k" && player.audio.currentTime > 3; }, 40000, "aac_96k play").then(function () {
          log("AAC96 OK", player.debugInfo());
        }).then(function () { player._forcePreset(""); }, function (e) { player._forcePreset(""); throw e; });
      });
    }],
    ["autoplay", function () {
      return SC.api.searchTracks("lofi beat", 20).then(function (list) {
        var t = list.filter(function (x) { return x.duration > 60000 && x.duration < 480000; })[0] || list[0];
        player.setAutoplay(true);
        var loads = player.debugInfo().loads;
        player.playList([t], 0);
        return until(function () { var d = player.debugInfo(); return d.loads > loads && d.id === t.id && player.audio.currentTime > 1; }, 40000, "seed playing").then(function () {
          var d = player.time().dur;
          loads = player.debugInfo().loads;
          log("seed playing, queue len=" + player.queue().items.length, "dur=" + d.toFixed(0), "seeking to end");
          player.seek(d - 4);
          return until(function () { var x = player.debugInfo(); return x.loads > loads && x.id !== t.id && !x.paused && player.audio.currentTime > 2; }, 60000, "autoplay next");
        }).then(function () {
          log("AUTOPLAY OK queue len=" + player.queue().items.length, player.debugInfo(), "title=" + player.current().title);
        });
      });
    }],
    // A track that ends by itself must start the next queue item, twice in a row. The tail is
    // buffered first (seek ~90 s from the end, wait for every segment), then a seek inside the
    // buffer to 6 s from the end lets it play out with no further help.
    ["natural-end", function () {
      var saved = { shuffle: player.state.shuffle, repeat: player.state.repeat };
      player.state.shuffle = false; player.state.repeat = "off";
      function restore() { player.state.shuffle = saved.shuffle; player.state.repeat = saved.repeat; }
      function bufEnd() { var b = player.audio.buffered; return b.length ? b.end(b.length - 1) : 0; }
      function state() {
        var a = player.audio;
        return { t: +a.currentTime.toFixed(2), dur: +(+a.duration).toFixed(2), bufEnd: +bufEnd().toFixed(2), ready: a.readyState,
          ended: a.ended, paused: a.paused, info: player.debugInfo() };
      }
      function pick() {
        return SC.api.searchPlaylists("lofi chill", 20).then(function (pls) {
          pls = pls.filter(function (p) { return !p.system && p.trackCount >= 3; });
          var i = 0;
          function tryOne() {
            if (i >= pls.length || i >= 6) throw new Error("no playlist with 3 normal-length tracks");
            var pl = pls[i++];
            return SC.api.playlist(pl).then(function (full) {
              var ids = full.tracks.slice(0, 40).map(function (t) { return t.id; });
              return SC.api.tracks(ids).then(function (ts) {
                var ok = ts.filter(function (t) { return t && t.playable && !t.preview && t.duration > 110000 && t.duration < 400000; });
                return ok.length >= 3 ? { pl: full, tracks: ok.slice(0, 3) } : tryOne();
              });
            }, tryOne);
          }
          return tryOne();
        });
      }
      function endOnce(n, cur, nxt) {
        var d = player.time().dur, loads = player.debugInfo().loads, t0;
        log("natural-end " + n + ": " + cur.id + " dur=" + d.toFixed(1) + ", buffering the tail");
        player.seek(Math.max(1, d - 90));
        return until(function () { return bufEnd() >= d - 1; }, 40000, "tail buffered").then(function () {
          return sleep(1500);
        }).then(function () {
          player.seek(d - 6);
          t0 = Date.now();
          log("natural-end " + n + ": seeked to " + (d - 6).toFixed(1), state());
          return until(function () {
            var x = player.debugInfo(); return x.id === nxt.id && x.loads > loads && !x.paused && player.audio.currentTime > 3;
          }, 20000, "next track playing past 3 s");
        }).then(function () {
          log("NATURAL-END " + n + " OK in " + ((Date.now() - t0) / 1000).toFixed(1) + "s", "next=" + nxt.id, player.debugInfo());
        }, function (e) {
          log("NATURAL-END " + n + " FAIL", e.message, state());
          throw e;
        });
      }
      return pick().then(function (r) {
        var list = r.tracks, loads = player.debugInfo().loads;
        log("natural-end playlist " + r.pl.id + " tracks " + list.map(function (t) { return t.id + "/" + Math.round(t.duration / 1000) + "s"; }).join(" "));
        player.playList(list, 0, { from: r.pl });
        return until(function () { var x = player.debugInfo(); return x.loads > loads && x.id === list[0].id && player.audio.currentTime > 1; }, 40000, "first track playing").then(function () {
          return endOnce(1, list[0], list[1]);
        }).then(function () {
          return until(function () { return player.audio.currentTime > 3.5; }, 20000, "second track settled");
        }).then(function () {
          return endOnce(2, list[1], list[2]);
        });
      }).then(restore, function (e) { restore(); throw e; });
    }],
    ["nowplaying", function () {
      router.open("now");
      log("now open top=" + router.topName(), "focus=" + desc(nav.current()));
      key(38); key(37);
      log("now after U,L focus=" + desc(nav.current()));
      key(461);
      log("after Back top=" + router.topName(), "depth=" + router.depth());
      router.open("queue");
      log("queue rows=" + document.querySelectorAll(".queue .trow").length, "focus=" + desc(nav.current()));
      key(461);
    }],
    ["profile-api", function () {
      return SC.api.resolve("https://soundcloud.com/lofi_girl").then(function (u) {
        return Promise.all([SC.api.userLikes(u.id, 20), SC.api.userPlaylists(u.id, 10)]).then(function (r) {
          log("PROFILE resolve ok id=" + u.id, "likes=" + r[0].items.length, "playlists=" + r[1].items.length);
        });
      });
    }],
    // Every like of the first linked profile (or the test account z.arc_), read through the
    // app's pager: about 3 requests per 400 likes, plus the account and its playlists. The
    // server leaves out tracks that were removed or made private, so a few may be missing
    // against likes_count; more than TOL missing, or any like out of date order, fails.
    ["profile-full", function () {
      var pr = SC.profiles.list()[0], id = pr ? pr.id : 999762904;
      var likes = SC.api.likesPager(id), sets = SC.api.setsPager(id);
      return Promise.all([SC.api.user(id), likes.all(), sets.all()]).then(function (r) {
        var u = r[0], items = likes.items, desc = true, seen = {}, dups = 0, undated = 0;
        for (var i = 0; i < items.length; i++) {
          if (seen[items[i].id]) dups++;
          seen[items[i].id] = 1;
          if (!items[i].at) undated++;
          else if (i > 0 && items[i - 1].at && items[i].at > items[i - 1].at) desc = false;
          else if (i > 0 && !items[i - 1].at) desc = false;   // undated ones must come last
        }
        var total = u.likesCount || 0, missing = total - items.length, tol = Math.max(3, Math.ceil(total * 0.1));
        var unplayable = items.filter(function (t) { return t.tc && !t.playable; }).length;
        var line = "likes=" + items.length + "/" + total + " playlists=" + sets.items.length + "/" + u.playlistCount +
          " desc=" + desc + " pages=" + likes.pages;
        var extra = "missing=" + missing + " (removed or private; tolerance " + tol + ") dups=" + dups + " undated=" + undated +
          " serverOrder=" + (likes.resorted ? "re-sorted" : "newest-first") +
          " unplayable=" + unplayable + " newest=" + (items[0] ? new Date(items[0].at).toISOString() : "-") +
          " oldest=" + (items.length ? new Date(items[items.length - 1].at).toISOString() : "-");
        if (!desc || dups || missing > tol) {
          log("PROFILE-FULL FAIL " + line, extra);
          throw new Error(!desc ? "likes out of date order" : dups ? dups + " duplicate likes" : missing + " likes missing");
        }
        log("PROFILE-FULL OK " + line, extra);
      });
    }],
    ["back-home", function () {
      router.root("home");
      key(461);
      log("back on home -> modal=" + !!document.querySelector(".modal"), "focus=" + desc(nav.current()));
      key(461);
      log("back again -> modal=" + !!document.querySelector(".modal"));
    }]
  ];

  // Optional launch parameters {"selftest": true, "until": "<step>"} stops after that step;
  // "only": "<step>,<step>" runs just those steps.
  var until_ = "", only = "";
  try {
    var lp = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || "{}") || {};
    until_ = lp.until || ""; only = lp.only ? "," + lp.only + "," : "";
  } catch (e) { until_ = ""; only = ""; }
  function run(i) {
    if (i > 0 && until_ && steps[i - 1][0] === until_) i = steps.length;
    while (only && i < steps.length && only.indexOf("," + steps[i][0] + ",") < 0) i++;
    if (i >= steps.length) {
      player.pause();
      log("SELFTEST DONE heap=" + heap());
      window.__done = true;
      return;
    }
    var s = steps[i];
    log("step " + s[0]);
    Promise.resolve().then(s[1]).then(function () { return sleep(500); }).then(function () { run(i + 1); }, function (e) {
      // Stop at the first failure: pause and report, never keep going.
      player.pause();
      log("STEP FAIL " + s[0], e && e.message ? e.message : String(e), player.debugInfo());
      log("SELFTEST ABORTED heap=" + heap());
      window.__done = true;
    });
  }
  log("selftest start heap=" + heap(), "mse=" + player.supported);
  router.root("home");
  setTimeout(function () { run(0); }, 500);
})();
