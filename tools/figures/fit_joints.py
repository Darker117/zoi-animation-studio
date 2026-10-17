"""Finds the Zoi skeleton's joint positions on a Blender Studio Human Base Meshes body.

The realistic bodies carry sculpt face sets that split the body into anatomical parts
(upper arm, forearm, palm, every finger and toe segment...). Most joints are the centre of the
border loop between two neighbouring parts; the rest (hip, spine, clavicle, thumb base) follow
anatomical proportions. Everything is fitted on the left side and mirrored, so the rig is symmetric.

Coordinates are Blender's: metres, +Z up, the body faces -Y, the body's left is +X.
"""
from collections import defaultdict
from mathutils import Vector

# Spine heights as fractions between the hip joints and the base of the neck (default inZOI body).
SPINE_RATIOS = {'hips': 0.0894, 'spine': 0.2065, 'chest': 0.4607, 'upperChest': 0.7025}
FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little']


def fit_joints(body):
    me = body.data
    M = body.matrix_world
    co = [M @ v.co for v in me.vertices]
    fs = me.attributes['.sculpt_face_set']
    face_set = [fs.data[i].value for i in range(len(me.polygons))]

    faces_of = defaultdict(list)
    verts_of = defaultdict(set)
    for p in me.polygons:
        faces_of[face_set[p.index]].append(p.index)
        verts_of[face_set[p.index]].update(p.vertices)
    edge_faces = defaultdict(list)
    for p in me.polygons:
        for ek in p.edge_keys:
            edge_faces[ek].append(p.index)
    border = defaultdict(set)
    for ek, fl in edge_faces.items():
        if len(fl) == 2 and face_set[fl[0]] != face_set[fl[1]]:
            border[frozenset((face_set[fl[0]], face_set[fl[1]]))].update(ek)
    adj = defaultdict(set)
    for k in border:
        a, b = tuple(k)
        adj[a].add(b); adj[b].add(a)

    def centroid(ids):
        ids = list(ids)
        s = Vector()
        for i in ids:
            s += co[i]
        return s / max(1, len(ids))

    def ring(a, b):
        ids = border.get(frozenset((a, b)))
        if not ids:
            raise RuntimeError(f'no border between face sets {a} and {b}')
        return centroid(ids)

    cen = {s: centroid(verts_of[s]) for s in faces_of}
    height = max(v.z for v in co)
    big = [s for s in faces_of if len(faces_of[s]) >= 100]
    head = max((s for s in big if len(faces_of[s]) > 1000), key=lambda s: cen[s].z)
    torso = max((s for s in big if abs(cen[s].x) < 0.05 and s != head), key=lambda s: len(faces_of[s]))
    center_sets = [s for s in big if abs(cen[s].x) < 0.05]

    lat = [s for s in big if cen[s].x > 0.05]
    arm = sorted((s for s in lat if 0.7 < cen[s].z < 0.8 * height and head not in adj[s]), key=lambda s: -cen[s].z)
    upper, fore, hand = arm[:3]
    lower = [s for s in lat if 0.1 < cen[s].z < 0.5 and cen[s].z < cen[fore].z][0]
    foot = [s for s in adj[lower] if s in lat and cen[s].z < 0.1][0]
    fore_foot = [s for s in adj[foot] if s != lower and len(faces_of[s]) >= 100][0]
    thigh = [s for s in adj[lower] if s != foot and cen[s].z > 0.4 and cen[s].x > 0][0]

    J = {}
    J['UpperArm'] = ring(upper, torso)
    J['LowerArm'] = ring(upper, fore)
    J['Hand'] = ring(fore, hand)
    J['LowerLeg'] = ring(thigh, lower)
    J['Foot'] = ring(lower, foot)

    # Glenohumeral joint: the armhole loop sags into the armpit, so lift it into the deltoid cap.
    ua = J['UpperArm']
    cap = [co[i] for i in verts_of[upper] if abs(co[i].z - ua.z) < 0.015]
    lateral = max(v.x for v in cap)
    J['UpperArm'] = Vector((max(ua.x, lateral - 0.048), ua.y, ua.z + 0.014))

    # ---- fingers: chains of small face sets hanging off the palm
    level = {hand: 0}
    frontier = [hand]
    while frontier:
        nxt = []
        for s in frontier:
            for t in adj[s]:
                if t not in level and len(faces_of[t]) < 100:
                    level[t] = level[s] + 1
                    nxt.append(t)
        frontier = nxt
    chains = []
    for r in (s for s, l in level.items() if l == 1):
        chain = [r]
        while len(chain) < 3:
            cand = [t for t in adj[chain[-1]] if level.get(t) == level[chain[-1]] + 1]
            if not cand:
                break
            chain.append(max(cand, key=lambda t: len(faces_of[t])))
        tips = [t for t in adj[chain[-1]] if level.get(t, 0) > level[chain[-1]]]
        j = [ring(hand, chain[0]), ring(chain[0], chain[1]), ring(chain[1], chain[2])]
        tv = set(verts_of[chain[2]])
        for t in tips:
            tv |= verts_of[t]
        d = (j[2] - j[1]).normalized()
        far = max((co[i] for i in tv), key=lambda v: (v - j[2]).dot(d))
        chains.append({'j': j, 'tip': j[2] + d * (far - j[2]).dot(d)})
    wrist = J['Hand']
    thumb = min(chains, key=lambda f: (f['j'][0] - wrist).length)
    others = sorted((f for f in chains if f is not thumb), key=lambda f: (f['j'][0] - thumb['j'][0]).length)
    by_name = dict(zip(FINGERS, [thumb] + others))

    # Palm normal: the palm faces the thigh in the A pose (toward -X on the left side).
    idx, lit, mid = by_name['Index']['j'][0], by_name['Little']['j'][0], by_name['Middle']['j'][0]
    palm_n = (mid - wrist).normalized().cross((idx - lit).normalized()).normalized()
    if palm_n.x > 0:
        palm_n = -palm_n

    for name, f in by_name.items():
        j1, j2, j3 = f['j']
        if name == 'Thumb':
            # The thumb's face sets start at its knuckle; the VRM thumb root is the base of the
            # metacarpal, close to the wrist inside the ball of the thumb.
            J['ThumbProximal'] = wrist.lerp(j1, 0.32) + palm_n * 0.006
            J['ThumbIntermediate'] = j1.lerp(j2, 0.5)
            J['ThumbDistal'] = j3
        else:
            # Knuckle loops sit on the finger web; the joint itself is a little toward the wrist.
            d = (j2 - j1).normalized()
            J[name + 'Proximal'] = j1 - d * 0.007
            J[name + 'Intermediate'] = j2
            J[name + 'Distal'] = j3
        J[name + 'Tip'] = f['tip']

    # ---- toes: one joint at the ball of the foot
    toe_sets = [t for t in adj[fore_foot] if t != foot]
    tv = set()
    for t in toe_sets:
        tv |= border[frozenset((fore_foot, t))]
    ball = centroid(tv).lerp(ring(foot, fore_foot), 0.5)
    J['Toes'] = ball
    allt = set()
    for t in toe_sets:
        allt |= verts_of[t]
    J['ToesTip'] = Vector((ball.x, min(co[i].y for i in allt), ball.z))

    # ---- hip joint: thigh axis extrapolated up to ~52% of stature, centred in the pelvis depth
    pelvis_verts = set()
    for s in center_sets:
        pelvis_verts |= verts_of[s]
    knee = J['LowerLeg']
    crotch_z = min(co[i].z for i in pelvis_verts)
    sl = [co[i] for i in verts_of[thigh] if abs(co[i].z - (crotch_z - 0.03)) < 0.012]
    top = sum(sl, Vector()) / len(sl)
    hip_z = 0.52 * height
    hip = knee.lerp(top, (hip_z - knee.z) / (top.z - knee.z))
    band = [co[i] for i in pelvis_verts if abs(co[i].z - hip_z) < 0.01 and abs(co[i].x) < 0.06]
    ymid = (min(v.y for v in band) + max(v.y for v in band)) / 2
    J['UpperLeg'] = Vector((hip.x, ymid - 0.005, hip_z))

    # ---- mirror to the right side
    out = {}
    for k, v in J.items():
        out['left' + k] = v.copy()
        out['right' + k] = Vector((-v.x, v.y, v.z))

    # ---- spine, neck, head
    torso_verts = set(pelvis_verts) | verts_of[head]

    def slice_y(z, xmax, back=0.1):
        ys = [co[i].y for i in torso_verts if abs(co[i].z - z) < 0.01 and abs(co[i].x) < xmax]
        lo, hi = min(ys), max(ys)
        return (lo + hi) / 2 + back * (hi - lo)

    neck_z = ring(torso, head).z
    span = neck_z - hip_z
    for n, r in SPINE_RATIOS.items():
        z = hip_z + r * span
        out[n] = Vector((0, slice_y(z, 0.2), z))
    out['neck'] = Vector((0, slice_y(neck_z, 0.09), neck_z))
    ears = [s for s in adj[head] if 150 < len(faces_of[s]) < 300 and abs(cen[s].x) > 0.05]
    ear_bottom = min(min(co[i].z for i in verts_of[s]) for s in ears)
    head_z = ear_bottom + 0.005
    out['head'] = Vector((0, slice_y(head_z - 0.035, 0.07) + 0.004, head_z))
    out['headTop'] = Vector((0, out['head'].y, height))

    # ---- clavicles (VRM style: from beside the neck out to the shoulder joint)
    for side in ('left', 'right'):
        u = out[side + 'UpperArm']
        out[side + 'Shoulder'] = Vector((u.x * 0.167, u.y, u.z + abs(u.x) * 0.119))
    out['_height'] = Vector((0, 0, height))
    return out


def hierarchy():
    """Canonical hierarchy (rig.js) as (bone, parent, key of the joint the bone points at)."""
    H = [('hips', None, 'spine'), ('spine', 'hips', 'chest'), ('chest', 'spine', 'upperChest'),
         ('upperChest', 'chest', 'neck'), ('neck', 'upperChest', 'head'), ('head', 'neck', 'headTop')]
    for s in ('left', 'right'):
        H += [(s + 'Shoulder', 'upperChest', s + 'UpperArm'), (s + 'UpperArm', s + 'Shoulder', s + 'LowerArm'),
              (s + 'LowerArm', s + 'UpperArm', s + 'Hand'), (s + 'Hand', s + 'LowerArm', s + 'MiddleProximal')]
        for f in FINGERS:
            H += [(s + f + 'Proximal', s + 'Hand', s + f + 'Intermediate'),
                  (s + f + 'Intermediate', s + f + 'Proximal', s + f + 'Distal'),
                  (s + f + 'Distal', s + f + 'Intermediate', s + f + 'Tip')]
        H += [(s + 'UpperLeg', 'hips', s + 'LowerLeg'), (s + 'LowerLeg', s + 'UpperLeg', s + 'Foot'),
              (s + 'Foot', s + 'LowerLeg', s + 'Toes'), (s + 'Toes', s + 'Foot', s + 'ToesTip')]
    return H


def render_overlays(body, out, prefix, shots_for=('front', 'side', 'hand', 'handfront', 'foot')):
    """Renders the body, then the skeleton alone, and composites the skeleton over the body."""
    import bpy, bmesh, math
    import numpy as np
    from mathutils import Euler, Matrix
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'OBJECT'
    hidden = [o for o in scene.objects if not o.hide_render and o is not body]
    for o in hidden:
        o.hide_render = True
    body.color = (0.75, 0.75, 0.75, 1)
    height = max((body.matrix_world @ v.co).z for v in body.data.vertices)
    dot = bpy.data.meshes.new('dot')
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1); bm.to_mesh(dot); bm.free()
    stick = bpy.data.meshes.new('stick')
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=1, radius2=0.35, depth=1); bm.to_mesh(stick); bm.free()
    stick.transform(Matrix.Translation((0, 0, 0.5)))
    skel = []
    for name, parent, tail in hierarchy():
        h = out[name]; t = out[tail]
        small = any(f in name for f in FINGERS) or 'Toes' in name
        col = (1.0, 0.42, 0.08, 1) if not name.startswith('right') else (0.15, 0.85, 0.95, 1)
        d = bpy.data.objects.new('D_' + name, dot); d.location = h; d.scale = [0.004 if small else 0.009] * 3
        s = bpy.data.objects.new('S_' + name, stick)
        v = t - h
        s.location = h
        s.rotation_mode = 'QUATERNION'
        s.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(v.normalized())
        w = 0.0025 if small else 0.006
        s.scale = (w, w, v.length)
        for o in (d, s):
            o.color = col
            scene.collection.objects.link(o); skel.append(o)
    cam_data = bpy.data.cameras.new('c'); cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new('c', cam_data); scene.collection.objects.link(cam); scene.camera = cam
    lh = out['leftHand']; lf = out['leftFoot']
    shots = {
        'front': ((0, -4, height / 2), (math.pi / 2, 0, 0), height * 1.06, 760, 1000),
        'side': ((4, 0, height / 2), (math.pi / 2, 0, math.pi / 2), height * 1.06, 760, 1000),
        'hand': ((lh.x + 2, lh.y - 0.03, lh.z - 0.08), (math.pi / 2, 0, math.pi / 2), 0.22, 700, 700),
        'handfront': ((lh.x - 0.01, -2, lh.z - 0.08), (math.pi / 2, 0, 0), 0.22, 700, 700),
        'foot': ((lf.x + 2, lf.y - 0.06, 0.07), (math.pi / 2, 0, math.pi / 2), 0.30, 700, 500),
    }
    outdir = prefix.rsplit('/', 1)[0]
    for label in shots_for:
        loc, rot, scale, rx, ry = shots[label]
        cam.location = loc; cam.rotation_euler = Euler(rot); cam_data.ortho_scale = scale
        scene.render.resolution_x = rx; scene.render.resolution_y = ry
        scene.render.film_transparent = False
        for o in skel: o.hide_render = True
        body.hide_render = False
        scene.render.filepath = f'{outdir}/_a.png'
        bpy.ops.render.render(write_still=True)
        for o in skel: o.hide_render = False
        body.hide_render = True
        scene.render.film_transparent = True
        scene.render.filepath = f'{outdir}/_b.png'
        bpy.ops.render.render(write_still=True)
        a = bpy.data.images.load(f'{outdir}/_a.png'); b = bpy.data.images.load(f'{outdir}/_b.png')
        A = np.array(a.pixels[:]).reshape(-1, 4); B = np.array(b.pixels[:]).reshape(-1, 4)
        al = B[:, 3:4] * 0.9
        A[:, :3] = A[:, :3] * (1 - al) + B[:, :3] * al
        a.pixels[:] = A.ravel()
        a.filepath_raw = f'{prefix}_{label}.png'; a.file_format = 'PNG'; a.save()
        bpy.data.images.remove(a); bpy.data.images.remove(b)
    body.hide_render = False
    for o in skel:
        bpy.data.objects.remove(o)
    for o in hidden:
        o.hide_render = False


if __name__ == '__main__':
    import bpy, sys, json
    argv = sys.argv[sys.argv.index('--') + 1:]
    path, sex, outdir = argv[0], argv[1], argv[2]
    bpy.ops.wm.open_mainfile(filepath=path, load_ui=False)
    body = bpy.data.objects[f'GEO-body_{sex}_realistic']
    body.location = (0, 0, 0)
    bpy.context.view_layer.update()
    out = fit_joints(body)
    out.pop('_height')
    with open(f'{outdir}/joints_{sex}.json', 'w') as f:
        json.dump({k: [round(c, 5) for c in v] for k, v in out.items()}, f, indent=1)
    for k in sorted(out):
        if not k.startswith('right'):
            print(k, [round(c, 4) for c in out[k]])
    for m in body.modifiers:
        if m.type == 'MULTIRES':
            m.render_levels = 2
    for o in bpy.data.objects:
        o.hide_render = o is not body
    render_overlays(body, out, f'{outdir}/{sex}_skel')
