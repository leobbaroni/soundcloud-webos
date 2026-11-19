# Development notes

How the app works inside, for anyone changing it. For what it is and how to install it, see the
[README](../README.md). Built and tested on an LG 75UM7600PLB (webOS TV Lite 4.10.2, Chromium 53,
1 GB RAM, app resolution 1920x1080).

Plain HTML/CSS/JS in `app/`, no frameworks, no build step, no npm dependencies.

## Using it

- **Screens:** Home (recently played tracks, recent playlists, trending, "more like" your last
  track, likes of the first profile, SoundCloud's curated selections), Search (tracks,
  playlists, albums, artists, in that order; recent searches), Playlist/Album/Station, Artist,
  Your profiles (each linked account's likes, playlists and albums, and tracks, stacked in list
  order), Add a profile, Queue, Settings, and Now playing. A mini-player along the bottom shows
  what's on while you browse.
- **Profiles:** "Add a profile" searches `/search/users` as you type (0.6 s debounce); text that
  looks like a link, or a single word, is also tried with `/resolve` and shown first when it is
  an account. Each account header has Move up / Move down / Remove (Remove asks first). Rows
  load one account at a time, in list order.
- **Remote:** arrows move, OK selects, Back goes up a screen (on Home it asks before exiting).
  Play/Pause/Stop work; FF/RW seek 15 s; on Now playing, Left/Right on the progress bar seek
  10 s. Red opens or closes Now playing. Next/Previous-track keys work when the remote sends
  them. The Magic Remote pointer works too: point to focus, click to select, wheel to scroll.
- **Search:** OK on the search field opens the TV keyboard; results appear as you type.
- **Autoplay:** when the queue ends, similar tracks are added (Settings → Autoplay).
- **Saved on the TV** (localStorage, keys prefixed `sc_`, JSON):

  | Key | Holds |
  |---|---|
  | `cid` | SoundCloud client id |
  | `profiles` | Linked accounts in display order: `[{id, permalink, name, avatar}]` |
  | `recent` | Recently played tracks, newest first, up to 30 |
  | `recent_sets` | Playlists/albums/stations playback was started from, newest first, up to 20: `{kind, id (urn for stations), system, isAlbum, title, subtitle, artwork, trackCount, user: {id, username}, ts}` |
  | `searches` | Recent searches, up to 10 |
  | `settings` | `{shuffle, repeat, autoplay}` |

  Migration from 1.2.0: its single `profile` (`{id, username, name, avatar}`) becomes the only
  entry of `profiles` the first time profiles are read, and `profile` is removed once the list
  is written. Older data without `recent_sets` simply starts with an empty list. Volume is the
  TV's.

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

### End of a track

Once every segment is appended, `hls.js` calls `endOfStream()` and stops trimming the buffer,
and it calls `endOfStream()` again whenever the MediaSource is back in the "open" state. (Up
to 1.2.0 a trim `remove()` after `endOfStream()` reopened the MediaSource, end of stream was
never signalled again, and playback stopped a fraction of a second before the end with no
`ended` event, so the next track never started.)

The player does not rely on `ended` alone. `finish()` runs once per track, on the first of:

- the `ended` event (or `audio.ended` seen by the poll);
- the playhead at or past `duration - 0.3 s` when the duration is finite;
- every segment appended, the playhead within 0.5 s of the end of the buffered range, and not
  moving for 1.5 s.

The last two are checked on `timeupdate` and on a 0.5 s poll, since `timeupdate` stops when
playback stalls. A pause from the remote, a pending load or a finished session never counts.
At the end, `waiting` does not start the 30 s stall watchdog, and if the watchdog does fire
there it finishes the track instead of reporting a stall. Then repeat-one reloads the track,
and otherwise the queue advances (shuffle order, repeat-all, then autoplay). The log line
`track finished <id> via=<detector>` names the detector that fired.

## Files

| File | Purpose |
|---|---|
| `app/index.html` | Shell: icon sprite, side rail, mini-player, script order |
| `app/css/app.css` | 10-foot dark theme, focus states (Chromium 53-safe CSS) |
| `app/js/config.js` | Build settings: debug beacon, debug host, self-test button (all off) |
| `app/js/core.js` | Storage, debug log/beacon, DOM helpers (`SC.text` display-text normaliser), lazy images, toasts |
| `app/js/api.js` | api-v2 client: client id, endpoints, data normalisation |
| `app/js/nav.js` | Spatial focus for the remote, pointer, transform-based scrolling (see "Scrolling") |
| `app/js/hls.js` | fMP4 HLS through MediaSource |
| `app/js/player.js` | Queue, shuffle/repeat, autoplay, load gating, watchdogs, end-of-track detection |
| `app/js/views.js` | Cards, rows, track lists and the screens |
| `app/js/main.js` | Screen stack and Back, mini-player, Now playing, keys, boot |
| `app/js/selftest.js` | Debug packages only: drives the app and reports via the beacon |
| `app/fonts/` | Subset monochrome Noto fallback fonts (WOFF) for symbols and emoji, with their OFL texts |
| `build.py` | Packs `app/` into an `.ipk` |

## Scrolling

Screens scroll with a transform on `[data-scroll="y"]`. When focus moves, `nav.js` picks the
resting offset from the scroller's `.vis` blocks (rows, list rows, headers, notes), measured
by their content. The top edge never falls inside a block, so no line of text is left cut at
the top. The focused block always shows. Among the offsets that allow this, it prefers at least
40 px above the first visible block, then a bottom edge that does not cut a row title or a list
row, then the offset closest to plain "keep it in view". With evenly spaced list rows and the
mini-player up, the bottom edge cannot always fall in a gap, so a list row may still show cut
at the bottom.

Spatial focus stays inside the current area (rail, screen, mini-player) while that area has
something in the pressed direction. A row scrolled below the fold is reached before the
mini-player that covers it.

## Fancy titles, symbols and emoji

The TV has few system fonts, so styled titles would draw as empty squares. Two layers:

- `SC.text(s)` (core.js) is applied to all API text shown on screen (`SC.el` text, toasts, Now playing,
  mini-player). It applies NFKC (mathematical, full-width, enclosed and circled letters become plain
  letters), maps small capitals and squared/negative-circled/negative-squared Latin letters to ASCII,
  strips zero-width, bidi and soft-hyphen characters, keeps U+FE0F and ZWJ only inside emoji
  sequences, collapses whitespace, and caches up to 500 results. Never use it on anything sent to the API.
- `app/fonts/` holds monochrome outline fonts (Chromium 53 cannot use colour emoji fonts). `@font-face`
  rules in `app.css` use `unicode-range`, so a file is only loaded when a matching character is shown.
  They sit after the normal text fonts in the `font-family` stack.

| File | Covers | Source | License |
|---|---|---|---|
| `NotoEmoji-Regular.woff` (563 KB) | Emoji and pictographs, ZWJ/flag/tag sequences | Static Regular (wght=400) instanced with fontTools from [`ofl/notoemoji/NotoEmoji[wght].ttf`](https://github.com/google/fonts/blob/main/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf) (google/fonts, only a variable file exists), subset | SIL OFL 1.1, `OFL-NotoEmoji.txt` |
| `NotoSansSymbols2-Regular.woff` (146 KB) | Letterlike, arrows, technical, geometric shapes, misc symbols, dingbats, cards/mahjong | [`ofl/notosanssymbols2/NotoSansSymbols2-Regular.ttf`](https://github.com/google/fonts/blob/main/ofl/notosanssymbols2/NotoSansSymbols2-Regular.ttf), subset | SIL OFL 1.1, `OFL-NotoSansSymbols2.txt` |
| `NotoSansSymbols-Regular.woff` (13 KB) | Musical notes U+2669-266F, circled digits U+2460-24FF, U+2776-2793 | Static Regular (wght=400) instanced from [`ofl/notosanssymbols/NotoSansSymbols[wght].ttf`](https://github.com/google/fonts/blob/main/ofl/notosanssymbols/NotoSansSymbols%5Bwght%5D.ttf), subset | SIL OFL 1.1, `OFL-NotoSansSymbols.txt` |

Rebuild recipe: `fonttools varLib.instancer --no-overlap-flag <var>.ttf wght=400` (Chromium 53 rejects a font whose glyphs set the overlap flags, and drop the `STAT` table), then `pyftsubset --unicodes=<ranges from app.css>
--layout-features='*' --no-hinting --flavor=woff`. Noto Sans Math is not bundled: NFKC folds the
mathematical alphabets to plain letters, so it is not needed.

## Build and install

```sh
python build.py                                  # build/local.soundcloud.tv_1.3.0_all.ipk
python build.py --debug http://<pc-ip>:<port>    # build/local.soundcloud.tv_1.3.0_all-debug.ipk
```

The release package ships with the beacon off, an empty debug host and no `selftest.js`. The
debug package sends log lines to `http://<pc-ip>:<port>/probe?<line>` (any static server's
request log will do) and adds "Run self-test" to Settings. The self-test never starts on a
normal launch: only from that item, or when launched with the explicit parameter
`{"selftest": true}` (add `"until": "<step>"` to stop after a step, or `"only": "<step>,<step>"`
to run just those). A release build can also log if `localStorage.sc_debug` and
`localStorage.sc_debug_host` are set.

Self-test steps, in order: `home`, `keys`, `search`, `playlist`, `play5s`, `switch5`, `rapid`,
`seekkeys`, `aac96`, `autoplay`, `natural-end`, `nowplaying`, `profile-api`, `back-home`.
`natural-end` plays three normal-length tracks from a "lofi chill" playlist. It buffers each
track's tail (seeks to 90 s before the end and waits for every segment), then seeks inside the
buffer to 6 s before the end and lets the track finish by itself. The next queue item must
start and play past 3 s within 20 s. This happens twice, and the beacon reports
`ST NATURAL-END 1 OK` / `ST NATURAL-END 2 OK`, or `FAIL` with currentTime, duration, buffered
end, readyState, the ended flag, the MediaSource state and the detector that fired.

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

## Tested

On an LG 75UM7600PLB (webOS TV Lite 4.10.2, Chromium 53), the debug self-test passed: playback past
5 s at `aac_160k` through MediaSource, five track switches in a row, debounced skips, an `aac_96k`
track, and autoplay of related tracks when the queue ends, with no faults in the kernel log. The
three bundled fonts load there and the samples in "Fancy titles, symbols and emoji" draw. Other TVs
and webOS versions are untested.

1.3.0 was run there too: the full self-test including `natural-end` (two tracks in a row left to
finish, the next one starting by itself each time, detected by `via=duration`), adding a profile by
name search, and the Home rows refreshing without a restart.
