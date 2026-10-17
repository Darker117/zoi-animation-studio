# SPDX-License-Identifier: MIT
"""Rebuilds zoi_motion_bridge.zip (the add-on folder inside the zip) next to this script.

Usage:  python build_zip.py
"""

import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "zoi_motion_bridge")
OUT = os.path.join(HERE, "zoi_motion_bridge.zip")


def main():
    files = []
    for root, dirs, names in os.walk(SRC):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__" and not d.startswith("."))
        for n in sorted(names):
            if n.endswith((".pyc", ".pyo")) or n.startswith("."):
                continue
            full = os.path.join(root, n)
            files.append((full, os.path.join("zoi_motion_bridge", os.path.relpath(full, SRC)).replace(os.sep, "/")))
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for full, arc in files:
            z.write(full, arc)
    print(f"Wrote {OUT} ({len(files)} files)")
    for _, arc in files:
        print("  " + arc)


if __name__ == "__main__":
    main()
