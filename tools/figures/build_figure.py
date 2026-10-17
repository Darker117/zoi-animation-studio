"""Builds a rigged posing figure (GLB) from a Human Base Meshes realistic body.

blender -b --factory-startup --disable-autoexec --python build_figure.py -- <bundle.blend> <male|female> <out.glb> <workdir> [mesh_level]
"""
import bpy, sys, os, math, time
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fit_joints import fit_joints, hierarchy, render_overlays

argv = sys.argv[sys.argv.index('--') + 1:]
path, sex, out_glb, work = argv[0], argv[1], argv[2], argv[3]
mesh_level = int(argv[4]) if len(argv) > 4 else 1
t0 = time.time()

bpy.ops.wm.open_mainfile(filepath=path, load_ui=False)
scene = bpy.context.scene
body = bpy.data.objects[f'GEO-body_{sex}_realistic']
eyes = [o for o in body.children if o.type == 'MESH']

# Keep only this body and its eyes, at the world origin.
keep = {body, *eyes}
for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections):
    if not any(o in keep for o in c.all_objects):
        bpy.data.collections.remove(c)
for o in keep:
    if o.name not in scene.collection.objects:
        scene.collection.objects.link(o)
for c in list(scene.collection.children):
    scene.collection.children.unlink(c)
bpy.context.view_layer.update()
shift = Matrix.Translation(-body.matrix_world.translation)
for o in eyes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = shift @ mw
body.matrix_world = shift @ body.matrix_world
for o in keep:
    o.animation_data_clear()
    for m in list(o.modifiers):
        if m.type != 'MULTIRES':
            o.modifiers.remove(m)
bpy.context.view_layer.update()

joints = fit_joints(body)
height = joints.pop('_height').z
print(f'[{time.time() - t0:.0f}s] joints fitted, height {height:.3f} m')

# ---------------------------------------------------------------- material and final subdivision level
mr = [m for m in body.modifiers if m.type == 'MULTIRES'][0]
me = body.data
if me.has_custom_normals:
    with bpy.context.temp_override(object=body, active_object=body):
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
for a in [a.name for a in me.attributes if a.name in ('sharp_face', 'sharp_edge')]:
    me.attributes.remove(me.attributes[a])
for p in me.polygons:
    p.use_smooth = True

mat = bpy.data.materials.new('ZoiFigure')
mat.diffuse_color = (0.68, 0.68, 0.70, 1)
mat.roughness = 0.78
me.materials.clear(); me.materials.append(mat)
mr.levels = mesh_level
with bpy.context.temp_override(object=body, active_object=body):
    bpy.ops.object.modifier_apply(modifier=mr.name)

# ---------------------------------------------------------------- final mesh
for a in [a.name for a in me.attributes if a.name.startswith('.sculpt')]:
    me.attributes.remove(me.attributes[a])
print(f'[{time.time() - t0:.0f}s] mesh level {mesh_level}: {len(me.vertices)} verts, {len(me.polygons)} faces')

# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new('ZoiRig')
arm = bpy.data.objects.new('ZoiFigure', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
for name, parent, tail in hierarchy():
    b = eb.new(name)
    b.head = joints[name]
    b.tail = joints[tail]
    if (b.tail - b.head).length < 0.004:
        b.tail = b.head + Vector((0, 0, 0.004))
    if parent:
        b.parent = eb[parent]
        b.use_connect = False
    # Roll so every bone's local Z points to the front of the body (helps tools that read rolls).
    b.align_roll(Vector((0, -1, 0)) if abs((b.tail - b.head).normalized().y) < 0.9 else Vector((0, 0, 1)))
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- skin
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); arm.select_set(True)
bpy.context.view_layer.objects.active = arm
# Bone heat is more reliable at a larger scale; weight at 10x and scale back.
up = Matrix.Scale(10, 4)
body.data.transform(up); arm.data.transform(up)
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
body.data.transform(up.inverted()); arm.data.transform(up.inverted())
print(f'[{time.time() - t0:.0f}s] automatic weights done')

# Vertices bone heat could not reach get the weights of their nearest weighted neighbour.
from collections import defaultdict
vg_names = {g.index: g.name for g in body.vertex_groups}
def total(v):
    return sum(g.weight for g in v.groups)
unweighted = [v.index for v in me.vertices if total(v) < 1e-4]
if unweighted:
    if len(unweighted) > len(me.vertices) // 2:
        raise RuntimeError(f'automatic weights failed ({len(unweighted)} vertices unweighted)')
    from mathutils.kdtree import KDTree
    good = [v for v in me.vertices if total(v) >= 1e-4]
    kd = KDTree(len(good))
    for i, v in enumerate(good):
        kd.insert(v.co, i)
    kd.balance()
    for vi in unweighted:
        _, i, _ = kd.find(me.vertices[vi].co)
        for g in good[i].groups:
            body.vertex_groups[g.group].add([vi], g.weight, 'REPLACE')
print('unweighted vertices fixed:', len(unweighted))

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.01)
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)

# Eyes ride on the head bone.
for e in eyes:
    e.data.materials.clear(); e.data.materials.append(mat)
    for p in e.data.polygons:
        p.use_smooth = True
    g = e.vertex_groups.new(name='head')
    g.add(list(range(len(e.data.vertices))), 1.0, 'REPLACE')
bpy.ops.object.select_all(action='DESELECT')
for e in eyes:
    e.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = f'ZoiFigure_{sex}_body'
me = body.data
print(f'[{time.time() - t0:.0f}s] final mesh {len(me.vertices)} verts {len(me.polygons)} faces, groups {len(body.vertex_groups)}')

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(work, f'zoi_figure_{sex}.blend'))

# ---------------------------------------------------------------- export
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); body.select_set(True)
bpy.context.view_layer.objects.active = arm
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out_glb, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_animations=False, export_skins=True, export_morph=False, export_texcoords=False, export_normals=True,
    export_tangents=False, export_materials='EXPORT', export_extras=False,
    export_cameras=False, export_lights=False)
print(f'[{time.time() - t0:.0f}s] exported {out_glb} ({os.path.getsize(out_glb) / 1e6:.2f} MB)')

# ---------------------------------------------------------------- deformation check renders
pb = arm.pose.bones
def rot(name, axis, deg):
    b = pb[name]
    b.rotation_mode = 'XYZ'
    r = list(b.rotation_euler); r['XYZ'.index(axis)] += math.radians(deg); b.rotation_euler = r

def world_rotate(name, axis_world, deg):
    """Rotates a pose bone about a world axis through its head."""
    b = pb[name]
    b.rotation_mode = 'QUATERNION'
    bpy.context.view_layer.update()
    M = arm.matrix_world @ b.matrix
    R = Matrix.Rotation(math.radians(deg), 4, Vector(axis_world))
    head = M.translation.copy()
    newM = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ M
    b.matrix = arm.matrix_world.inverted() @ newM
    bpy.context.view_layer.update()

# Arms up to a T pose, a deep knee bend, elbow bend and a fist on the right hand.
for s, sg in (('left', 1), ('right', -1)):
    ua = joints[s + 'UpperArm']; la = joints[s + 'LowerArm']
    ang = math.degrees(math.atan2(ua.z - la.z, abs(la.x - ua.x)))
    world_rotate(s + 'UpperArm', (0, 1, 0), -sg * ang)
world_rotate('leftLowerArm', (0, 0, 1), 95)
world_rotate('rightUpperLeg', (1, 0, 0), 70)
world_rotate('rightLowerLeg', (1, 0, 0), -100)
world_rotate('spine', (1, 0, 0), 15)
world_rotate('neck', (0, 0, 1), 30)
for f in ('Index', 'Middle', 'Ring', 'Little'):
    for part in ('Proximal', 'Intermediate', 'Distal'):
        world_rotate('right' + f + part, (0, 1, 0), 0)
        b = pb['right' + f + part]
        b.rotation_mode = 'XYZ'
        b.rotation_euler = (math.radians(75), 0, 0)
bpy.context.view_layer.update()

scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'SINGLE'
scene.display.shading.single_color = (0.75, 0.75, 0.76)
cam_data = bpy.data.cameras.new('c'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = height * 1.25
cam = bpy.data.objects.new('c', cam_data); scene.collection.objects.link(cam); scene.camera = cam
from mathutils import Euler
for label, loc, rotc in [('front', (0, -4, height * 0.55), (math.pi / 2, 0, 0)),
                         ('three', (3, -3, height * 0.55), (math.pi / 2, 0, math.pi / 4)),
                         ('side', (4, 0, height * 0.55), (math.pi / 2, 0, math.pi / 2))]:
    cam.location = loc; cam.rotation_euler = Euler(rotc)
    scene.render.resolution_x = 1000; scene.render.resolution_y = 1000
    scene.render.filepath = os.path.join(work, f'{sex}_pose_{label}.png')
    bpy.ops.render.render(write_still=True)
print(f'[{time.time() - t0:.0f}s] done')
