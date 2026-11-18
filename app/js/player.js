// Playback: one <audio> fed through MSE (see hls.js), a queue with shuffle/repeat, and
// station-style autoplay of related tracks when the queue runs out.
// Safety rules (this TV's native media pipeline has crashed on SoundCloud's HLS):
//  - a remote stream URL is never set as audio.src; only our MediaSource blob: URL is;
//  - one transcoding attempt per track (aac_160k, else aac_96k), no fallbacks;
//  - at least 1.5 s between two track loads; next/prev presses within 0.5 s coalesce;
//  - a watchdog stops and reports; failures skip at most twice in a row, then playback stops.
(function () {
  "use strict";
  var SC = window.SC, api = SC.api;

  var audio = document.createElement("audio");
  audio.preload = "auto";
  document.body.appendChild(audio);
  var engine = new SC.Hls(audio);
  var supported = SC.Hls.supported();
  SC.log("MSE AAC/fMP4 " + (supported ? "supported" : "NOT supported"));

  var MIN_GAP = 1500;      // ms between two track loads
  var SETTLE = 500;       // ms a load request waits for a newer one (debounces next/prev)
  var START_LIMIT = 20000; // ms to reach "playing" after a load
  var STALL_LIMIT = 30000; // ms of continuous "waiting" before giving up
  var MAX_FAILS = 3;       // consecutive failed tracks before playback stops

  var items = [];        // tracks (full or stubs), in the order they were queued
  var order = [];        // play order: indexes into items
  var pos = -1;          // position in order
  var current = null;    // the track shown as playing
  var token = 0;         // bumps on every load request so stale async work is dropped
  var session = null;    // {tok, track, preset}
  var loading = false;
  var failStreak = 0;
  var lastOpen = 0;      // time of the last track load
  var opens = 0;         // number of track loads (debug)
  var gateTimer = 0, startTimer = 0, stallTimer = 0;
  var settings = SC.store.get("settings", {});
  var state = {
    shuffle: !!settings.shuffle,
    repeat: settings.repeat || "off",       // off | all | one
    autoplay: settings.autoplay !== false
  };
  var forcePreset = "";  // debug only

  function saveSettings() {
    settings = SC.store.get("settings", {});
    settings.shuffle = state.shuffle; settings.repeat = state.repeat; settings.autoplay = state.autoplay;
    SC.store.set("settings", settings);
  }

  // The one transcoding we try: plain-HLS aac_160k, else aac_96k.
  function pickTc(t) {
    var list = t.tc || [], i;
    if (forcePreset) for (i = 0; i < list.length; i++) if (list[i].preset === forcePreset) return list[i];
    for (i = 0; i < list.length; i++) if (list[i].preset === "aac_160k") return list[i];
    for (i = 0; i < list.length; i++) if (list[i].preset === "aac_96k") return list[i];
    return null;
  }

  function emitState() {
    SC.emit("player:state", { playing: !audio.paused && !!current, loading: loading, track: current });
  }
  function setLoading(v) { loading = v; emitState(); }
  function clearTimers() { clearTimeout(gateTimer); clearTimeout(startTimer); clearTimeout(stallTimer); }

  // Fetch full objects for this stub and the next few stubs in play order.
  function hydrate(idx) {
    var t = items[idx];
    if (t && t.tc) return Promise.resolve(t);
    var ids = [], idxs = [];
    for (var p = pos; p < order.length && ids.length < 50; p++) {
      var j = order[p], s = items[j];
      if (s && !s.tc && ids.indexOf(s.id) < 0) { ids.push(s.id); idxs.push(j); }
    }
    if (!ids.length) { ids.push(t.id); idxs.push(idx); }
    return api.tracks(ids).then(function (full) {
      full.forEach(function (f, k) {
        if (f) items[idxs[k]] = f;
        else items[idxs[k]] = { kind: "track", id: ids[k], title: (items[idxs[k]] || {}).title || "Unavailable track", tc: [], playable: false, user: (items[idxs[k]] || {}).user || { username: "" } };
      });
      SC.emit("player:queue");
      return items[idx];
    });
  }

  function remember(t) {
    var recent = SC.store.get("recent", []);
    recent = recent.filter(function (r) { return r.id !== t.id; });
    recent.unshift({ kind: "track", id: t.id, title: t.title, artwork: t.artwork, duration: t.duration,
      user: { id: t.user.id, username: t.user.username } });
    if (recent.length > 30) recent.length = 30;
    SC.store.set("recent", recent);
  }

  function unsupported() {
    SC.log("playback refused: MSE AAC/fMP4 not supported");
    SC.emit("player:unsupported");
  }

  // Ask for orderPos p to play. The load itself waits until MIN_GAP after the previous one;
  // requests made meanwhile replace each other, so only the last one loads.
  function load(p) {
    if (p < 0 || p >= order.length) return;
    if (!supported) { unsupported(); return; }
    var tok = ++token;
    pos = p;
    clearTimers();
    if (engine.active()) audio.pause();   // silence the old track now; it is torn down at load time
    setLoading(true);
    SC.emit("player:queue");
    var idx = order[p];
    hydrate(idx).then(function (t) {
      if (tok !== token) return;
      var tc = t && t.playable ? pickTc(t) : null;
      if (!tc) {
        // Encrypted-only (DRM), blocked or no AAC: it can never play here; skip without loading.
        SC.log("skip unplayable", t ? t.id : "?");
        if (pos < order.length - 1) { load(pos + 1); return; }
        report(t, "isn't available on TV", false);
        return;
      }
      current = t;
      SC.emit("player:track", t);
      // Settle for SETTLE ms (so a burst of presses ends in one load) and keep MIN_GAP since the last load.
      var wait = Math.max(SETTLE, lastOpen + MIN_GAP - Date.now());
      gateTimer = setTimeout(function () { if (tok === token) start(t, tc, tok); }, wait);
    }).catch(function (e) {
      if (tok !== token) return;
      SC.log("hydrate failed", e.message);
      report(items[idx], "couldn't be loaded", true);
    });
  }

  function start(t, tc, tok) {
    session = { tok: tok, track: t, preset: tc.preset };
    lastOpen = Date.now();
    opens++;
    engine.close();
    startTimer = setTimeout(function () {
      if (tok === token && loading) report(t, "didn't start in " + START_LIMIT / 1000 + " s", true);
    }, START_LIMIT);
    api.streamUrl(t, tc).then(function (url) {
      if (tok !== token) return;
      SC.log("play", t.id, "preset=" + tc.preset, "engine=mse", "load#" + opens);
      return engine.open(url).then(function () {
        if (tok !== token) return;
        remember(t);
        var pr = audio.play();
        if (pr && pr.catch) pr.catch(function (e) {
          if (tok === token && e && e.name !== "AbortError") SC.log("play() rejected", e.name, e.message);
        });
      });
    }).catch(function (e) {
      if (tok !== token || (e && e.aborted)) return;
      SC.log("load failed", tc.preset, e && e.message);
      report(t, "couldn't be played", true);
    });
  }

  // Stop this track, tell the user, skip; after MAX_FAILS failures in a row, stop entirely.
  function report(t, why, counts) {
    clearTimers();
    engine.close();
    session = null;
    setLoading(false);
    if (counts) failStreak++;
    var name = t && t.title ? "“" + t.title + "”" : "This track";
    SC.log("track failed", t ? t.id : "?", why, "streak=" + failStreak);
    if (failStreak >= MAX_FAILS) {
      failStreak = 0;
      token++;
      SC.toast("Playback stopped: " + MAX_FAILS + " tracks in a row couldn't be played.", 5000);
      emitState();
      return;
    }
    SC.toast(name + " " + why + ". Skipping.");
    next(true);
  }

  engine.onFatal = function (e) {
    if (session && session.tok === token) report(session.track, "stopped (" + (e && e.message ? e.message : "stream error") + ")", true);
  };

  // ---- audio events ----
  audio.addEventListener("playing", function () {
    clearTimeout(startTimer); clearTimeout(stallTimer);
    if (session && session.tok === token) { failStreak = 0; loading = false; }
    emitState();
  });
  audio.addEventListener("pause", emitState);
  audio.addEventListener("waiting", function () {
    SC.emit("player:buffering", true);
    if (!session || loading) return;
    var tok = token, t = session.track;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(function () { if (tok === token) report(t, "stalled", true); }, STALL_LIMIT);
  });
  audio.addEventListener("canplay", function () { SC.emit("player:buffering", false); });
  audio.addEventListener("timeupdate", function () {
    if (session) SC.emit("player:time", { cur: audio.currentTime, dur: duration() });
  });
  audio.addEventListener("error", function () {
    if (!session || session.tok !== token || !engine.active()) return;
    var code = audio.error ? audio.error.code : 0;
    SC.log("media error code=" + code, "preset=" + session.preset, "at=" + (audio.currentTime || 0).toFixed(1));
    report(session.track, "couldn't be played (error " + code + ")", true);
  });
  audio.addEventListener("ended", function () {
    if (!session || !engine.active()) return;
    if (state.repeat === "one") { audio.currentTime = 0; audio.play(); return; }
    next(true);
  });

  function duration() {
    var d = audio.duration;
    if (!isFinite(d) || !d) d = current ? current.duration / 1000 : 0;
    return d;
  }

  // ---- autoplay: extend the queue with tracks related to the last one ----
  var extending = null;
  function extendWithRelated() {
    if (extending) return extending;
    var seed = current || items[order[order.length - 1]];
    if (!seed) return Promise.resolve(0);
    var have = {};
    items.forEach(function (t) { have[t.id] = 1; });
    SC.store.get("recent", []).slice(0, 15).forEach(function (t) { have[t.id] = 1; });
    extending = api.related(seed.id, 25).then(function (list) {
      extending = null;
      var add = list.filter(function (t) { return !have[t.id]; }).slice(0, 15);
      if (!add.length) add = list.slice(0, 10);
      appendItems(add);
      SC.log("autoplay: added " + add.length + " related to " + seed.id);
      return add.length;
    }, function (e) { extending = null; SC.log("related failed", e.message); return 0; });
    return extending;
  }
  function appendItems(list) {
    list.forEach(function (t) { items.push(t); order.push(items.length - 1); });
    SC.emit("player:queue");
  }

  function next(auto) {
    if (pos < order.length - 1) return load(pos + 1);
    if (state.repeat === "all" && order.length) return load(0);
    if (state.autoplay && current) {
      setLoading(true);
      return extendWithRelated().then(function (n) {
        if (n && pos < order.length - 1) load(pos + 1);
        else { setLoading(false); if (!auto) SC.toast("End of queue"); }
      });
    }
    if (!auto) SC.toast("End of queue");
    emitState();
  }
  function prev() {
    if (audio.currentTime > 3 || pos <= 0) { seek(0); return; }
    load(pos - 1);
  }
  function seek(sec) {
    if (!current) return;
    var d = duration();
    sec = Math.max(0, d ? Math.min(sec, d - 1) : sec);
    try { audio.currentTime = sec; } catch (e) { /* not seekable yet */ }
    SC.emit("player:time", { cur: sec, dur: d });
  }

  function buildOrder(startIdx) {
    order = [];
    for (var i = 0; i < items.length; i++) order.push(i);
    if (state.shuffle) {
      var rest = order.filter(function (i) { return i !== startIdx; });
      SC.shuffle(rest);
      order = [startIdx].concat(rest);
      return 0;
    }
    return startIdx;
  }

  var player = SC.player = {
    audio: audio,
    state: state,
    // Replace the queue and play tracks[start]. opts.shuffle forces shuffle on.
    playList: function (tracks, start, opts) {
      opts = opts || {};
      if (!supported) { unsupported(); return; }
      items = tracks.slice();
      if (opts.shuffle) { state.shuffle = true; saveSettings(); start = Math.floor(Math.random() * items.length); }
      failStreak = 0;
      var p = buildOrder(start || 0);
      SC.emit("player:queue");
      load(p);
    },
    enqueue: function (tracks) { appendItems(tracks); },
    playNext: function (t) {
      items.push(t);
      order.splice(pos + 1, 0, items.length - 1);
      SC.emit("player:queue");
    },
    jumpTo: function (orderPos) { failStreak = 0; load(orderPos); },
    next: function () { failStreak = 0; next(false); },
    prev: prev,
    supported: supported,
    play: function () {
      if (!current || !engine.active()) return;
      var pr = audio.play(); if (pr && pr.catch) pr.catch(function () { /* surfaced by error event */ });
    },
    pause: function () { audio.pause(); },
    toggle: function () { if (!current) return; if (audio.paused) player.play(); else audio.pause(); },
    stop: function () { audio.pause(); seek(0); },
    seek: seek,
    seekBy: function (d) { seek(audio.currentTime + d); },
    toggleShuffle: function () {
      state.shuffle = !state.shuffle; saveSettings();
      if (items.length) {
        var curIdx = order[pos];
        if (state.shuffle) { pos = buildOrder(curIdx); }
        else { order = items.map(function (_, i) { return i; }); pos = curIdx; }
        SC.emit("player:queue");
      }
      emitState();
      return state.shuffle;
    },
    cycleRepeat: function () {
      state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
      saveSettings(); emitState();
      return state.repeat;
    },
    setAutoplay: function (v) { state.autoplay = !!v; saveSettings(); },
    clearQueue: function () {
      // keep the playing track as the only item
      if (current) { items = [current]; order = [0]; pos = 0; }
      else { items = []; order = []; pos = -1; }
      SC.emit("player:queue");
    },
    queue: function () {
      return { items: order.map(function (i) { return items[i]; }), pos: pos };
    },
    current: function () { return current; },
    isPlaying: function () { return !!current && !audio.paused; },
    isLoading: function () { return loading; },
    time: function () { return { cur: audio.currentTime, dur: duration() }; },
    upNext: function () { return pos >= 0 && pos < order.length - 1 ? items[order[pos + 1]] : null; },
    debugInfo: function () {
      return { id: current && current.id, preset: session && session.preset, t: +audio.currentTime.toFixed(1),
        paused: audio.paused, pos: pos, len: order.length, ready: audio.readyState, buf: engine.bufferedSeconds(), loads: opens };
    },
    _forcePreset: function (p) { forcePreset = p || ""; }
  };
})();
