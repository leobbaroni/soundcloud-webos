# SoundCloud for LG webOS TVs

A native SoundCloud player for LG webOS TVs, driven by the remote. It replaces 1.0.0, which
opened soundcloud.com full screen; SoundCloud's site rejects the TV's browser. Built for an LG
75UM7600PLB (webOS TV Lite 4.10.2, Chromium 53, 1 GB RAM, app resolution 1920x1080).

Plain HTML/CSS/JS in `app/`, no frameworks, no build step, no npm dependencies. It uses
SoundCloud's public `api-v2` with the web client id, so there is no login: "Your profile"
reads the public likes, playlists and tracks of a username you type once. API streams carry no
ads, and the app adds none and loads no trackers.

## Using it

- **Screens:** Home (trending, recently played, "more like" your last track, your likes,
  SoundCloud's curated selections), Search (tracks, artists, playlists, albums; recent
  searches), Playlist/Album/Station, Artist, Your profile, Queue, Settings, and Now playing.
  A mini-player along the bottom shows what's on while you browse.
- **Remote:** arrows move, OK selects, Back goes up a screen (on Home it asks before exiting).
  Play/Pause/Stop work; FF/RW seek 15 s; on Now playing, Left/Right on the progress bar seek
  10 s. Red opens or closes Now playing. Next/Previous-track keys work when the remote sends
  them. The Magic Remote pointer works too: point to focus, click to select, wheel to scroll.
- **Search:** OK on the search field opens the TV keyboard; results appear as you type.
- **Autoplay:** when the queue ends, similar tracks are added (Settings → Autoplay).
- **Saved on the TV** (localStorage): the client id, your username, recently played, recent
  searches and settings. Volume is the TV's.

## Playback

SoundCloud streams are HLS with fMP4 segments (AAC). This TV's native media pipeline must not
be given them: it fails on them and has rebooted the TV. So `js/hls.js` fetches the playlist
and segments with XHR and appends them to a MediaSource. A remote stream URL is never set as
the `<audio>` source.

- One attempt per track: `aac_160k`, or `aac_96k` if that's all there is. Encrypted (DRM-only)
  tracks and `abr_sq` are never used; DRM-only tracks are marked "Not available on TV" and
  skipped. Tracks that only have 30-second previews are labelled "Preview".
- Track loads are at least 1.5 s apart, and Next/Previous presses within 0.5 s merge into one.
- Buffer kept to about 60 s behind and 120 s ahead of the playhead.
- If a track doesn't start within 20 s, stalls for 30 s or errors, the app stops it, shows a
  toast and skips; after 3 failures in a row it stops playback.
- Without MediaSource support for `audio/mp4; codecs="mp4a.40.2"`, the app says playback isn't
  supported and plays nothing.

## Files

| File | Purpose |
|---|---|
| `app/index.html` | Shell: icon sprite, side rail, mini-player, script order |
| `app/css/app.css` | 10-foot dark theme, focus states (Chromium 53-safe CSS) |
| `app/js/config.js` | Build settings: debug beacon, debug host, self-test button (all off) |
| `app/js/core.js` | Storage, debug log/beacon, DOM helpers, lazy images, toasts |
| `app/js/api.js` | api-v2 client: client id, endpoints, data normalisation |
| `app/js/nav.js` | Spatial focus for the remote, pointer, transform-based scrolling |
| `app/js/hls.js` | fMP4 HLS through MediaSource |
| `app/js/player.js` | Queue, shuffle/repeat, autoplay, load gating, watchdogs |
| `app/js/views.js` | Cards, rows, track lists and the screens |
| `app/js/main.js` | Screen stack and Back, mini-player, Now playing, keys, boot |
| `app/js/selftest.js` | Debug packages only: drives the app and reports via the beacon |
| `build.py` | Packs `app/` into an `.ipk` |

## Build and install

```sh
python build.py                                  # build/local.soundcloud.tv_1.1.0_all.ipk
python build.py --debug http://<pc-ip>:<port>    # build/local.soundcloud.tv_1.1.0_all-debug.ipk
```

The release package ships with the beacon off, an empty debug host and no `selftest.js`. The
debug package sends log lines to `http://<pc-ip>:<port>/probe?<line>` (any static server's
request log will do) and adds "Run self-test" to Settings. The self-test never starts on a
normal launch: only from that item, or when launched with the explicit parameter
`{"selftest": true}`. A release build can also log if `localStorage.sc_debug` and
`localStorage.sc_debug_host` are set.

Install with `ares-install --device <tv> build/<file>.ipk`. On a rooted TV without Developer
Mode, copy the `.ipk` to `/tmp` on the TV and run
`luna-send -n 1 luna://com.webos.appInstallService/dev/install '{"id":"com.ares.defaultName","ipkUrl":"/tmp/<file>.ipk","subscribe":true}'`.

## SoundCloud endpoints

These work with just `client_id`, which is read from `m.soundcloud.com`'s HTML and
refreshed on 401/403: `/search/tracks`, `/search/playlists_without_albums`,
`/search/albums`, `/search/users`, `/resolve`, `/users/{id}`, `/users/{id}/tracks`,
`/toptracks`, `/likes`, `/playlists_without_albums`, `/albums`, `/playlists/{id}`,
`/system-playlists/{urn}`, `/tracks?ids=` (50 per call), `/tracks/{id}/related`,
`/charts?kind=trending&genre=soundcloud:genres:all-music`, `/mixed-selections`, and the
transcoding URL with `track_authorization`. `kind=top` charts, genre charts, `/discover/sets`
and `/users/{id}/reposts` return 404.

Not affiliated with SoundCloud. The icon is a plain cloud, not SoundCloud's logo.

## Status

1.1.0 runs on an LG 75UM7600PLB (webOS TV Lite 4.10.2, Chrome 53). The debug self-test passed on the
TV: playback past 5 s at `aac_160k` through MediaSource, five track switches in a row, debounced
skips, an `aac_96k` track, and autoplay of related tracks when the queue ends, with no faults in the
kernel log. Layout and focus were checked from a captured frame, not yet by long use on the couch.
