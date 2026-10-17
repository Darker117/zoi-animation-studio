# SPDX-License-Identifier: MIT
"""Zoi Motion Bridge: bring Studio (.zmotion) animations onto any armature in Blender
(for example the official inZOI skeleton) and export FBX for the inZOI ModKit (Unreal Engine)."""

bl_info = {
    "name": "Zoi Motion Bridge",
    "author": "Zoi Animation Studio",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar (N) > Zoi Motion",
    "description": "Apply Studio animations to any armature and export FBX for the inZOI ModKit",
    "category": "Animation",
}

if "bpy" in locals():  # support "Reload Scripts"
    import importlib

    for _m in ("rig", "clip", "automap", "retarget", "bake", "ui"):
        if _m in locals():
            importlib.reload(locals()[_m])

import bpy  # noqa: E402,F401

from . import rig, clip, automap, retarget, bake, ui  # noqa: E402,F401


def register():
    ui.register()


def unregister():
    ui.unregister()


if __name__ == "__main__":
    register()
