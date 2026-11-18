"""Pack app/ as a webOS .ipk: build/<id>_<version>_all.ipk. No LG tools needed.

The packer follows the one in couch-tv's lg/build.py (MIT), which LG TVs from webOS 4 to 10 accept.
"""
import io
import json
import os
import tarfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "app")
OUT = os.path.join(HERE, "build")


def tar_gz(entries):
    """entries: (name in the archive, bytes, or None for a folder), in a fixed order."""
    buf = io.BytesIO()
    now = int(time.time())
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as t:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.mtime, info.uid, info.gid, info.uname, info.gname = now, 0, 0, "root", "root"
            if data is None:
                info.type, info.mode = tarfile.DIRTYPE, 0o755
                t.addfile(info)
            else:
                info.size, info.mode = len(data), 0o644
                t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def ar(members):
    """A System V "ar" archive, the outer layer of an .ipk."""
    out = [b"!<arch>\n"]
    now = str(int(time.time())).encode()
    for name, data in members:
        out.append(name.encode().ljust(16) + now.ljust(12) + b"0".ljust(6) + b"0".ljust(6)
                   + b"100644".ljust(8) + str(len(data)).encode().ljust(10) + b"\x60\n")
        out.append(data)
        if len(data) % 2:
            out.append(b"\n")
    return b"".join(out)


def main():
    with open(os.path.join(APP, "appinfo.json"), encoding="utf-8") as f:
        info = json.load(f)
    app_id, version = info["id"], info["version"]
    entries, size = [], 0
    for d in ("usr", "usr/palm", "usr/palm/applications", "usr/palm/packages",
              f"usr/palm/applications/{app_id}", f"usr/palm/packages/{app_id}"):
        entries.append((d + "/", None))
    for dirpath, dirnames, names in os.walk(APP):
        dirnames.sort()
        rel = os.path.relpath(dirpath, APP)
        rel = "" if rel == "." else rel.replace(os.sep, "/") + "/"
        if rel:
            entries.append((f"usr/palm/applications/{app_id}/{rel}", None))
        for n in sorted(names):
            with open(os.path.join(dirpath, n), "rb") as f:
                data = f.read()
            size += len(data)
            entries.append((f"usr/palm/applications/{app_id}/{rel}{n}", data))
    pkginfo = json.dumps({"id": app_id, "version": version, "app": app_id}, indent=2).encode() + b"\n"
    entries.append((f"usr/palm/packages/{app_id}/packageinfo.json", pkginfo))
    control = "\n".join([
        f"Package: {app_id}", f"Version: {version}", "Section: misc", "Priority: optional",
        "Architecture: all", f"Installed-Size: {size}", "Maintainer: N/A <nobody@example.com>",
        "Description: SoundCloud on the TV.", "webOS-Package-Format-Version: 2",
        "webOS-Packager-Version: x.y.x"]) + "\n"
    os.makedirs(OUT, exist_ok=True)
    ipk = os.path.join(OUT, f"{app_id}_{version}_all.ipk")
    with open(ipk, "wb") as f:
        f.write(ar([("debian-binary", b"2.0\n"),
                    ("control.tar.gz", tar_gz([("control", control.encode())])),
                    ("data.tar.gz", tar_gz(entries))]))
    print("built", os.path.relpath(ipk, HERE))


if __name__ == "__main__":
    main()
