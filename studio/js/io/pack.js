// Pack manifest (zaf_pack.json), ModKit setup sheet and README for exported packs.
import { SCENE_KINDS, slug } from '../core/project.js';
import { esc } from '../ui/dom.js';

export const ZAF_VERSION = 1;

/**
 * The manifest is the contract between creators and the in-game runtime ("ZAF"):
 * scenes with actor slots, stages, timing and tags, each pointing at animation assets.
 */
export function buildPackManifest(project, scenes, animations, { skeleton, rootMotion }) {
  const pack = project.pack;
  const packId = slug(pack.id || pack.name, 'pack').toLowerCase();
  return {
    zaf: ZAF_VERSION,
    generator: 'Studio',
    id: packId,
    name: pack.name,
    author: pack.author,
    version: pack.version,
    description: pack.description,
    skeleton,
    rootMotion,
    scenes: scenes.map((s) => ({
      id: `${packId}.${slug(s.name, 'anim').toLowerCase()}`,
      name: s.name,
      kind: s.kind,
      tags: s.tags,
      description: s.description || '',
      inzoi: { ...s.inzoi },
      actors: s.actors.map((a, i) => ({
        slot: i,
        name: a.name,
        gender: a.gender,
        growth: a.growth,
        offset: { x: round(a.offset.x), z: round(a.offset.z), yaw: round(a.offset.yaw) },
      })),
      stages: s.stages.map((st, si) => ({
        index: si,
        name: st.name,
        section: sectionName(s, si),
        fps: st.fps,
        frames: st.frames,
        duration: round(st.frames / st.fps, 4),
        loop: !!st.loop,
        loopCount: st.loop ? (st.loopCount ?? 1) : 1,
        animations: s.actors.map((a) => animations.find((x) => x.scene === s && x.st === st && x.slot === a)?.id || null),
      })),
    })),
    animations: animations.map((a) => ({
      id: a.id,
      // Name of the CharacterAnim row to create in the ModKit; the in-game panel plays this id.
      anim_id: a.id,
      file: a.rel,
      fps: a.clip.fps,
      frames: a.clip.frames,
      duration: round(a.clip.frames / a.clip.fps, 4),
      loop: !!a.st.loop,
      scene: a.scene.name,
      stage: a.st.name,
      actor: a.slot.name,
    })),
  };
}

/** Montage section names used by inZOI's PlayAnim action: Default → Loop → End. */
export function sectionName(scene, si) {
  const n = scene.stages.length;
  if (n === 1) return scene.stages[0].loop ? 'Loop' : 'Default';
  const loopIdx = scene.stages.findIndex((st) => st.loop);
  if (si === loopIdx) return 'Loop';
  if (si < (loopIdx < 0 ? n : loopIdx)) return si === 0 ? 'Default' : `Default${si + 1}`;
  return si === n - 1 ? 'End' : `End${si}`;
}

const round = (v, d = 3) => Math.round((+v || 0) * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------ setup sheet

export function buildSetupSheet(project, manifest) {
  const pack = project.pack;
  const sections = manifest.scenes.map((s) => {
    const kind = SCENE_KINDS[s.kind]?.label || s.kind;
    const totalLen = s.stages.reduce((t, st) => t + st.duration, 0);
    const loopStage = s.stages.find((st) => st.loop);
    const genders = (g) => (g === 'Any' ? ['Female', 'Male'] : [g]);
    const rows = [];
    s.actors.forEach((a, ai) => {
      for (const g of genders(a.gender)) {
        const files = s.stages.map((st) => st.animations[ai]).filter(Boolean).map((id) => manifest.animations.find((x) => x.id === id)?.file || id);
        rows.push(`<tr><td>${esc(a.name)}</td><td>${g}</td><td>${esc(a.growth)}</td><td>${files.map((f) => `<code>${esc(f)}</code>`).join('<br>')}</td></tr>`);
      }
    });
    let steps = '';
    if (s.kind === 'interaction' || s.kind === 'pose') {
      steps = `
        <ol>
          <li>Import the FBX file(s) below onto the <b>Zoi skeleton</b> (one Animation Sequence each).</li>
          <li>Name the Character Animation entry exactly <code>${esc(s.stages.map((st) => st.animations.filter(Boolean).join(', ')).join(' / '))}</code> (one entry per Zoi role) so the Zoi Animation Framework panel can play it.</li>
          <li>Create an <b>Animation Montage</b> from them.${s.stages.length > 1 ? ` Add the stages as montage sections in this order: ${s.stages.map((st) => `<code>${esc(st.section)}</code> (${esc(st.name)})`).join(' → ')}.` : ''}</li>
          <li>In <b>Animation → Character Animation → Interaction</b> set:
            <table class="kv">
              <tr><th>Playing Component Name</th><td>Root</td></tr>
              <tr><th>Start Anim Section</th><td>${esc(s.stages[0].section)}</td></tr>
              <tr><th>Anim Posture Type</th><td>${esc(s.inzoi.posture || 'Stand')}</td></tr>
              <tr><th>Total Play Length</th><td>${round(totalLen, 2)} s</td></tr>
              <tr><th>Loop Play Length</th><td>${loopStage ? round(loopStage.duration, 2) + ' s' : '— (not looping)'}</td></tr>
              <tr><th>Rate Scale</th><td>${s.inzoi.rateScale ?? 1}</td></tr>
            </table>
          </li>
          <li>Add one <b>Anim Info List</b> entry per row of the table below (Gender + Anim Growth Step + Animation).</li>
          ${s.actors.length > 1 ? `<li>This is a <b>${s.actors.length}-Zoi scene</b>: give each Zoi its own animation through a co-op interaction (initiator = ${esc(s.actors[0].name)}, target = ${esc(s.actors[1].name)}). Place the target at X ${s.actors[1].offset.x} m, Z ${s.actors[1].offset.z} m, facing ${s.actors[1].offset.yaw}° relative to the initiator.</li>` : ''}
        </ol>`;
    } else if (s.kind === 'locomotion') {
      steps = `
        <ol>
          <li>Import the FBX onto the <b>Zoi skeleton</b> as an Animation Sequence.</li>
          <li>In <b>Animation → Character Animation → Locomotion</b> pick the Gender and Anim Growth Step below, then either set it as the <b>Idle Anim</b> or add it to <b>Idle Random Anims</b> with:
            <table class="kv">
              <tr><th>Emotion Id</th><td>${esc(s.inzoi.emotionId || '(leave empty)')}</td></tr>
              <tr><th>Emotion Level</th><td>0</td></tr>
              <tr><th>Chance to Play</th><td>${s.inzoi.chanceToPlay ?? 1}</td></tr>
            </table>
          </li>
        </ol>`;
    } else if (s.kind === 'statLocomotion') {
      steps = `
        <ol>
          <li>Import the FBX onto the <b>Zoi skeleton</b> as an Animation Sequence.</li>
          <li>In <b>Animation → Character Animation → Stat Locomotion</b> add an entry:
            <table class="kv">
              <tr><th>Stat Id</th><td>${esc(s.inzoi.statId || '(choose the stat, e.g. Tired)')}</td></tr>
              <tr><th>Stat Value</th><td>${s.inzoi.statValue ?? 0}</td></tr>
              <tr><th>Stat Walk Anim</th><td>this animation (walk cycles)</td></tr>
              <tr><th>Idle Random Anims</th><td>this animation (idles)</td></tr>
            </table>
          </li>
        </ol>`;
    }
    return `
      <section>
        <h2>${esc(s.name)} <span class="tag">${esc(kind)}</span>${s.actors.length > 1 ? ` <span class="tag">${s.actors.length} Zois</span>` : ''}</h2>
        <p class="meta">${s.stages.length} stage${s.stages.length > 1 ? 's' : ''} · ${round(totalLen, 2)} s${s.tags.length ? ' · tags: ' + s.tags.map(esc).join(', ') : ''}</p>
        ${steps}
        <table class="grid"><thead><tr><th>Zoi</th><th>Gender</th><th>Anim Growth Step</th><th>Animation file(s)</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(pack.name)} — ModKit setup sheet</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; --bg:#f6f7fb; --card:#fff; --text:#1c2030; --muted:#5d6580; --line:#e2e5ef; --accent:#5b6cff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f121a; --card:#171b27; --text:#e8ebf5; --muted:#9aa2bb; --line:#2a3044; --accent:#8c9bff; } }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 "Segoe UI", system-ui, sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 32px 18px 60px; }
  h1 { margin: 0 0 4px; font-size: 26px; } h2 { margin: 0 0 4px; font-size: 19px; }
  .meta { color: var(--muted); margin: 0 0 12px; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; margin: 16px 0; }
  .tag { display:inline-block; font-size:12px; font-weight:600; padding:2px 9px; border-radius:99px; background:color-mix(in srgb, var(--accent) 15%, transparent); color:var(--accent); vertical-align:middle; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 14px; }
  .grid th, .grid td { text-align:left; padding: 7px 9px; border-bottom: 1px solid var(--line); }
  .kv { width:auto; } .kv th { text-align:left; color:var(--muted); font-weight:500; padding:3px 18px 3px 0; } .kv td { font-weight:600; }
  code { font: 13px Consolas, monospace; background: color-mix(in srgb, var(--accent) 10%, transparent); padding: 1px 5px; border-radius: 5px; }
  .intro { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 20px; }
  li { margin: 6px 0; }
</style></head>
<body><main>
  <h1>${esc(pack.name)}</h1>
  <p class="meta">${esc(pack.author || '')} · v${esc(pack.version)} · pack id <code>${esc(manifest.id)}</code> · skeleton: ${esc(manifest.skeleton)} · generated by Studio</p>
  <div class="intro">
    <b>How to use this sheet</b>
    <ol>
      <li>Open the <b>inZOI ModKit</b> and create a new mod project.</li>
      <li>Import the FBX files from the <code>Animations</code> folder next to this sheet. Pick the Zoi skeleton when asked (never create a new skeleton).</li>
      <li>For each animation below, follow the steps and copy the values exactly.</li>
      <li>Keep <code>zaf_pack.json</code> with your mod: it describes scenes, stages and actor placement for the Zoi Animation Framework runtime.</li>
      <li>Export the mod (Local or CurseForge) from the ModKit.</li>
    </ol>
  </div>
  ${sections}
</main></body></html>`;
}

export function buildReadme(project, manifest) {
  const p = project.pack;
  const lines = [
    `${p.name} — v${p.version}`,
    `by ${p.author || 'unknown'}`,
    '',
    p.description || '',
    '',
    'Contents',
    '--------',
    '  Animations/              one file per animation, stage and Zoi',
    '  zaf_pack.json            pack manifest (scenes, stages, actor placement, timing, tags)',
    '  ModKit setup sheet.html  step-by-step values to enter in the inZOI ModKit',
    '  Source/*.zmotion         editable project (open in Studio)',
    '',
    'Animations',
    '----------',
    ...manifest.scenes.map((s) => `  ${s.name} (${s.kind}, ${s.actors.length} Zoi${s.actors.length > 1 ? 's' : ''}, ${s.stages.length} stage${s.stages.length > 1 ? 's' : ''})`),
    '',
    'Made with Studio.',
  ];
  return lines.join('\r\n');
}
