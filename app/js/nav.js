// Spatial focus for the remote (arrows/OK) and the Magic Remote pointer (mouse events).
// Focus is virtual (class "focused"), so moving onto a text field doesn't pop the keyboard;
// OK on a field gives it real focus, which opens the TV keyboard.
(function () {
  "use strict";
  var SC = window.SC;
  var cur = null;
  var scopesFn = function () { return [document.body]; };
  var pointerMode = false;

  function visible(el) {
    if (!el || !el.offsetParent && el.style.position !== "fixed") return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function scopeOf(el) {
    var s = scopesFn();
    for (var i = 0; i < s.length; i++) if (s[i] && s[i].contains(el)) return s[i];
    return null;
  }
  function candidates() {
    var out = [];
    scopesFn().forEach(function (s) {
      if (!s) return;
      var l = s.querySelectorAll(".focusable");
      for (var i = 0; i < l.length; i++) if (!l[i].classList.contains("disabled") && visible(l[i])) out.push(l[i]);
    });
    return out;
  }

  // ---- scrolling containers: [data-scroll="x"|"y"], moved with transforms ----
  function offsetWithin(el, container, axis) {
    var off = 0, n = el;
    while (n && n !== container) {
      off += axis === "x" ? n.offsetLeft : n.offsetTop;
      n = n.offsetParent;
    }
    return off;
  }
  function contentExtent(c, axis) {
    if (axis === "y") return c.scrollHeight;
    var last = c.lastElementChild;
    return last ? last.offsetLeft + last.offsetWidth + (parseInt(c.getAttribute("data-pad-end") || "80", 10)) : 0;
  }
  function setScroll(c, v, axis) {
    var view = axis === "x" ? c.parentNode.clientWidth : c.parentNode.clientHeight;
    var max = Math.max(0, contentExtent(c, axis) - view);
    v = Math.max(0, Math.min(v, max));
    if (c._scroll === v) return;
    c._scroll = v;
    c.style.transform = axis === "x" ? "translate3d(" + (-v) + "px,0,0)" : "translate3d(0," + (-v) + "px,0)";
    clearTimeout(c._imgT);
    c._imgT = setTimeout(function () { SC.recheckImages(c); }, 320);
  }
  function ensureVisible(el, onlyAxis) {
    var n = el.parentNode;
    while (n && n !== document.body) {
      var axis = n.getAttribute && n.getAttribute("data-scroll");
      if (axis && (!onlyAxis || onlyAxis === axis)) {
        var target = el;
        if (axis === "y") target = el.closest(".vis") || el;
        if (!n.contains(target)) target = el;
        var off = offsetWithin(target, n, axis);
        var size = axis === "x" ? target.offsetWidth : target.offsetHeight;
        var view = axis === "x" ? n.parentNode.clientWidth : n.parentNode.clientHeight;
        var pad = parseInt(n.getAttribute("data-pad") || (axis === "x" ? "80" : "60"), 10);
        var s = n._scroll || 0;
        if (n.getAttribute("data-align") === "start" && axis === "y") {
          s = off - pad;
        } else {
          if (off - s < pad) s = off - pad;
          else if (off + size - s > view - pad) s = off + size - view + pad;
        }
        if (target.hasAttribute("data-top")) s = 0;
        setScroll(n, s, axis);
      }
      n = n.parentNode;
    }
  }

  function focus(el, opts) {
    opts = opts || {};
    if (!el) return;
    if (cur && cur !== el) {
      cur.classList.remove("focused");
      if (cur.tagName === "INPUT" && document.activeElement === cur) cur.blur();
    }
    cur = el;
    el.classList.add("focused");
    var mem = el.closest("[data-mem]");
    if (mem) mem._last = el;
    var sc = scopeOf(el);
    if (sc) sc._last = el;
    if (!opts.noScroll) ensureVisible(el);
    else if (opts.xOnly) ensureVisible(el, "x");
    SC.emit("nav:focus", el);
  }

  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function gap(a1, a2, b1, b2) { return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2)); }

  function move(dir) {
    if (!cur || !SC.inDoc(cur) || !visible(cur)) { focusFirst(); return true; }
    if (cur._key && cur._key(dir)) return true;
    var c = cur.getBoundingClientRect(), cc = center(c);
    var best = null, bestScore = Infinity, tol = 12;
    var list = candidates();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e === cur) continue;
      var r = e.getBoundingClientRect(), rc = center(r), primary, secondary;
      if (dir === "right") { if (rc.x <= cc.x + 1 || r.left < c.left + tol) continue; primary = Math.max(0, r.left - c.right); secondary = gap(c.top, c.bottom, r.top, r.bottom); }
      else if (dir === "left") { if (rc.x >= cc.x - 1 || r.right > c.right - tol) continue; primary = Math.max(0, c.left - r.right); secondary = gap(c.top, c.bottom, r.top, r.bottom); }
      else if (dir === "down") { if (rc.y <= cc.y + 1 || r.top < c.top + tol) continue; primary = Math.max(0, r.top - c.bottom); secondary = gap(c.left, c.right, r.left, r.right); }
      else { if (rc.y >= cc.y - 1 || r.bottom > c.bottom - tol) continue; primary = Math.max(0, c.top - r.bottom); secondary = gap(c.left, c.right, r.left, r.right); }
      var along = (dir === "left" || dir === "right") ? Math.abs(rc.y - cc.y) : Math.abs(rc.x - cc.x);
      var score = primary + secondary * 4 + along * 0.15;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (!best) return false;
    // Entering another scope (rail <-> screen <-> mini-player): return to where focus was.
    var fromScope = scopeOf(cur), toScope = scopeOf(best);
    if (toScope && toScope !== fromScope && toScope._last && toScope._last !== cur && SC.inDoc(toScope._last) && visible(toScope._last) && !toScope.hasAttribute("data-nomem")) {
      best = toScope._last;
    } else if (dir === "up" || dir === "down") {
      // Entering another row vertically: go back to the card last focused in that row.
      var m = best.closest("[data-mem]");
      if (m && m !== cur.closest("[data-mem]") && m._last && SC.inDoc(m._last) && visible(m._last)) best = m._last;
    }
    focus(best);
    return true;
  }

  function focusFirst(scope) {
    var root = scope || null;
    var list = root ? Array.prototype.filter.call(root.querySelectorAll(".focusable"), visible) : candidates();
    var pref = list.filter(function (e) { return e.hasAttribute("data-autofocus"); })[0];
    if (pref || list[0]) focus(pref || list[0]);
  }

  function activate(el) {
    el = el || cur;
    if (!el) return;
    if (el.tagName === "INPUT") { el.focus(); return; }
    if (el._act) el._act(el);
  }

  // ---- pointer (Magic Remote): hover focuses, click activates ----
  document.addEventListener("mouseover", function (e) {
    var el = e.target.closest ? e.target.closest(".focusable") : null;
    if (!el || el === cur || !scopeOf(el)) return;
    pointerMode = true;
    focus(el, { noScroll: true, xOnly: true });
  });
  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest(".focusable") : null;
    if (!el || !scopeOf(el)) return;
    e.preventDefault();
    if (el !== cur) focus(el, { noScroll: true });
    if (el._click) el._click(e); else activate(el);
  });
  // Wheel scrolls the screen under the pointer.
  document.addEventListener("wheel", function (e) {
    var n = e.target;
    while (n && n !== document.body) {
      if (n.getAttribute && n.getAttribute("data-scroll") === "y" && scopeOf(n)) {
        setScroll(n, (n._scroll || 0) + (e.deltaY > 0 ? 240 : -240), "y");
        e.preventDefault();
        return;
      }
      n = n.parentNode;
    }
  });

  SC.nav = {
    focus: focus,
    move: move,
    activate: activate,
    focusFirst: focusFirst,
    current: function () { return SC.inDoc(cur) ? cur : null; },
    setScopes: function (fn) { scopesFn = fn; },
    ensureVisible: ensureVisible,
    resetScroll: function (c) { c._scroll = -1; setScroll(c, 0, c.getAttribute("data-scroll")); },
    // Make an element focusable with an OK/click action.
    bind: function (el, act) { el.classList.add("focusable"); el._act = act; return el; },
    pointerMode: function () { return pointerMode; },
    keyMode: function () { pointerMode = false; }
  };
})();
