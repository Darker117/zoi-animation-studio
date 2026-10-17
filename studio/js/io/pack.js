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
    // Anim Info List entries as inZOI's own rows use them: Adult and Teen share the Adult entries,
    // children use Gender "Default" with Anim Growth Step "Youth".
    const genders = (a) => (a.growth === 'Child' ? ['Default'] : a.gender === 'Any' ? ['Female', 'Male'] : [a.gender]);
    const growthStep = (a) => (a.growth === 'Child' ? 'Youth' : 'Adult');
    const fileOf = (id) => manifest.animations.find((x) => x.id === id)?.file || id;
    const table = (head, body) => `<div class="scroll"><table class="grid"><thead><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`;
    // The Zoi Animation Studio mod plays one Character Animation entry per stage and Zoi, named after its id.
    const entries = [];
    s.stages.forEach((st) => st.animations.forEach((id, ai) => {
      if (!id) return;
      const a = s.actors[ai];
      const plays = st.loop ? st.loopCount : 1;
      const total = plays === -1 ? `${round(st.duration, 2)} s (loops until stopped)` : `${round(st.duration * Math.max(1, plays), 2)} s`;
      entries.push(`<tr><td><code>${esc(id)}</code></td><td>${esc(a.name)}</td><td>${esc(st.name)}</td><td>${st.loop ? 'yes' : 'no'}</td><td>${genders(a).join(', ')}</td><td>${growthStep(a)}</td><td>${total}</td><td>${st.loop ? round(st.duration, 2) + ' s' : '—'}</td></tr>`);
    }));
    const rows = [];
    s.actors.forEach((a, ai) => {
      for (const g of genders(a)) {
        const files = s.stages.map((st) => st.animations[ai]).filter(Boolean).map(fileOf);
        rows.push(`<tr><td>${esc(a.name)}</td><td>${g}</td><td>${growthStep(a)}</td><td>${files.map((f) => `<code>${esc(f)}</code>`).join('<br>')}</td></tr>`);
      }
    });
    const ids = s.stages.flatMap((st) => st.animations.filter(Boolean));
    const panelStep = `<li>Optional: to play it from the Zoi Animation Studio mod's Animations panel too, make an <b>Animation Montage</b> from it and create a <b>Character Animation (Interaction)</b> entry named exactly <code>${esc(ids.join(', '))}</code>, set up the way the sheet describes for interactions.</li>`;
    let steps = '';
    if (s.kind === 'interaction' || s.kind === 'pose') {
      steps = `
        <ol>
          <li>Import the file of every entry in the table (<code>Animations/&lt;Entry name&gt;.fbx</code>) onto the <b>inZOI template skeleton</b>: in the import options set <b>Skeleton</b> to the Zoi skeleton and keep animation import on. Each file becomes an <b>Animation Sequence</b>.</li>
          <li>Make an <b>Animation Montage</b> from each sequence (right-click it → Create → AnimMontage) and keep its single <code>Default</code> section.${s.stages.some((st) => st.loop) ? ' For entries marked <b>Loops</b>, add a notify track named <code>Loop</code> with <code>B1AnimNotify_LoopStart</code> at 0 s and <code>B1AnimNotify_LoopEnd</code> just before the end, the way inZOI\'s own looping montages are marked.' : ''}</li>
          <li>In the ModKit's Data Editor, add one <b>Character Animation (Interaction)</b> row per entry (table <code>AnimCharacter_Interaction</code>; duplicating an existing interaction such as <code>Self_Angry</code> works) and set its Id to <b>exactly</b> the <b>Entry name</b>. The Zoi Animation Studio mod plays animations by these names, one stage at a time.</li>
          <li>Set each entry up like this:
            <table class="kv">
              <tr><th>Playing Component Name</th><td>Root</td></tr>
              <tr><th>Start Anim Section</th><td>Default</td></tr>
              <tr><th>Stop Other Component on Finish</th><td>off</td></tr>
              <tr><th>Character Anim Config List</th><td>one element:</td></tr>
              <tr><th class="in1">Anim Posture Type</th><td>${esc(s.inzoi.posture || 'Stand')}</td></tr>
              <tr><th class="in1">Anim Body Parts, Grab Parts, Slot Direction</th><td>None</td></tr>
              <tr><th class="in1">Anim Info List</th><td>one entry per Gender in the row:</td></tr>
              <tr><th class="in2">Gender, Anim Growth Step</th><td>from the table</td></tr>
              <tr><th class="in2">Animation</th><td>the montage made from the entry's file</td></tr>
              <tr><th class="in2">Total Play Length, Loop Play Length</th><td>filled in by the ModKit when you pick the montage; check them against the table</td></tr>
              <tr><th class="in2">Rate Scale</th><td>${s.inzoi.rateScale ?? 1}</td></tr>
            </table>
          </li>
          ${s.actors.length > 1 ? `<li>This is a <b>${s.actors.length}-Zoi scene</b>: every Zoi has its own entries. The Zoi Animation Studio mod lines the Zois up around ${esc(s.actors[0].name)} and starts their entries for each stage together. Placement relative to ${esc(s.actors[0].name)} (X to its left, Z forward, in metres): ${s.actors.slice(1).map((a) => `${esc(a.name)} at X ${a.offset.x}, Z ${a.offset.z}, facing ${a.offset.yaw}°`).join('; ')}.</li>` : ''}
        </ol>
        ${table(['Entry name', 'Zoi', 'Stage', 'Loops', 'Gender', 'Anim Growth Step', 'Total Play Length', 'Loop Play Length'], entries)}`;
    } else if (s.kind === 'locomotion') {
      steps = `
        <ol>
          <li>Import the file(s) below onto the <b>inZOI template skeleton</b> as an <b>Animation Sequence</b>.</li>
          <li>In <b>Character Animation → Locomotion</b>, for each row of the table set <b>Gender</b> and <b>Anim Growth Step</b>, then either set the sequence as the <b>Idle Anim</b> or add it under <b>Idle Random Anims</b> with:
            <table class="kv">
              <tr><th>Animation</th><td>this sequence</td></tr>
              <tr><th>Emotion Id</th><td>${esc(s.inzoi.emotionId || '(leave empty)')}</td></tr>
              <tr><th>Emotion Level</th><td>0</td></tr>
              <tr><th>Chance to Play</th><td>${s.inzoi.chanceToPlay ?? 1}</td></tr>
            </table>
          </li>
          ${panelStep}
        </ol>
        ${table(['Zoi', 'Gender', 'Anim Growth Step', 'Animation file(s)'], rows)}`;
    } else if (s.kind === 'statLocomotion') {
      steps = `
        <ol>
          <li>Import the file(s) below onto the <b>inZOI template skeleton</b> as an <b>Animation Sequence</b>.</li>
          <li>In <b>Character Animation → Stat Locomotion</b>, for each row of the table set <b>Gender</b> and <b>Anim Growth Step</b>, then add an entry under <b>Stat Locomotions</b>:
            <table class="kv">
              <tr><th>Stat Id</th><td>${esc(s.inzoi.statId || '(choose the stat, e.g. Tired)')}</td></tr>
              <tr><th>Stat Value</th><td>${s.inzoi.statValue ?? 0}</td></tr>
              <tr><th>Stat Walk Anim</th><td>this sequence, if it is a walk cycle</td></tr>
              <tr><th>Idle Random Anims</th><td>this sequence, if it is an idle</td></tr>
            </table>
            Leave the walk times, swim and face fields as they are unless you need them.
          </li>
          ${panelStep}
        </ol>
        ${table(['Zoi', 'Gender', 'Anim Growth Step', 'Animation file(s)'], rows)}`;
    }
    return `
      <section>
        <h2>${esc(s.name)} <span class="tag">${esc(kind)}</span>${s.actors.length > 1 ? ` <span class="tag">${s.actors.length} Zois</span>` : ''}</h2>
        <p class="meta">${s.stages.length} stage${s.stages.length > 1 ? 's' : ''} · ${round(totalLen, 2)} s${s.tags.length ? ' · tags: ' + s.tags.map(esc).join(', ') : ''}</p>
        ${steps}
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
  .scroll { overflow-x: auto; }
  .grid td:first-child code { white-space: nowrap; }
  .kv th.in1 { padding-left: 16px; } .kv th.in2 { padding-left: 32px; }
  a { color: var(--accent); }
</style></head>
<body><main>
  <h1>${esc(pack.name)}</h1>
  <p class="meta">${esc(pack.author || '')} · v${esc(pack.version)} · pack id <code>${esc(manifest.id)}</code> · skeleton: ${esc(manifest.skeleton)} · generated by Studio</p>
  <div class="intro">
    <b>How to use this sheet</b>
    <ol>
      <li>Open the <b>inZOI ModKit</b> and create a new mod project.</li>
      <li>Import the FBX files from the <code>Animations</code> folder next to this sheet onto the <b>inZOI template skeleton</b> (<code>SK_Base</code>: set Skeleton in the import options; never create a new skeleton).</li>
      <li>For each animation below, follow the steps and copy the values exactly. Entry names must match exactly: the Zoi Animation Studio mod finds animations by them.</li>
      <li>Keep <code>zaf_pack.json</code> with your mod: it describes scenes, stages and actor placement for the in-game Zoi Animation Studio mod.</li>
      <li>Export the mod (Local or CurseForge) from the ModKit.</li>
    </ol>
    Field names follow the official ModKit docs: <a href="https://mod-docs.playinzoi.com/docs/category/characteranimation">mod-docs.playinzoi.com → Animation → CharacterAnimation</a>.
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
