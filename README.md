# SoundCloud for LG webOS TVs

A small webOS app that opens SoundCloud full screen on an LG TV. SoundCloud has no LG app, and
its site refuses to be framed, so the app hands the whole window to `soundcloud.com/discover`.
Built and tested on an LG 75UM7600PLB (webOS TV Lite 4.10.2, Chrome 53), where SoundCloud
serves its mobile site.

- **Remote:** use the Magic Remote pointer to click; Back steps back through SoundCloud's pages.
- **No ads:** the app itself adds nothing. On a rooted TV, block SoundCloud's ad servers in
  `/etc/hosts` (AdsWizz, `pubads.g.doubleclick.net`, `imasdk.googleapis.com`).

## Build and install

```sh
python build.py                     # makes build/local.soundcloud.tv_1.0.0_all.ipk
ares-install --device <tv> build/local.soundcloud.tv_1.0.0_all.ipk
```

On a rooted TV without Developer Mode, copy the `.ipk` to `/tmp` on the TV and run
`luna-send -n 1 luna://com.webos.appInstallService/dev/install '{"id":"com.ares.defaultName","ipkUrl":"/tmp/<file>.ipk","subscribe":true}'`
from a terminal.

Not affiliated with SoundCloud. The icon is a plain cloud, not SoundCloud's logo.
