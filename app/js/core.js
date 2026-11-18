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
      var img = new Image();
      img.src = debugHost.replace(/\/$/, "") + "/probe?" + encodeURIComponent(msg);
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

  // ---- DOM ----
  SC.el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
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
    t.textContent = msg;
    t.className = "toast show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast"; }, ms || 3200);
  };
})();
