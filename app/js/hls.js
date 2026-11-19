// HLS-over-MSE for SoundCloud's fMP4 audio playlists (EXT-X-MAP init.mp4 + .m4s segments).
// The TV's native media pipeline must never be given these playlists (on this firmware it
// fails and has rebooted the TV), so a remote .m3u8 is never set as audio.src: the playlist
// and segments are fetched with XHR and appended to a fresh MediaSource for every track.
// VOD only, one rendition, AAC in fMP4. Buffer is capped (~60 s behind, ~120 s ahead).
(function () {
  "use strict";
  var SC = window.SC;
  var MIME = 'audio/mp4; codecs="mp4a.40.2"';
  var AHEAD = 120, BEHIND = 60;

  function supported() {
    try {
      return !!(window.MediaSource && MediaSource.isTypeSupported && MediaSource.isTypeSupported(MIME));
    } catch (e) { return false; }
  }

  function get(url, binary, timeoutMs) {
    var r = new XMLHttpRequest();
    var p = new Promise(function (resolve, reject) {
      r.open("GET", url, true);
      if (binary) r.responseType = "arraybuffer";
      r.timeout = timeoutMs || 20000;
      r.onload = function () {
        if (r.status >= 200 && r.status < 300) resolve(binary ? r.response : r.responseText);
        else { var e = new Error("HTTP " + r.status); e.status = r.status; reject(e); }
      };
      r.onerror = function () { reject(new Error("network error")); };
      r.ontimeout = function () { reject(new Error("timeout")); };
      r.onabort = function () { var e = new Error("aborted"); e.aborted = true; reject(e); };
      r.send();
    });
    p.xhr = r;
    return p;
  }

  function resolveUrl(base, rel) {
    if (/^https?:\/\//.test(rel)) return rel;
    var b = base.split("?")[0];
    if (rel.charAt(0) === "/") return b.replace(/^(https?:\/\/[^\/]+).*$/, "$1") + rel;
    return b.replace(/[^\/]*$/, "") + rel;
  }

  // Only a plain fMP4 media playlist is accepted: no master playlists, no encryption.
  function parse(text, base) {
    var lines = text.split(/\r?\n/), segs = [], init = null, dur = 0, t = 0;
    if (lines[0].trim() !== "#EXTM3U") throw new Error("not a playlist");
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l) continue;
      if (l.indexOf("#EXT-X-STREAM-INF") === 0) throw new Error("master playlist not supported");
      if (l.indexOf("#EXT-X-KEY:") === 0 && !/METHOD=NONE/.test(l)) throw new Error("encrypted playlist");
      if (l.indexOf("#EXT-X-MAP:") === 0) { var m = /URI="([^"]+)"/.exec(l); if (m) init = resolveUrl(base, m[1]); }
      else if (l.indexOf("#EXTINF:") === 0) { dur = parseFloat(l.slice(8)) || 0; }
      else if (l.charAt(0) !== "#") { segs.push({ url: resolveUrl(base, l), start: t, dur: dur }); t += dur; dur = 0; }
    }
    if (!init || !segs.length) throw new Error("not an fMP4 playlist");
    return { init: init, segs: segs, total: t };
  }

  function waitEvent(target, name, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { target.removeEventListener(name, h); reject(new Error(name + " timeout")); }, ms);
      function h() { clearTimeout(timer); target.removeEventListener(name, h); resolve(); }
      target.addEventListener(name, h);
    });
  }

  // One engine per <audio>. open() tears down the previous track completely first.
  function Engine(audio) {
    this.audio = audio;
    this.s = null;        // current session: {gen, ms, sb, url, pl, next, req, busy, failures}
    this.gen = 0;
    this.onFatal = null;  // called with an Error when the current session can't continue
    var self = this;
    audio.addEventListener("seeking", function () { if (self.s) self.onSeek(); });
    audio.addEventListener("timeupdate", function () { if (self.s) self.pump(); });
  }
  Engine.supported = supported;

  // Resolves once the init segment is appended (safe to call audio.play()); rejects on failure.
  Engine.prototype.open = function (url) {
    this.close();
    var gen = ++this.gen, self = this, audio = this.audio;
    var s = { gen: gen, next: 0, busy: false, failures: 0 };
    this.s = s;
    function live() { return self.s === s && self.gen === gen; }
    var pl = get(url, false);
    s.req = pl.xhr;
    return pl.then(function (text) {
      if (!live()) throw abortedErr();
      s.req = null;
      s.pl = parse(text, url);
      s.ms = new MediaSource();
      s.objUrl = URL.createObjectURL(s.ms);
      var opened = waitEvent(s.ms, "sourceopen", 10000);
      audio.src = s.objUrl;            // a blob: URL for our MediaSource, never the remote playlist
      return opened;
    }).then(function () {
      if (!live()) throw abortedErr();
      s.ms.duration = s.pl.total;
      s.sb = s.ms.addSourceBuffer(MIME);
      s.sb.addEventListener("updateend", function () { if (live()) self.pump(); });
      s.sb.addEventListener("error", function () { if (live()) self.fatal(new Error("SourceBuffer error")); });
      var ini = get(s.pl.init, true);
      s.req = ini.xhr;
      return ini;
    }).then(function (buf) {
      if (!live()) throw abortedErr();
      s.req = null;
      var done = waitEvent(s.sb, "updateend", 10000);
      s.sb.appendBuffer(buf);
      return done;
    }).then(function () {
      if (!live()) throw abortedErr();
      self.pump();
    }, function (e) {
      if (live()) self.close();
      throw e;
    });
  };
  function abortedErr() { var e = new Error("superseded"); e.aborted = true; return e; }

  // Full teardown: abort fetches, abort/remove the SourceBuffer, detach and revoke.
  Engine.prototype.close = function () {
    var s = this.s;
    this.gen++;
    this.s = null;
    if (!s) return;
    if (s.req) { try { s.req.abort(); } catch (e) { /* ignore */ } }
    if (s.ms && s.sb && s.ms.readyState === "open") {
      try { if (s.sb.updating) s.sb.abort(); } catch (e2) { /* ignore */ }
      try { s.ms.removeSourceBuffer(s.sb); } catch (e3) { /* ignore */ }
    }
    try { this.audio.pause(); } catch (e4) { /* ignore */ }
    this.audio.removeAttribute("src");
    try { this.audio.load(); } catch (e5) { /* ignore */ }
    if (s.objUrl) { try { URL.revokeObjectURL(s.objUrl); } catch (e6) { /* ignore */ } }
    s.ms = s.sb = s.pl = null;
  };

  Engine.prototype.active = function () { return !!this.s; };

  Engine.prototype.fatal = function (e) {
    SC.log("mse fatal", e && e.message ? e.message : String(e));
    this.close();
    if (this.onFatal) this.onFatal(e);
  };

  Engine.prototype.ahead = function () {
    var s = this.s, t = this.audio.currentTime;
    if (!s || !s.sb) return 0;
    var b = s.sb.buffered;
    for (var i = 0; i < b.length; i++) if (t >= b.start(i) - 0.3 && t <= b.end(i) + 0.3) return b.end(i) - t;
    return 0;
  };

  Engine.prototype.bufferedSeconds = function () {
    var s = this.s; if (!s || !s.sb) return 0;
    var b = s.sb.buffered, tot = 0;
    for (var i = 0; i < b.length; i++) tot += b.end(i) - b.start(i);
    return Math.round(tot);
  };

  // Where the stream stands, for end-of-track detection: every segment appended (all),
  // the MediaSource state, and the end of the buffered range holding the playhead.
  Engine.prototype.endInfo = function () {
    var s = this.s;
    if (!s || !s.sb || !s.pl || !s.ms) return null;
    var t = this.audio.currentTime, b = s.sb.buffered, end = 0;
    for (var i = 0; i < b.length; i++) if (t >= b.start(i) - 0.3 && t <= b.end(i) + 0.3) end = b.end(i);
    return { all: s.next >= s.pl.segs.length && !s.busy, ms: s.ms.readyState, bufEnd: end };
  };

  Engine.prototype.pump = function () {
    var s = this.s;
    if (!s || !s.sb || !s.pl || s.busy || s.sb.updating || !s.ms || s.ms.readyState === "closed") return;
    // Every segment is in: signal end of stream, and do it again whenever the MediaSource is
    // "open". No trimming from here on (nothing more is appended): a remove() on an ended
    // MediaSource reopens it, and then the media element never reaches "ended".
    if (s.next >= s.pl.segs.length) {
      if (s.ms.readyState === "open") {
        try { s.ms.endOfStream(); } catch (e2) { /* ignore */ }
      }
      return;
    }
    var t = this.audio.currentTime, b = s.sb.buffered;
    // Trim played audio beyond the back limit.
    if (b.length && t - b.start(0) > BEHIND + 10) {
      try { s.sb.remove(b.start(0), t - BEHIND); return; } catch (e) { /* ignore */ }
    }
    // Trim anything far ahead (left over from a backwards seek).
    if (b.length && b.end(b.length - 1) - t > AHEAD + 30) {
      try { s.sb.remove(t + AHEAD, b.end(b.length - 1)); return; } catch (e1) { /* ignore */ }
    }
    if (this.ahead() > AHEAD) return;
    this.fetchSegment(s, s.next);
  };

  Engine.prototype.fetchSegment = function (s, idx) {
    var self = this;
    s.busy = true;
    var req = get(s.pl.segs[idx].url, true);
    s.req = req.xhr;
    req.then(function (buf) {
      s.req = null; s.busy = false;
      if (self.s !== s || !s.sb) return;
      s.failures = 0;
      s.next = idx + 1;
      try { s.sb.appendBuffer(buf); }
      catch (e) {
        if (e.name === "QuotaExceededError") {
          s.next = idx;   // make room behind the playhead, then fetch it again
          var t = self.audio.currentTime;
          try { if (t > 5) s.sb.remove(0, t - 5); } catch (e2) { /* ignore */ }
          return;
        }
        self.fatal(e);
      }
    }, function (e) {
      s.req = null; s.busy = false;
      if (self.s !== s || e.aborted) return;
      // Network hiccup: two delayed retries, then give up (no endless loop).
      if (++s.failures > 2) { self.fatal(e); return; }
      setTimeout(function () { if (self.s === s) self.pump(); }, 1500 * s.failures);
    });
  };

  Engine.prototype.onSeek = function () {
    var s = this.s;
    if (!s || !s.pl || !s.sb) return;
    if (this.ahead() > 0.5) return;          // landed inside buffered audio
    if (s.req) { try { s.req.abort(); } catch (e) { /* ignore */ } s.req = null; s.busy = false; }
    var t = this.audio.currentTime, segs = s.pl.segs, i = 0;
    while (i < segs.length - 1 && t >= segs[i].start + segs[i].dur) i++;
    s.next = i;                               // appending reopens an "ended" MediaSource
    this.pump();
  };

  SC.Hls = Engine;
})();
