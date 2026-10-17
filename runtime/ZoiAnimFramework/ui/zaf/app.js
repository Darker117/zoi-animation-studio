/**
 * Zoi Animation Studio mod — in-game panel.
 * Window management is handled by window.js (the `wf` global).
 *
 *  Animations tab : every animation the game knows (its CharacterAnim table) + animations from packs.
 *                   Click to play on the chosen Zoi; star favourites; loop; hold still.
 *  Scenes tab     : multi-Zoi scenes from packs. Assign Zois to roles, then the framework
 *                   lines them up (B2 Lua director), freezes their autonomy and plays the
 *                   stages in order.
 *  Studio tab     : connection to Studio on this PC.
 *
 * Only Public console commands are used (cheat-only commands such as motion.play do nothing
 * for players). Animations play as hidden interactions: the panel creates the interaction rows
 * at runtime with data.patch (never saved), and the Lua director queues them on the Zoi.
 * UI -> Lua: mailbox (uimod.cfg_save section=box key=cmd). Lua -> UI: 'lua_message.zaf'.
 */
(function () {
    'use strict';

    var MOD = 'ZoiAnimFramework';
    var STAR_SVG = '<svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="currentColor"/></svg>';
    var STUDIO = 'http://127.0.0.1:47820';
    var content = wf.content;
    var S = {
        tab: 'anims', target: null, me: null, zois: [], anims: [], query: '', cat: 'all',
        favs: {}, loop: false, hold: false, playing: null, lua: false, luaPacks: [],
        scene: null, slots: [], run: null, seq: Date.now(), studio: null,
    };

    // ------------------------------------------------------------------ helpers

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined && text !== null) e.appendChild(document.createTextNode(String(text)));
        return e;
    }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

    function parseData(res) {
        if (!res) return null;
        var d = res.data !== undefined ? res.data : res;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { /* plain text */ } }
        return d;
    }

    /** Calls a CLI command; always resolves to {ok, data, message}. */
    function cli(name, params) {
        return new Promise(function (resolve) {
            try {
                var p = inzoi.cli.execute(name, params || {});
                if (!p || typeof p.then !== 'function') { resolve({ ok: !!p, data: null, message: '' }); return; }
                p.then(function (res) {
                    resolve({ ok: !!(res && (res.success === undefined || res.success)), data: parseData(res), message: (res && res.message) || '' });
                }, function (err) { resolve({ ok: false, data: null, message: String(err) }); });
            } catch (e) { resolve({ ok: false, data: null, message: String(e) }); }
        });
    }

    /** First array found in a CLI result (results are wrapped differently per command). */
    function findArray(d, depth) {
        depth = depth || 0;
        if (!d || depth > 4) return null;
        if (Object.prototype.toString.call(d) === '[object Array]') return d;
        if (typeof d === 'object') {
            var keys = ['characters', 'members', 'items', 'list', 'results', 'animations', 'anims', 'rows', 'data'];
            for (var i = 0; i < keys.length; i++) if (d[keys[i]] !== undefined) { var a = findArray(d[keys[i]], depth + 1); if (a) return a; }
            for (var k in d) if (d.hasOwnProperty(k) && typeof d[k] === 'object') { var b = findArray(d[k], depth + 1); if (b) return b; }
        }
        return null;
    }
    function idOf(o) { return o && (o.entity_id || o.entityId || o.id || o.EntityId); }
    function nameOf(o) { return o && (o.display_name || o.name || o.full_name || o.DisplayName || o.Name || ('Zoi ' + idOf(o))); }

    var statusEl = null;
    function status(text, isErr) {
        if (!statusEl) return;
        statusEl.textContent = text || '';
        statusEl.className = 'status' + (isErr ? ' err' : '');
    }

    // ------------------------------------------------------------------ Lua director mailbox

    var pending = {};
    function lua(ops, cb) {
        S.seq = Math.max(S.seq + 1, Date.now());
        for (var i = 0; i < ops.length; i++) { ops[i].req = S.seq + '_' + i; if (cb && i === ops.length - 1) pending[ops[i].req] = cb; }
        return cli('uimod.cfg_save', { mod_id: MOD, section: 'box', key: 'cmd', value: JSON.stringify({ seq: S.seq, ops: ops }) });
    }

    inzoi.event.on('lua_message.zaf', function (raw) {
        var m = raw;
        if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch (e) { return; } }
        if (m && m.content) { try { m = JSON.parse(m.content); } catch (e) { /* already parsed */ } }
        if (!m || !m.type) return;
        if (!S.lua) { S.lua = true; renderDot(); }
        if (m.me && !S.me) { S.me = m.me; }
        if (m.type === 'packs') { S.luaPacks = m.packs || []; if (S.tab !== 'anims') render(); }
        if (m.type === 'error') status('Framework: ' + m.text, true);
        if (m.req && pending[m.req]) { var f = pending[m.req]; delete pending[m.req]; f(m); }
    });

    function renderDot() { var d = document.getElementById('zaf-dot'); if (d) d.className = 'dot' + (S.lua ? ' on' : ''); }

    // ------------------------------------------------------------------ packs

    function allPacks() {
        var list = [], seen = {};
        var add = function (p) { if (p && p.id && !seen[p.id]) { seen[p.id] = true; list.push(p); } };
        (window.ZAF_PACKS || []).forEach(add);
        (S.luaPacks || []).forEach(add);
        return list;
    }

    /** CharacterAnim row to play: the pack sets anim_id, which defaults to the animation id. */
    function packAnimId(pack, id) {
        var a = (pack.animations || []).filter(function (x) { return x.id === id; })[0];
        return (a && (a.anim_id || a.id)) || id;
    }

    function packAnimations() {
        var out = [];
        allPacks().forEach(function (p) {
            (p.scenes || []).forEach(function (s) {
                if ((s.actors || []).length !== 1) return;
                (s.stages || []).forEach(function (st, i) {
                    var id = st.animations && st.animations[0];
                    if (id) out.push({ animId: packAnimId(p, id), label: s.name + ((s.stages.length > 1) ? ' · ' + st.name : ''), pack: p.name, tags: s.tags || [] });
                    void i;
                });
            });
        });
        return out;
    }

    function scenes() {
        var out = [];
        allPacks().forEach(function (p) { (p.scenes || []).forEach(function (s) { out.push({ pack: p, scene: s }); }); });
        return out;
    }

    // ------------------------------------------------------------------ Zois

    function refreshZois() {
        var zois = [], seen = {};
        function add(o, group) {
            var id = Number(idOf(o));
            if (!id || seen[id]) return;
            seen[id] = true;
            zois.push({ id: id, name: nameOf(o), group: group });
        }
        return cli('entity.get_possessed').then(function (r) {
            var d = r.data || {};
            var id = Number(idOf(d) || (d.entity && idOf(d.entity)));
            if (id) { S.me = id; add({ entity_id: id, name: nameOf(d.entity || d) }, 'You'); }
            return cli('household.get_members');
        }).then(function (r) {
            (findArray(r.data) || []).forEach(function (o) { add(o, 'Household'); });
            return cli('entity.scan_characters', { radius: 2000 });
        }).then(function (r) {
            (findArray(r.data) || []).forEach(function (o) { add(o, 'Nearby'); });
            S.zois = zois;
            if (!S.target || !seen[S.target]) S.target = S.me || (zois[0] && zois[0].id) || null;
            render();
        });
    }

    function zoiSelect(value, onChange) {
        var sel = el('select', 'grow');
        if (!S.zois.length) sel.appendChild(el('option', null, 'No Zois found — press Refresh'));
        S.zois.forEach(function (z) {
            var o = el('option', null, z.name + '  (' + z.group + ')');
            o.value = z.id;
            if (Number(value) === z.id) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', function () { onChange(Number(sel.value)); });
        return sel;
    }

    // ------------------------------------------------------------------ playing animations

    // Hidden interaction rows (created once per animation and session with data.patch).
    function hash(str) {
        var h = 5381;
        for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    function actionRow(id, animId, loop) {
        return {
            Id: id, Comment: 'Zoi Animation Studio: play ' + animId, ActionTags: [],
            Actions: [{
                ConditionId: 'None', bCancelWhenMotiveInsufficient: false, Duration: 0, IsForceCancelable: true,
                IsWaitFinishAction: true, FinishPrev: false, bEnableInsertAutoMove: false, BaseObject: 'Self',
                Command: loop ? 'PlayLoopAnim' : 'PlayAnim', S1: animId, S2: 'None', F1: loop ? 3600 : 0, F2: 0,
                StartScriptIdList: [], TickScriptIdList: [], TickInterval: 0, FinishScriptIdList: [], CancelScriptIdList: [],
                NotifyScriptIds: [], ConsumeCurrencyId: 'None', ConsumeCurrencyValue: 0
            }]
        };
    }

    function interactionRow(id, actionId) {
        return {
            Id: id, Comment: 'Zoi Animation Studio', InteractionTags: [], ConditionId: 'None', GrabEntityConditionId: 'None',
            InteractionSlotUsage: 'None', EnableSlotTags: ['None'], ObjectSlotUsage: 'None', ActionIdList: [actionId],
            TargetFilterInfoList: [], bAutoFindRepeat: false, AutoFindRepeatMaxCount: 0, AutoFindRepeatSearchRange: 500,
            TargetFilterFindAll: false, SpaceTargetFilterId: 'None', NoneTargetPlayable: true, CheckSlotToEntity: false,
            EnableOnlyConnectedChairObjectSlot: false, bCheckCanMoveToSlot: false, InnerThoughtIconInfo: { IconId: 'None', Probability: 0 },
            StartScriptIdList: [], CancelScriptIdList: [], FinishScriptIdList: [], ConsumeCurrencyId: 'None', ConsumeCurrencyValue: 0,
            GrabParts: 'None', PostureId: [], BodyParts: []
        };
    }

    function bagRow(id, interactionId, label) {
        return {
            Id: id, Comment: 'Zoi Animation Studio: ' + label,
            InteractionRewards: [{ StatId: 'None', Reward: 0, Tier: 'Invalid' }], PreferenceRewards: [], InteractionBagTags: [],
            AddOnAnimId: 'Default', TPOTags: [], AutonomyGroupTag: 'None', GroupID: 'Group_Hide', PostureGroupId: 'StandGroup',
            InteractionBagCategory: 'None', StrongEmotionFilters: [], EnqueueConditionIds: [], InteractionVisibleConditionIds: [],
            InteractionEnableConditionIds: [], AutonomyTimeRanges: [], AgingConditionFlags: 504, AutonomyAgingConditionFlags: 0,
            ZoiGroupFlags: 0, ZoiGroupRotationCoopId: 'None', bAddSameInteractionToGroupMember: false, CompetitionRuleId: 'None',
            RepeatCount: 1,
            InteractionSequence: [{
                Id: 'None', Probability: 1, bSequencial: false, EnableConditionId: 'None', SequenceStartInfos: [], MainInteractionId: 'None',
                InteractionInfos: [{ InteractionId: interactionId, Label: 'A', SuccessNextLabel: 'None', FailNextLabel: 'None', bIsOptional: false }],
                CoopId: 'None', bIsTalk: false, NextInteractionBagId: 'None'
            }],
            DisplayInfo: {
                DisplayCategoryTextId: 'None', DisplayTextId: 'None', OverrideQueueTextId: '', Icon: 'None', InteractionQueueIcon: 'None',
                PanelIcon: 'None', PanelIconId: 'None', PanelIconColorId: 'None', LeftMarkerId: 'None',
                PanelIconWithBG: { IconId: 'None', BGColor1Id: 'None', BGColor2Id: 'None' }, bHideUI: true
            },
            bRejectable: false, bUniqueInQueue: false, bForFixedDesk: false, bNonCancelable: false, SelectedScriptId: 'None',
            StartScriptIds: [], FinishScriptIds: [], StartHowlingInfos: [], ConsumeCurrencyId: 'None', ConsumeCurrencyValue: 0,
            bIgnoreConsumeCurrencyCheck: false, bGhostAvailable: false, AutonomyCooltimeMin: 60, bAlwaysExposeToSLM: false,
            AutonomySLMCooltimeMin: 60, ActionsPerformedInThePastHourText: 'None', ActionHintText: 'None', CurrentStateHintText: 'None',
            ActionHintTextForSLM: 'None', ActionHintTextList: 'None'
        };
    }

    var bags = {};
    /** Resolves to the hidden bag id that plays `animId` (creating the rows on first use). */
    function ensureBag(animId, loop) {
        var key = animId + (loop ? '|loop' : '');
        if (bags[key]) return bags[key];
        var h = hash(key);
        var ids = { action: 'ZAF_A_' + h, inter: 'ZAF_I_' + h, bag: 'ZAF_B_' + h };
        var patch = function (query, row) {
            return cli('data.patch', { method: 'Append', query: query, value: JSON.stringify(row) }).then(function (r) {
                if (!r.ok && !/exist|duplicat/i.test(r.message)) throw new Error(query + ': ' + r.message);
            });
        };
        bags[key] = patch('Action_Interaction', actionRow(ids.action, animId, loop))
            .then(function () { return patch('Interaction', interactionRow(ids.inter, ids.action)); })
            .then(function () { return patch('InteractionBag', bagRow(ids.bag, ids.inter, animId)); })
            .then(function () { return ids.bag; }, function (e) { delete bags[key]; throw e; });
        return bags[key];
    }

    function play(animId, label) {
        if (!S.target) { status('Choose a Zoi first.', true); return; }
        var target = S.target;
        status('Starting ' + (label || animId) + '…');
        ensureBag(animId, S.loop).then(function (bag) {
            lua([{ op: 'queue', id: target, bag: bag, cancel: true }], function (m) {
                if (m.type === 'error') { status('Could not play: ' + m.text, true); return; }
                S.playing = animId;
                renderList();
                status('Playing ' + (label || animId) + (S.loop ? ' (looping)' : ''));
            });
            if (!S.lua) status('Waiting for the framework director (is the mod enabled?)', true);
        }, function (e) { status('Could not prepare ' + animId + ': ' + e.message, true); });
    }

    function stop() {
        S.playing = null;
        if (S.target) lua([{ op: 'cancel', id: S.target }]);
        renderList();
        status('Stopped.');
    }

    function setHold(on) {
        S.hold = on;
        if (S.target) {
            if (on) cli('zoi.freeze', { entity_id: S.target });
            else { cli('autonomy.set_enable', { entity_id: S.target, enable: true }); lua([{ op: 'freeze', ids: [S.target], on: false }]); }
        }
        status(on ? 'Holding still: free will is off for this Zoi.' : 'Free will is back on.');
        render();
    }

    // The CharacterAnim table holds every animation the game can play; found by alias at runtime.
    var allAnimIds = null;
    function loadAnims() {
        if (allAnimIds) { filterAnims(); return; }
        status('Loading the game\'s animations…');
        cli('data.list_tables').then(function (r) {
            var tables = findArray(r.data) || [];
            var names = tables.map(function (t) { return typeof t === 'string' ? t : (t.alias || t.name || t.id); }).filter(Boolean);
            var picks = names.filter(function (n) { return /charanim|animcharacter|characteranim/i.test(n); });
            if (!picks.length) picks = names.filter(function (n) { return /anim/i.test(n) && !/montage|sound|notify/i.test(n); });
            if (!picks.length) { allAnimIds = []; status('Could not find the animation table.', true); renderList(); return; }
            var ids = [], left = picks.length;
            picks.forEach(function (alias) {
                cli('data.list_rows', { alias: alias }).then(function (rr) {
                    (findArray(rr.data) || []).forEach(function (row) { var id = typeof row === 'string' ? row : (row.id || row.name || row.row); if (id) ids.push(id); });
                    if (--left === 0) {
                        var seen = {};
                        allAnimIds = ids.filter(function (id) { if (seen[id]) return false; seen[id] = true; return true; }).sort();
                        filterAnims();
                    }
                });
            });
        });
    }

    function filterAnims() {
        var q = (S.query || '').toLowerCase();
        var words = q.split(/\s+/).filter(Boolean);
        S.anims = (allAnimIds || []).filter(function (id) {
            var l = id.toLowerCase();
            for (var i = 0; i < words.length; i++) if (l.indexOf(words[i]) < 0) return false;
            return true;
        }).map(function (id) { return { animId: id, label: id }; });
        status((allAnimIds || []).length ? S.anims.length + ' of ' + allAnimIds.length + ' animations' : 'No animations found.');
        renderList();
    }

    // ------------------------------------------------------------------ scenes

    function startScene() {
        var sc = S.scene;
        if (!sc) return;
        var ids = S.slots.slice(0, sc.scene.actors.length);
        for (var i = 0; i < ids.length; i++) if (!ids[i]) { status('Choose a Zoi for every role.', true); return; }
        var seen = {};
        for (var j = 0; j < ids.length; j++) { if (seen[ids[j]]) { status('Each role needs a different Zoi.', true); return; } seen[ids[j]] = true; }
        var actors = sc.scene.actors.map(function (a, k) { return { id: ids[k], x: a.offset.x, z: a.offset.z, yaw: a.offset.yaw }; });
        status('Lining up…');
        ids.forEach(function (id) { cli('zoi.freeze', { entity_id: id }); });
        var started = false;
        var go = function () { if (started) return; started = true; S.run = { ids: ids, stage: 0, loops: 0 }; playStage(0); };
        lua([{ op: 'align', anchor: ids[0], actors: actors, scene: sc.scene.id }], go);
        // Without the Lua director (mod disabled?) still play, just without alignment.
        setTimeout(go, 1500);
    }

    function playStage(i) {
        var sc = S.scene, run = S.run;
        if (!sc || !run) return;
        var st = sc.scene.stages[i];
        if (!st) { status('Scene finished.'); endScene(false); return; }
        run.stage = i;
        clearTimeout(run.timer);
        var loopForever = st.loop && st.loopCount === -1;
        Promise.all(st.animations.map(function (animId, k) {
            if (!animId || !run.ids[k]) return null;
            return ensureBag(packAnimId(sc.pack, animId), loopForever).then(function (bag) { return { id: run.ids[k], bag: bag, cancel: true }; });
        })).then(function (items) {
            if (S.run !== run) return;
            lua([{ op: 'queue_many', items: items.filter(Boolean) }]);
            status('Stage ' + (i + 1) + '/' + sc.scene.stages.length + ': ' + st.name + (loopForever ? ' (looping — press Next stage)' : ''));
            render();
            if (loopForever) return;
            var dur = Number(st.duration) || (st.frames / (st.fps || 30)) || 2;
            run.timer = setTimeout(function () {
                if (S.run !== run) return;
                if (st.loop && run.loops + 1 < (st.loopCount || 1)) { run.loops++; playStage(i); return; }
                run.loops = 0;
                playStage(i + 1);
            }, dur * 1000);
        }, function (e) { status('Could not prepare the scene: ' + e.message, true); });
    }

    function nextStage() { if (S.run) { S.run.loops = 0; playStage(S.run.stage + 1); } }

    function endScene(stopAnims) {
        var run = S.run;
        if (!run) return;
        clearTimeout(run.timer);
        S.run = null;
        lua([{ op: 'release', ids: run.ids }]);
        run.ids.forEach(function (id) { cli('autonomy.set_enable', { entity_id: id, enable: true }); });
        if (stopAnims) status('Scene stopped.');
        render();
    }

    // ------------------------------------------------------------------ studio link

    function pingStudio() {
        try {
            var x = new XMLHttpRequest();
            x.open('POST', STUDIO + '/api/zaf/status', true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.timeout = 2000;
            x.onreadystatechange = function () {
                if (x.readyState !== 4) return;
                var res = null;
                try { res = JSON.parse(x.responseText); } catch (e) { res = null; }
                S.studio = res && res.ok ? res : null;
                if (S.tab === 'studio') render();
            };
            x.send('{}');
        } catch (e) { S.studio = null; }
    }

    // ------------------------------------------------------------------ rendering

    var listEl = null;

    function render() {
        clear(content);
        var tabs = el('div', 'tabs');
        [['anims', 'Animations'], ['scenes', 'Scenes'], ['studio', 'Studio']].forEach(function (t) {
            var b = el('div', 'tab' + (S.tab === t[0] ? ' active' : ''), t[1]);
            b.addEventListener('click', function () { S.tab = t[0]; if (t[0] === 'studio') pingStudio(); render(); });
            tabs.appendChild(b);
        });
        content.appendChild(tabs);

        if (S.tab === 'anims') renderAnims();
        else if (S.tab === 'scenes') renderScenes();
        else renderStudio();

        statusEl = el('div', 'status');
        content.appendChild(statusEl);
    }

    function renderAnims() {
        var bar = el('div', 'bar');
        bar.appendChild(zoiSelect(S.target, function (v) { S.target = v; S.hold = false; render(); }));
        var refresh = el('button', 'btn', 'Refresh');
        refresh.addEventListener('click', function () { refreshZois(); });
        bar.appendChild(refresh);
        content.appendChild(bar);

        var bar2 = el('div', 'bar');
        var q = el('input', 'grow');
        q.type = 'text';
        q.placeholder = 'Search animations (dance, wave, sit…)';
        q.value = S.query;
        var t = null;
        q.addEventListener('input', function () { S.query = q.value; clearTimeout(t); t = setTimeout(loadAnims, 200); });
        bar2.appendChild(q);
        var stopB = el('button', 'btn danger', 'Stop');
        stopB.addEventListener('click', stop);
        bar2.appendChild(stopB);
        content.appendChild(bar2);

        var bar3 = el('div', 'bar');
        var loopB = el('button', 'btn' + (S.loop ? ' on' : ''), S.loop ? 'Loop: on' : 'Loop: off');
        loopB.addEventListener('click', function () { S.loop = !S.loop; render(); });
        var holdB = el('button', 'btn' + (S.hold ? ' on' : ''), S.hold ? 'Hold still: on' : 'Hold still: off');
        holdB.addEventListener('click', function () { setHold(!S.hold); });
        bar3.appendChild(loopB);
        bar3.appendChild(holdB);
        bar3.appendChild(el('span', 'grow'));
        content.appendChild(bar3);

        var chips = el('div', 'chips');
        [['all', 'All'], ['fav', 'Favorites'], ['packs', 'My packs']].forEach(function (c) {
            var ch = el('span', 'chip' + (S.cat === c[0] ? ' active' : ''), c[1]);
            ch.addEventListener('click', function () { S.cat = c[0]; render(); });
            chips.appendChild(ch);
        });
        content.appendChild(chips);

        listEl = el('div', 'list');
        content.appendChild(listEl);
        renderList();
    }

    function renderList() {
        if (!listEl || S.tab !== 'anims') return;
        clear(listEl);
        var items = [];
        var q = (S.query || '').toLowerCase();
        var packs = packAnimations().filter(function (a) { return !q || a.label.toLowerCase().indexOf(q) >= 0 || a.animId.toLowerCase().indexOf(q) >= 0; });
        if (S.cat === 'packs') items = packs;
        else if (S.cat === 'fav') items = packs.concat(S.anims).filter(function (a) { return S.favs[a.animId]; });
        else items = packs.concat(S.anims);
        if (!items.length) {
            listEl.appendChild(el('div', 'empty', S.cat === 'fav' ? 'Star animations to collect them here.' : S.cat === 'packs' ? 'No packs installed yet. Make one in Studio and use Export → Install into my game.' : 'Type to search the game\'s animations (dance, wave, sit…).'));
            return;
        }
        var max = Math.min(items.length, 300);
        for (var i = 0; i < max; i++) (function (a) {
            var row = el('div', 'item' + (S.playing === a.animId ? ' playing' : ''));
            row.appendChild(el('span', 'name', a.label));
            if (a.pack) row.appendChild(el('span', 'meta', a.pack));
            else if (a.meta) row.appendChild(el('span', 'meta', a.meta));
            var star = el('span', 'star' + (S.favs[a.animId] ? ' on' : ''));
            star.innerHTML = STAR_SVG;
            star.addEventListener('click', function (e) {
                e.stopPropagation();
                if (S.favs[a.animId]) delete S.favs[a.animId]; else S.favs[a.animId] = true;
                saveFavs();
                renderList();
            });
            row.appendChild(star);
            row.addEventListener('click', function () { play(a.animId, a.label); });
            listEl.appendChild(row);
        })(items[i]);
        if (items.length > max) listEl.appendChild(el('div', 'note', 'Showing ' + max + ' of ' + items.length + '. Type to narrow it down.'));
    }

    function renderScenes() {
        var list = el('div', 'list');
        var all = scenes();
        if (!all.length) {
            list.appendChild(el('div', 'empty', 'No scenes yet. Scenes come from animation packs: make one in Studio (Export → Install into my game), or install a pack mod.'));
            content.appendChild(list);
            return;
        }
        if (S.run && S.scene) {
            var sc = S.scene;
            list.appendChild(el('div', 'section', 'Now playing'));
            var card = el('div', 'scene-card sel');
            card.appendChild(el('div', 't', sc.scene.name));
            card.appendChild(el('div', 'd', 'Stage ' + (S.run.stage + 1) + ' of ' + sc.scene.stages.length + ': ' + (sc.scene.stages[S.run.stage] || {}).name));
            var row = el('div', 'stage-row');
            var nb = el('button', 'btn', 'Next stage');
            nb.addEventListener('click', nextStage);
            var sb = el('button', 'btn danger', 'Stop');
            sb.addEventListener('click', function () { endScene(true); });
            row.appendChild(nb); row.appendChild(sb);
            card.appendChild(row);
            list.appendChild(card);
        }
        list.appendChild(el('div', 'section', 'Scenes'));
        all.forEach(function (entry) {
            var s = entry.scene;
            var selected = S.scene && S.scene.scene.id === s.id;
            var card = el('div', 'scene-card' + (selected ? ' sel' : ''));
            card.appendChild(el('div', 't', s.name));
            card.appendChild(el('div', 'd', entry.pack.name + ' · ' + s.actors.length + ' Zoi' + (s.actors.length > 1 ? 's' : '') + ' · ' + s.stages.length + ' stage' + (s.stages.length > 1 ? 's' : '') + (s.tags && s.tags.length ? ' · ' + s.tags.join(', ') : '')));
            card.addEventListener('click', function () {
                if (selected) return;
                S.scene = entry;
                S.slots = s.actors.map(function (a, i) { return i === 0 ? S.target : ((S.zois.filter(function (z) { return z.id !== S.target; })[i - 1] || {}).id || null); });
                render();
            });
            if (selected) {
                var box = el('div');
                box.style.marginTop = '8px';
                s.actors.forEach(function (a, i) {
                    var row = el('div', 'slot');
                    row.appendChild(el('span', 'label', a.name));
                    row.appendChild(zoiSelect(S.slots[i], function (v) { S.slots[i] = v; }));
                    box.appendChild(row);
                });
                var go = el('button', 'btn primary', S.run ? 'Restart scene' : 'Start scene');
                go.addEventListener('click', function (e) { e.stopPropagation(); if (S.run) endScene(false); startScene(); });
                box.appendChild(go);
                card.appendChild(box);
            }
            list.appendChild(card);
        });
        content.appendChild(list);
    }

    function renderStudio() {
        var list = el('div', 'list');
        list.appendChild(el('div', 'section', 'Studio'));
        list.appendChild(el('div', 'note', S.studio
            ? 'Connected to the studio on this PC (v' + (S.studio.version || '?') + ').'
            : 'The studio is not running. Open Studio on this PC to make animations.'));
        list.appendChild(el('div', 'section', 'Live preview'));
        list.appendChild(el('div', 'note', 'To see a studio animation on your Zoi right away, open the game\'s Motion Capture window, click Turn On, and press "Live in inZOI" in the studio.'));
        list.appendChild(el('div', 'section', 'Framework'));
        list.appendChild(el('div', 'note', (S.lua ? 'Director running.' : 'Waiting for the Lua director… (scene alignment needs it)') + ' Packs: ' + allPacks().length + '.'));
        var b = el('button', 'btn', 'Reload packs');
        b.addEventListener('click', function () { lua([{ op: 'packs' }]); status('Asking installed packs…'); });
        list.appendChild(b);
        content.appendChild(list);
    }

    // ------------------------------------------------------------------ prefs

    function saveFavs() { cli('uimod.cfg_save', { mod_id: MOD, section: 'prefs', key: 'favorites', value: JSON.stringify(S.favs) }); }
    function loadFavs() {
        cli('uimod.cfg_load', { mod_id: MOD, section: 'prefs', key: 'favorites' }).then(function (r) {
            var raw = r.data && (r.data.value || (r.data.data && r.data.data.value));
            if (raw) { try { S.favs = JSON.parse(raw) || {}; } catch (e) { S.favs = {}; } }
            renderList();
        });
    }

    // ------------------------------------------------------------------ boot

    render();
    loadFavs();
    refreshZois().then(function () { loadAnims(); });
    lua([{ op: 'ping' }, { op: 'packs' }]);
    pingStudio();
    window._onStateLoaded = function () { render(); };
})();
