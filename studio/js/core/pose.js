// Whole-pose helpers.
import { mirrorName } from './rig.js';
import { qMirrorX } from './math.js';

/** Mirrors a captured pose left <-> right (hips mirrored around the actor's rest position). */
export function mirrorPose(pose, actor) {
  const out = { rot: {}, pos: {}, expr: pose.expr };
  for (const [b, q] of Object.entries(pose.rot)) out.rot[mirrorName(b)] = qMirrorX(q);
  if (pose.pos.hips) {
    const rest = actor.rest.hips;
    out.pos.hips = [rest.x - (pose.pos.hips[0] - rest.x), pose.pos.hips[1], pose.pos.hips[2]];
  }
  return out;
}
