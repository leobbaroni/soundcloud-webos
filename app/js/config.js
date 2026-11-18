// Build-time settings. build.py rewrites this file inside a debug package only; the release
// package ships it as is: debug beacon off, no host, no self-test button.
window.SC_CONFIG = {
  debug: false,      // send log lines to debugHost (also on with localStorage.sc_debug or ?debug=1)
  debugHost: "",     // e.g. "http://192.168.1.10:8765" (also localStorage.sc_debug_host)
  selftestButton: false  // debug packages: show "Run self-test" in Settings (never runs on launch)
};
