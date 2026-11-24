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
  // skip: a list or row whose own items are already ruled out (not measured at all)
  function candidates(skip) {
    var out = [];
    scopesFn().forEach(function (s) {
      if (!s) return;
      var l = s.querySelectorAll(".focusable");
      for (var i = 0; i < l.length; i++) if (l[i].parentNode !== skip && !l[i].classList.contains("disabled") && visible(l[i])) out.push(l[i]);
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
  // Vertical resting offset: the screen's edges should not cut a line of text.
  // Blocks are the scroller's [.vis] elements (rows, list rows, headers, notes), measured by
  // their content (the union of their children, less a row's empty room for the focus ring).
  // Hard rules: the top edge never falls inside a block's content, and the focused block's
  // content (or at least its title) shows. Preferred, in this order: at least COMFORT px
  // above the first block below the top edge; a bottom edge that doesn't cut a title (a row's
  // head, or a whole one-line block such as a list row; with evenly spaced list rows this is
  // not always possible); and the offset closest to the plain "keep it in view" one.
  var COMFORT = 40;
  function blockOf(b, n) {
    var top = offsetWithin(b, n, "y"), cTop = Infinity, cBot = -Infinity, kids = b.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i], h = c.offsetHeight;
      if (!h) continue;
      var ct = offsetWithin(c, n, "y"), cb = ct + h;
      if (i === kids.length - 1) cb -= parseFloat(getComputedStyle(c).paddingBottom) || 0;
      if (ct < cTop) cTop = ct;
      if (cb > cBot) cBot = cb;
    }
    if (!(cBot > cTop)) { cTop = top; cBot = top + b.offsetHeight; }
    var first = b.firstElementChild, head = cBot;
    if (first && (first.classList.contains("row-head") || /^H[1-3]$/.test(first.tagName))) head = offsetWithin(first, n, "y") + first.offsetHeight;
    // 2 px allowance: offsets are whole pixels, line boxes are not
    return { top: cTop - 2, bottom: cBot + 2, head: head + 2 };
  }
  function restY(n, target, base, view) {
    var max = Math.max(0, contentExtent(n, "y") - view);
    base = Math.max(0, Math.min(base, max));
    var T = blockOf(target, n), lo = T.top - 2 * view, hi = T.bottom + 2 * view;
    var all = n.querySelectorAll(".vis"), blocks = [], i, b, top;
    // In a long list (thousands of likes) only the target's neighbours can be near the edges:
    // walk out from it and stop at the first one outside the window, so the cost of a key
    // press does not grow with the list. Blocks elsewhere in the scroller are few.
    var P = target.parentNode, near = P !== n && P.children.length > 60;
    function take(x) {
      if (!x.offsetHeight || x === target || x.contains(target) || target.contains(x)) return true;
      top = offsetWithin(x, n, "y");
      if (top > hi || top + x.offsetHeight < lo) return false;
      blocks.push(blockOf(x, n));
      return true;
    }
    if (near) {
      for (b = target.previousElementSibling; b; b = b.previousElementSibling) if (b.classList.contains("vis") && !take(b)) break;
      for (b = target.nextElementSibling; b; b = b.nextElementSibling) if (b.classList.contains("vis") && !take(b)) break;
    }
    for (i = 0; i < all.length; i++) if (!near || all[i].parentNode !== P) take(all[i]);
    // -1: not allowed; otherwise the penalty for this offset
    function cost(s) {
      var e = s + view, gap = T.top - s, k, x, pen = 0;
      if (T.top < s || Math.min(T.bottom, T.head + view / 2) > e) return -1;
      for (k = 0; k < blocks.length; k++) {
        x = blocks[k];
        if (x.top < s && s < x.bottom) return -1;
        if (x.top >= s && x.top - s < gap) gap = x.top - s;
        if (x.top < e && e < x.head) pen = 150;
      }
      return pen + (s > 0 && gap < COMFORT ? 300 : 0) + Math.abs(s - base);
    }
    var cand = [base, 0, max, T.top - 60, T.bottom - view], prev = 0;
    for (i = 0; i < blocks.length; i++) {
      var x = blocks[i];
      cand.push(x.bottom, x.top - 60, x.top - 16, x.top - view, x.head + 12 - view, x.bottom + 12 - view);
      if (x.bottom <= T.top) { cand.push(Math.max(prev, x.top - 60)); prev = Math.max(prev, x.bottom); }
    }
    cand.push(Math.max(prev, T.top - 60));
    var best = base, bestScore = Infinity;
    for (i = 0; i < cand.length; i++) {
      var s = Math.round(cand[i]);
      if (s < 0 || s > max) continue;
      var c = cost(s);
      if (c >= 0 && c < bestScore) { bestScore = c; best = s; }
    }
    return best;
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
        if (axis === "y") s = restY(n, target, s, view);
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
    // In a list or a row of cards the neighbour in line is the answer: no need to measure every
    // focusable on the screen (a 4,000-row list made each press slower than the last).
    var par = cur.parentNode;
    var line = !par || !par.classList ? "" : par.classList.contains("tlist") ? "y" : par.getAttribute("data-scroll") === "x" ? "x" : "";
    if (line === "y" ? dir === "up" || dir === "down" : line === "x" && (dir === "left" || dir === "right")) {
      var fwd = dir === "down" || dir === "right", sib = cur;
      do { sib = fwd ? sib.nextElementSibling : sib.previousElementSibling; }
      while (sib && !(sib.classList.contains("focusable") && !sib.classList.contains("disabled") && sib.offsetParent));
      if (sib) { focus(sib); return true; }
    } else par = null;   // moving across the line: its other items are candidates
    var c = cur.getBoundingClientRect(), cc = center(c);
    var best = null, bestScore = Infinity, tol = 12;
    // Stay in the current scope while it has something in that direction (a row scrolled out
    // of view below must win over the mini-player that covers it); else cross to another.
    var here = scopeOf(cur), all = candidates(par);
    pick(all.filter(function (e) { return scopeOf(e) === here; }));
    if (!best) pick(all);
    if (!best) return false;
    function pick(list) {
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
    }
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
