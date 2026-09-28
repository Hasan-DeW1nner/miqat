#!/usr/bin/env python3
"""Build Miqat's install and share icons from the original 1280px artwork.

The crop keeps the complete blue-and-gold icon, its shadow and the small Miqat
wordmark while removing excess poster margin. macOS ImageIO, through `sips`,
provides high-quality downsampling instead of the old nearest-neighbour pass.

    python3 scripts/make-icons.py
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "miqat-icon-original.jpg"
PUBLIC = ROOT / "public"

# Source bounds: x=125..1155, y=130..1160. This keeps the complete icon and
# the Miqat wordmark while making the artwork as large as possible in the tile.
CROP_SIZE = 1030
CROP_Y = 130
CROP_X = 125

TARGETS = {
    "icon-1024.png": 1024,
    "icon-512.png": 512,
    "icon-192.png": 192,
    "miqat-gold-clock-1024-20260928.png": 1024,
    "miqat-gold-clock-512-20260928.png": 512,
    "miqat-gold-clock-192-20260928.png": 192,
    "apple-touch-icon.png": 180,
    "apple-touch-icon-180x180.png": 180,
    "apple-touch-icon-180x180-precomposed.png": 180,
    "apple-touch-icon-precomposed.png": 180,
    "apple-touch-icon-167x167.png": 167,
    "apple-touch-icon-152x152.png": 152,
    "apple-touch-icon-120x120.png": 120,
    "favicon-32.png": 32,
}


def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing source artwork: {SOURCE}")
    if not shutil.which("sips"):
        raise SystemExit("sips is required to build the macOS/iOS icon set")

    with tempfile.TemporaryDirectory(prefix="miqat-icons-") as temp:
        master = Path(temp) / "master.png"
        run(
            "sips",
            "-c", str(CROP_SIZE), str(CROP_SIZE),
            "--cropOffset", str(CROP_Y), str(CROP_X),
            "-s", "format", "png",
            str(SOURCE),
            "--out", str(master),
        )

        for name, size in TARGETS.items():
            target = PUBLIC / name
            run("sips", "-z", str(size), str(size), "-s", "format", "png", str(master), "--out", str(target))
            print(f"wrote {name} at {size}px")

    shutil.copyfile(PUBLIC / "icon-1024.png", PUBLIC / "miqat-share-20260909.png")
    print("wrote miqat-share-20260909.png at 1024px")


if __name__ == "__main__":
    main()
