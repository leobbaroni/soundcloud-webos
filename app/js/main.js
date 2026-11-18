// App shell: screen stack and Back, side rail, mini-player, Now playing, exit dialog, remote keys.
(function () {
  "use strict";
  var SC = window.SC, nav = SC.nav, player = SC.player, el = SC.el, V = SC.views;
  var screensEl = document.getElementById("screens");
  var rail = document.getElementById("rail");
  var mini = document.getElementById("mini");
  var modal = null;

  // =================== router ===================
  var stack = [];   // {name, params, scr}
  var MAX_LIVE = 6; // screens kept in the DOM; older ones are rebuilt when Back reaches them

  function create(entry) {
    entry.scr = SC.screens[entry.name](entry.params || {});
    if (!entry.scr.el.parentNode) screensEl.appendChild(entry.scr.el);
  }
  function destroy(entry) {
    if (!entry.scr) return;
    if (entry.scr.destroy) entry.scr.destroy();
    if (entry.scr.keep) entry.scr.el.style.display = "none";
    else if (entry.scr.el.parentNode) entry.scr.el.parentNode.removeChild(entry.scr.el);
    entry.scr = null;
  }
  function show(entry) {
    if (!entry.scr) create(entry);
    stack.forEach(function (e) { if (e !== entry && e.scr) e.scr.el.style.display = "none"; });
    entry.scr.el.style.display = "";
    document.body.classList.toggle("immersive", entry.name === "now");
    var railName = rootName();
    var items = rail.querySelectorAll(".rail-item");
    for (var i = 0; i < items.length; i++) {
      var on = items[i].getAttribute("data-screen") === railName;
      items[i].classList.toggle("active", on);
      if (on) rail._last = items[i];
    }
    if (entry.scr.onShow) entry.scr.onShow();
    var last = entry.scr.el._last;
    if (last && SC.inDoc(last) && last.offsetParent) nav.focus(last);
    else if (!nav.current() || !entry.scr.el.contains(nav.current())) nav.focusFirst(entry.scr.el);
    SC.emit("screen", entry.name);
  }
  function rootName() {
    // Rail sections sit directly above Home; anything opened from Home belongs to Home.
    var n = stack[1] ? stack[1].name : "";
    return { search: 1, profile: 1, queue: 1, settings: 1 }[n] ? n : "home";
  }
  function trim() {
    var live = stack.filter(function (e) { return !!e.scr; });
    while (live.length > MAX_LIVE) {
      var victim = live.splice(1, 1)[0];   // keep Home and the newest
      destroy(victim);
    }
  }

  var router = SC.router = {
    open: function (name, params) {
      var top = stack[stack.length - 1];
      if (top && top.name === name && (name === "now" || name === "queue")) { show(top); return; }
      if (name === "now") {
        // Only one Now playing in the stack.
        for (var i = stack.length - 1; i > 0; i--) if (stack[i].name === "now") { stack.splice(i, 1); }
      }
      var entry = { name: name, params: params || {} };
      stack.push(entry);
      create(entry);
      show(entry);
      trim();
    },
    root: function (name) {
      while (stack.length > 1) destroy(stack.pop());
      if (name !== "home") { var e = { name: name, params: {} }; stack.push(e); create(e); }
      show(stack[stack.length - 1]);
    },
    back: function () {
      if (modal) { closeModal(); return; }
      if (stack.length > 1) {
        destroy(stack.pop());
        show(stack[stack.length - 1]);
      } else {
        confirmExit();
      }
    },
    top: function () { var t = stack[stack.length - 1]; return t ? t.scr : null; },
    topName: function () { var t = stack[stack.length - 1]; return t ? t.name : ""; },
    depth: function () { return stack.length; }
  };

  nav.setScopes(function () {
    if (modal) return [modal];
    var t = stack[stack.length - 1];
    if (!t || !t.scr) return [rail];
    if (t.name === "now") return [t.scr.el];
    return [rail, t.scr.el, mini.classList.contains("show") ? mini : null];
  });

  // =================== rail ===================
  Array.prototype.forEach.call(rail.querySelectorAll(".rail-item"), function (it) {
    nav.bind(it, function () {
      var name = it.getAttribute("data-screen");
      if (name === "home" && stack.length === 1) { show(stack[0]); return; }
      router.root(name);
    });
  });

  // =================== modal (exit) ===================
  function openModal(title, text, actions) {
    closeModal();
    var back = el("div", "modal-back");
    var box = el("div", "modal");
    box.appendChild(el("h2", "modal-title", title));
    if (text) box.appendChild(el("p", "modal-text", text));
    var row = el("div", "modal-actions");
    actions.forEach(function (a, i) {
      var b = V.button(a.label, a.icon, function () { closeModal(); a.act(); }, i === 0 ? "primary" : "");
      row.appendChild(b);
    });
    box.appendChild(row);
    back.appendChild(box);
    document.body.appendChild(back);
    modal = back;
    modal._prev = nav.current();
    nav.focus(row.firstChild);
  }
  function closeModal() {
    if (!modal) return;
    var prev = modal._prev;
    modal.parentNode.removeChild(modal);
    modal = null;
    if (prev && SC.inDoc(prev)) nav.focus(prev); else nav.focusFirst();
  }
  function confirmExit() {
    openModal("Leave SoundCloud?", player.isPlaying() ? "Music will stop playing." : "", [
      { label: "Stay", icon: "", act: function () {} },
      { label: "Exit", icon: "", act: function () { player.pause(); window.close(); } }
    ]);
  }
  SC.confirmExit = confirmExit;

  // =================== mini-player ===================
  var miniArt = mini.querySelector(".mini-art");
  var miniTitle = mini.querySelector(".mini-title");
  var miniSub = mini.querySelector(".mini-sub");
  var miniFill = mini.querySelector(".mini-fill");
  var miniPlay = mini.querySelector('[data-act="play"]');
  nav.bind(mini.querySelector(".mini-info"), function () { router.open("now"); });
  nav.bind(mini.querySelector('[data-act="prev"]'), function () { player.prev(); });
  nav.bind(miniPlay, function () { player.toggle(); });
  nav.bind(mini.querySelector('[data-act="next"]'), function () { player.next(); });

  // =================== Now playing (one instance, kept) ===================
  var now = (function () {
    var s = el("div", "screen now");
    s.style.display = "none";
    var bg = el("div", "now-bg");
    s.appendChild(bg);
    var inner = el("div", "now-inner");
    var artBox = el("div", "now-art");
    var art = SC.img("", "now-img", true);
    artBox.appendChild(art);
    inner.appendChild(artBox);
    var info = el("div", "now-info");
    var eyebrow = el("div", "eyebrow", "Now playing");
    var title = el("h1", "now-title", "");
    var artist = el("div", "now-artist link focusable", "");
    info.appendChild(eyebrow); info.appendChild(title); info.appendChild(artist);
    var seek = el("div", "seek focusable");
    var seekTrack = el("div", "seek-track");
    var seekFill = el("div", "seek-fill");
    var seekKnob = el("div", "seek-knob");
    seekTrack.appendChild(seekFill); seek.appendChild(seekTrack); seek.appendChild(seekKnob);
    info.appendChild(seek);
    var times = el("div", "now-times");
    var tCur = el("span", "", "0:00"), tDur = el("span", "", "0:00");
    times.appendChild(tCur); times.appendChild(tDur);
    info.appendChild(times);
    var ctr = el("div", "now-controls");
    function cbtn(icon, act, cls) { var b = el("div", "cbtn" + (cls ? " " + cls : "")); b.appendChild(SC.icon(icon)); nav.bind(b, act); ctr.appendChild(b); return b; }
    var bShuffle = cbtn("shuffle", function () { var on = player.toggleShuffle(); SC.toast(on ? "Shuffle on" : "Shuffle off", 1500); });
    cbtn("prev", function () { player.prev(); });
    var bPlay = cbtn("play", function () { player.toggle(); }, "big");
    bPlay.setAttribute("data-autofocus", "");
    cbtn("next", function () { player.next(); });
    var bRepeat = cbtn("repeat", function () {
      var r = player.cycleRepeat(); SC.toast(r === "off" ? "Repeat off" : r === "all" ? "Repeat queue" : "Repeat this track", 1500);
    });
    cbtn("queue", function () { router.open("queue"); }, "spaced");
    info.appendChild(ctr);
    var upNext = el("div", "now-next", "");
    info.appendChild(upNext);
    inner.appendChild(info);
    s.appendChild(inner);
    screensEl.appendChild(s);

    nav.bind(artist, function () {
      var t = player.current();
      if (t && t.user && t.user.id) router.open("artist", { user: { kind: "user", id: t.user.id, username: t.user.username, avatar: t.user.avatar } });
    });
    nav.bind(seek, function () { player.toggle(); });
    seek._key = function (dir) {
      if (dir === "left") { player.seekBy(-10); return true; }
      if (dir === "right") { player.seekBy(10); return true; }
      return false;
    };
    seek._click = function (e) {
      var r = seekTrack.getBoundingClientRect();
      var f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      player.seek(f * player.time().dur);
    };

    function setTrack(t) {
      if (!t) return;
      art.className = "now-img";
      art.src = t.artwork ? SC.art(t.artwork, "t500x500") : SC.BLANK;
      if (!t.artwork) art.className += " noart";
      title.textContent = SC.text(t.title);
      artist.textContent = SC.text(t.user.username);
      updNext();
    }
    function updNext() {
      var n = player.upNext();
      upNext.textContent = n ? SC.text("Up next · " + (n.title || "Loading…") + (n.user && n.user.username ? " — " + n.user.username : "")) :
        (player.state.autoplay ? "Up next · similar tracks (autoplay)" : "End of queue");
    }
    function setState(st) {
      SC.setIcon(bPlay.querySelector(".ic"), st.playing ? "pause" : "play");
      eyebrow.textContent = st.loading ? "Loading…" : st.playing ? "Now playing" : "Paused";
      bShuffle.classList.toggle("on", player.state.shuffle);
      bRepeat.classList.toggle("on", player.state.repeat !== "off");
      SC.setIcon(bRepeat.querySelector(".ic"), player.state.repeat === "one" ? "repeat-one" : "repeat");
    }
    function setTime(tm) {
      var f = tm.dur ? Math.max(0, Math.min(1, tm.cur / tm.dur)) : 0;
      seekFill.style.transform = "scaleX(" + f + ")";
      seekKnob.style.transform = "translate3d(" + (f * seekTrack.offsetWidth) + "px,0,0)";
      tCur.textContent = SC.fmtTime(tm.cur);
      tDur.textContent = SC.fmtTime(tm.dur);
    }
    return { el: s, keep: true, setTrack: setTrack, setState: setState, setTime: setTime, updNext: updNext,
      onShow: function () { setTime(player.time()); updNext(); } };
  })();
  SC.screens.now = function () { return now; };

  // =================== player events -> UI ===================
  SC.on("player:track", function (t) {
    mini.classList.add("show");
    document.body.classList.add("has-mini");
    miniArt.className = "mini-art";
    miniArt.src = t.artwork ? SC.art(t.artwork, "t300x300") : SC.BLANK;
    if (!t.artwork) miniArt.className += " noart";
    miniTitle.textContent = SC.text(t.title);
    miniSub.textContent = SC.text(t.user.username);
    now.setTrack(t);
    markPlaying(t.id);
  });
  SC.on("player:state", function (st) {
    SC.setIcon(miniPlay.querySelector(".ic"), st.playing ? "pause" : "play");
    mini.classList.toggle("loading", !!st.loading);
    now.setState(st);
  });
  var lastTimeDraw = 0;
  SC.on("player:time", function (tm) {
    var f = tm.dur ? Math.max(0, Math.min(1, tm.cur / tm.dur)) : 0;
    miniFill.style.transform = "scaleX(" + f + ")";
    var nowTs = Date.now();
    if (router.topName() === "now" || nowTs - lastTimeDraw > 2000) { now.setTime(tm); lastTimeDraw = nowTs; }
  });
  SC.on("player:queue", function () { now.updNext(); });
  function markPlaying(id) {
    var old = document.querySelectorAll(".is-playing");
    for (var i = 0; i < old.length; i++) old[i].classList.remove("is-playing");
    var cards = document.querySelectorAll(".card, .trow");
    for (var j = 0; j < cards.length; j++) {
      var it = cards[j]._item || cards[j]._track;
      if (it && it.kind === "track" && it.id === id) cards[j].classList.add("is-playing");
    }
  }
  SC.on("profile:changed", function () {
    if (stack[0] && stack[0].scr && stack[0].scr.refresh) stack[0].scr.refresh();
  });

  // =================== keys ===================
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, BKSP: 8,
    PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412, NEXT: 176, PREV: 177, PLAYPAUSE: 179, RED: 403 };
  var lastMove = 0;
  document.addEventListener("keydown", function (e) {
    var k = e.keyCode;
    var ae = document.activeElement;
    if (ae && ae.tagName === "INPUT") {
      // The TV keyboard is up: let it type; handle only submit, leave and vertical moves.
      if (k === K.OK) { e.preventDefault(); if (ae._submit) ae._submit(); ae.blur(); return; }
      if (k === K.BACK || k === K.ESC) { e.preventDefault(); ae.blur(); return; }
      if (k === K.DOWN || k === K.UP) { e.preventDefault(); ae.blur(); nav.move(k === K.DOWN ? "down" : "up"); return; }
      return;
    }
    nav.keyMode();
    var handled = true;
    switch (k) {
      case K.LEFT: case K.RIGHT: case K.UP: case K.DOWN:
        var t = Date.now();
        if (e.repeat && t - lastMove < 70) break;
        lastMove = t;
        nav.move(k === K.LEFT ? "left" : k === K.RIGHT ? "right" : k === K.UP ? "up" : "down");
        break;
      case K.OK: if (!e.repeat) nav.activate(); break;
      case K.BACK: case K.ESC: case K.BKSP: router.back(); break;
      case K.PLAY: player.play(); break;
      case K.PAUSE: player.pause(); break;
      case K.PLAYPAUSE: player.toggle(); break;
      case K.STOP: player.stop(); break;
      case K.FF: player.seekBy(15); break;
      case K.RW: player.seekBy(-15); break;
      case K.NEXT: player.next(); break;
      case K.PREV: player.prev(); break;
      case K.RED: if (player.current()) { if (router.topName() === "now") router.back(); else router.open("now"); } break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  // =================== boot ===================
  SC.version = "";
  try {
    var r = new XMLHttpRequest();
    r.open("GET", "appinfo.json", false);
    r.send();
    SC.version = JSON.parse(r.responseText).version || "";
  } catch (e2) { /* not fatal */ }
  var mem = window.performance && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + "MB" : "?";
  SC.log("boot v" + SC.version, navigator.userAgent, window.innerWidth + "x" + window.innerHeight, "heap=" + mem);
  router.open("home");

  // Playback needs MediaSource with AAC in fMP4. Without it nothing is ever played (the
  // native HLS path is not used at all), and the user is told once, clearly.
  function showUnsupported() {
    openModal("Playback isn't supported on this TV",
      "This TV's browser can't play SoundCloud's audio format (MediaSource with AAC). You can still browse.",
      [{ label: "OK", icon: "", act: function () {} }]);
  }
  SC.on("player:unsupported", showUnsupported);
  if (!player.supported) showUnsupported();

  // Debug packages only: the self-test runs when someone presses "Run self-test" in Settings.
  SC.runSelftest = function () {
    if (!(window.SC_CONFIG || {}).selftestButton || SC.selftestLoaded) return;
    SC.selftestLoaded = true;
    SC.log("self-test requested from Settings");
    var st = document.createElement("script");
    st.src = "js/selftest.js";
    document.body.appendChild(st);
  };
  // ...or, in a debug package only, when launched with the explicit launch parameter
  // {"selftest": true} (luna-send .../launch '{"id":...,"params":{"selftest":true}}').
  // A normal launch never starts it.
  function launchParams() {
    try { return JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || "{}") || {}; } catch (e) { return {}; }
  }
  function checkLaunch() {
    if ((window.SC_CONFIG || {}).selftestButton && launchParams().selftest === true) {
      setTimeout(function () { SC.runSelftest(); }, 3000);
    }
  }
  checkLaunch();
  document.addEventListener("webOSRelaunch", checkLaunch);
})();
