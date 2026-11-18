// Shared helpers: storage, debug log/beacon, DOM building, formatting, events, toasts.
// Written for Chromium 53 (webOS 4): ES2015 subset, no async/await, no spread in objects.
(function () {
  "use strict";
  var SC = window.SC = {};
  var CFG = window.SC_CONFIG || {};

  // ---- storage (localStorage, JSON, never throws) ----
  SC.store = {
    get: function (key, def) {
      try {
        var v = window.localStorage.getItem("sc_" + key);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set: function (key, val) {
      try {
        if (val === undefined || val === null) window.localStorage.removeItem("sc_" + key);
        else window.localStorage.setItem("sc_" + key, JSON.stringify(val));
      } catch (e) { /* full or blocked: ignore */ }
    }
  };

  // ---- debug log + beacon ----
  function rawLS(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  var debugOn = !!CFG.debug || !!rawLS("sc_debug") || /[?&]debug=1/.test(location.search);
  var debugHost = rawLS("sc_debug_host") || CFG.debugHost || "";
  SC.debug = debugOn;
  var t0 = Date.now();
  var seq = 0;
  SC.log = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (typeof a === "string") parts.push(a);
      else { try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); } }
    }
    var line = parts.join(" ");
    if (window.console) console.log("[sc] " + line);
    if (debugOn && debugHost) {
      var msg = (seq++) + " +" + ((Date.now() - t0) / 1000).toFixed(1) + "s " + line;
      if (msg.length > 1500) msg = msg.slice(0, 1500) + "...";
      // a title cut in the middle of an emoji leaves half a surrogate pair, which
      // encodeURIComponent refuses: logging must never throw into the app
      msg = msg.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1?");
      try {
        var img = new Image();
        img.src = debugHost.replace(/\/$/, "") + "/probe?" + encodeURIComponent(msg);
      } catch (e) {}
    }
  };
  window.onerror = function (msg, src, line, col, err) {
    SC.log("ERROR", String(msg), String(src || "").split("/").pop() + ":" + line + ":" + col,
      err && err.stack ? String(err.stack).slice(0, 600) : "");
  };
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    SC.log("UNHANDLED REJECTION", r && r.message ? r.message : String(r));
  });

  // ---- events ----
  var handlers = {};
  SC.on = function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); };
  SC.off = function (name, fn) {
    var l = handlers[name]; if (!l) return;
    var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  };
  SC.emit = function (name, data) {
    var l = handlers[name]; if (!l) return;
    l.slice().forEach(function (fn) {
      try { fn(data); } catch (e) { SC.log("ERROR in handler " + name, e.message, String(e.stack).slice(0, 400)); }
    });
  };

  // ---- display text: styled "fancy" Unicode -> plain text (display only, never for API input) ----
  // The TV's fonts lack mathematical/full-width/enclosed letters, so they would draw as squares.
  // NFKC folds most of them; the table below covers look-alikes NFKC leaves alone.
  var SMALLCAP = {
    "\u1D00": "a", "\u0299": "b", "\u1D04": "c", "\u1D05": "d", "\u1D07": "e", "\uA730": "f",
    "\u0262": "g", "\u029C": "h", "\u026A": "i", "\u1D0A": "j", "\u1D0B": "k", "\u029F": "l",
    "\u1D0D": "m", "\u0274": "n", "\u1D0F": "o", "\u1D18": "p", "\uA7AF": "q", "\u0280": "r",
    "\uA731": "s", "\u1D1B": "t", "\u1D1C": "u", "\u1D20": "v", "\u1D21": "w", "\u028F": "y",
    "\u1D22": "z"
  };
  var RE_SMALLCAP = /[\u1D00\u0299\u1D04\u1D05\u1D07\uA730\u0262\u029C\u026A\u1D0A\u1D0B\u029F\u1D0D\u0274\u1D0F\u1D18\uA7AF\u0280\uA731\u1D1B\u1D1C\u1D20\u1D21\u028F\u1D22]/g;
  // squared U+1F130-1F149, negative circled U+1F150-1F169, negative squared U+1F170-1F189 -> A-Z
  var RE_BOXED = /\uD83C[\uDD30-\uDD89]/g;
  // zero-width and bidi controls, soft hyphen, text-presentation selector: render as boxes
  var RE_JUNK = /[\u00AD\u034F\u061C\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFE0E]/g;
  var RE_VS_ZWJ = /[\uFE0F\u200D]/;
  var EMOJIISH = /[\u00A9\u00AE\u203C\u2049\u2122\u2139\u2190-\u2BFF\u3030\u303D\u3297\u3299\uD83C-\uD83E\uDC00-\uDFFF]/;
  var CACHE_MAX = 500;
  var textCache = typeof Map === "function" ? new Map() : null;
  var canNormalize = false;
  try { canNormalize = typeof "".normalize === "function" && "\uFF21".normalize("NFKC") === "A"; } catch (e) {}

  function boxedLetter(m) {
    var c = m.charCodeAt(1);
    return String.fromCharCode(65 + (c - 0xDD30) % 32);
  }
  // Keep U+FE0F / ZWJ only where they belong to an emoji sequence, drop them elsewhere.
  function fixJoiners(s) {
    if (!RE_VS_ZWJ.test(s)) return s;
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === "\uFE0F" || ch === "\u200D") {
        var prev = out.length ? out.charAt(out.length - 1) : "";
        var next = s.charAt(i + 1);
        if (!prev || !EMOJIISH.test(prev) && !(ch === "\u200D" && prev === "\uFE0F") &&
            !(ch === "\uFE0F" && next === "\u20E3" && /[0-9#*]/.test(prev))) continue;
        if (ch === "\u200D") {
          // ZWJ must join two emoji (or a following variation selector)
          if (!next || !(EMOJIISH.test(next) || next === "\uFE0F")) continue;
        }
      }
      out += ch;
    }
    return out;
  }
  function cleanText(s) {
    if (/[^\x20-\x7E]/.test(s)) {
      s = s.replace(RE_BOXED, boxedLetter).replace(RE_SMALLCAP, function (c) { return SMALLCAP[c]; });
      if (canNormalize) { try { s = s.normalize("NFKC"); } catch (e) {} }
      // a keycap (1️⃣) draws here as the digit plus an empty box: keep the digit
      s = fixJoiners(s.replace(RE_JUNK, "")).replace(/([0-9#*])️?⃣/g, "$1");
    }
    return s.replace(/\s+/g, " ").replace(/^ | $/g, "");
  }
  SC.text = function (s) {
    if (s === undefined || s === null) return "";
    if (typeof s !== "string") s = String(s);
    if (s.length > 600) return cleanText(s);          // long descriptions: not worth caching
    if (!textCache) return cleanText(s);
    var r = textCache.get(s);
    if (r === undefined) {
      r = cleanText(s);
      if (textCache.size >= CACHE_MAX) textCache.clear();
      textCache.set(s, r);
    }
    return r;
  };

  // ---- DOM ----
  SC.el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = SC.text(text);
    return n;
  };
  SC.icon = function (name, cls) {
    var s = document.createElement("span");
    s.className = "ic" + (cls ? " " + cls : "");
    s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use xlink:href="#i-' + name + '"></use></svg>';
    return s;
  };
  SC.setIcon = function (span, name) {
    var use = span.querySelector("use");
    if (use) use.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#i-" + name);
  };
  SC.clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); };
  SC.inDoc = function (n) { return !!n && document.body.contains(n); };

  // ---- lazy images (only load artwork that is on screen) ----
  var io = null;
  if (window.IntersectionObserver) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting || en.intersectionRatio > 0) {
          var img = en.target;
          io.unobserve(img);
          if (img.getAttribute("data-src")) { img.src = img.getAttribute("data-src"); img.removeAttribute("data-src"); }
        }
      });
    }, { rootMargin: "200px" });
  }
  var BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  SC.BLANK = BLANK;
  SC.img = function (url, cls, eager) {
    var img = document.createElement("img");
    img.className = cls || "";
    img.alt = "";
    if (!url) { img.className += " noart"; img.src = BLANK; return img; }
    img.onerror = function () { img.onerror = null; img.className += " noart"; img.src = BLANK; };
    if (io && !eager) { img.setAttribute("data-src", url); img.src = BLANK; io.observe(img); }
    else img.src = url;
    return img;
  };
  // Re-run the observer for images that were laid out off screen and then scrolled in (an
  // ancestor's transform does not always trigger it on old Chromium).
  SC.recheckImages = function (root) {
    if (!io) return;
    var imgs = (root || document).querySelectorAll("img[data-src]");
    for (var i = 0; i < imgs.length; i++) { io.unobserve(imgs[i]); io.observe(imgs[i]); }
  };

  // ---- formatting ----
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  SC.fmtTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ":" + pad2(m) + ":" + pad2(s) : m + ":" + pad2(s);
  };
  SC.fmtCount = function (n) {
    if (!n && n !== 0) return "";
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(n);
  };
  SC.plural = function (n, one, many) { return n + " " + (n === 1 ? one : many); };
  SC.art = function (url, size) {
    if (!url) return "";
    return url.replace(/-(large|t\d+x\d+|crop|original)\.(jpg|png)/, "-" + (size || "t300x300") + ".$2");
  };
  SC.shuffle = function (a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  // ---- toast ----
  var toastTimer = 0;
  SC.toast = function (msg, ms) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = SC.text(msg);
    t.className = "toast show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast"; }, ms || 3200);
  };
})();
