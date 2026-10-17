-- Zoi Animation Framework (ZAF) — B2 (simulation) director.
--
-- The in-game panel (ui/zaf) drives most things with CLI commands directly. This script does
-- what the UI cannot: turning Zois to an exact facing while placing them (scene alignment),
-- freezing autonomy for the actors of a scene, and collecting animation packs that other mods
-- register (see the pack hook below). The UI talks to it through a small mailbox:
--
--   UI  -> Lua : uimod.cfg_save mod_id=ZoiAnimFramework section=box key=cmd value=<json>
--                {"seq": n, "ops": [{"op": "...", ...}, ...]}   (polled 10x per second)
--   Lua -> UI  : inzoi.message.send_to_client(entity, "zaf", <json>)  -> JS event 'lua_message.zaf'
--
-- Pack hook: any mod can ship  lua/B2/ZAF_Packs.lua  returning
--   { register = function(api) api.add({ zaf = 1, id = "author.pack", name = "...", scenes = {...}, animations = {...} }) end }
-- Same-named modules from every installed mod are merged by the game's Lua loader, so one
-- require() call reaches all of them.

local M = {}
local VERSION = "1.0.0"
local MOD_ID = "ZoiAnimFramework"
local json = require("ZAF.json")

local S = { clock = 0, poll = 0, beat = 0, seq = nil, me = nil, frozen = {}, packs = nil }

local function cli(cmd) return inzoi.cli.execute(cmd) end

local function eid(n)
    local id = INZOI.FB1EntityId()
    id.Value = n
    return id
end

local function em() return inzoi.getB2Manager("FB2EntityManager") end
local function char(n) return em():FindCharacter(eid(n)) end

local function find_me()
    local ok, _, data = cli("entity.get_possessed")
    local me = ok and tonumber(tostring(data):match('"entity_id"%s*:%s*(%d+)'))
    if me and me > 0 then S.me = me end
end

local function report(t)
    if not S.me then find_me() end
    if not S.me then return end
    t.v = VERSION
    pcall(function() inzoi.message.send_to_client(S.me, "zaf", json.encode(t)) end)
end

local function log(s)
    print("[ZAF] " .. s)
    report({ type = "log", text = s })
end

-- ---------------------------------------------------------------- primitives

local function freeze(id, on)
    local am = inzoi.getB2Manager("FB2AutonomyOptionManager")
    local T = inzoi.EB1AutonomyOptionType
    local frozen = on ~= false
    am:SetIndividualToggleOption(eid(id), T.AutonomyEnable, not frozen)
    am:SetIndividualToggleOption(eid(id), T.FollowSchedule, not frozen)
    S.frozen[id] = frozen or nil
end

local function place(id, x, y, z, yaw)
    local c = char(id)
    if not c then error("no Zoi " .. tostring(id)) end
    local loc = (x and y and z) and UE.FVector(x, y, z) or c:GetLocation()
    local rot = UE.FRotator(0, yaw or c:GetRotation().Yaw, 0)
    -- bSkipSafeLocation=true keeps partners close enough to touch (hugs, dances).
    c:Teleport(loc, rot, false, false, false, false, true, inzoi.EB1LoadingContext.None, inzoi.EB1TeleportReason.None)
end

-- Plays an animation the supported way: queue a (hidden) interaction bag on the Zoi.
-- The UI creates the bag rows at runtime with data.patch (a Public command); queueing from
-- Lua is not cheat-gated, unlike the motion.* console commands.
local function interaction(c) return c:GetComponent(inzoi.EB2ComponentType.Interaction) end

local function cancel_all(id)
    local c = char(id)
    if not c then return end
    local IC = INZOI.FB2InteractionComponent
    local ic = interaction(c)
    pcall(function() IC.TryCancelInteraction(ic, IC.GetCurrentInteractionQueueId(ic), inzoi.EB1InteractionCancelReason.Clear, "zaf") end)
    pcall(function() IC.ClearInteractionQueue(ic, inzoi.EB1InteractionCancelReason.Clear, true) end)
end

local function queue_bag(id, bag, cancel)
    local c = char(id)
    if not c then error("no Zoi " .. tostring(id)) end
    if cancel ~= false then cancel_all(id) end
    local IC = INZOI.FB2InteractionComponent
    return IC.AddInteractionQueueByParam(interaction(c), INZOI.FB1EntityId(), c:GetLocation(), bag,
        inzoi.EB1InteractionPlayReason.None, true, false, "zaf", true, false)
end

local function where(id)
    local c = char(id)
    if not c then return nil end
    local l, r = c:GetLocation(), c:GetRotation()
    return { x = l.X, y = l.Y, z = l.Z, yaw = r.Yaw }
end

-- Scene alignment: slot 0 stays where it is; every other actor is placed relative to it.
-- Offsets use the studio convention: x = to the anchor's LEFT (m), z = forward (m),
-- yaw = degrees, positive turns left. Unreal: X forward, Y right, Z up, centimeters.
local function align(anchorId, actors)
    local a = where(anchorId)
    if not a then error("anchor Zoi not found") end
    local psi = math.rad(a.yaw)
    local fx, fy = math.cos(psi), math.sin(psi)
    local lx, ly = math.sin(psi), -math.cos(psi)
    local placed = {}
    for _, act in ipairs(actors or {}) do
        if act.id and act.id ~= anchorId then
            local ox, oz = (act.x or 0) * 100, (act.z or 0) * 100
            place(act.id, a.x + fx * oz + lx * ox, a.y + fy * oz + ly * ox, a.z, a.yaw - (act.yaw or 0))
            placed[#placed + 1] = act.id
        end
    end
    return placed
end

-- ---------------------------------------------------------------- pack registry (other mods)

local function collect_packs()
    local packs, ids = {}, {}
    local api = {
        add = function(p)
            if type(p) == "table" and p.id and not ids[p.id] then
                ids[p.id] = true
                packs[#packs + 1] = p
            end
        end,
        version = VERSION,
    }
    -- Built at runtime: the module is optional and supplied by other mods.
    local name = table.concat({ "ZAF", "_Packs" })
    local ok, mod = pcall(require, name)
    if ok and type(mod) == "table" and mod.register then pcall(mod.register, api) end
    S.packs = packs
    return packs
end

-- ---------------------------------------------------------------- mailbox ops

local OPS = {
    ping = function() return { type = "pong", me = S.me } end,
    packs = function() return { type = "packs", packs = collect_packs() } end,
    freeze = function(op)
        for _, id in ipairs(op.ids or { op.id }) do freeze(id, op.on ~= false) end
        return { type = "ok", op = "freeze" }
    end,
    place = function(op) place(op.id, op.x, op.y, op.z, op.yaw); return { type = "ok", op = "place" } end,
    face = function(op) place(op.id, nil, nil, nil, op.yaw); return { type = "ok", op = "face" } end,
    where = function(op) return { type = "where", id = op.id, at = where(op.id) } end,
    queue = function(op)
        local res = queue_bag(op.id, op.bag, op.cancel)
        return { type = "queued", id = op.id, bag = op.bag, result = tostring(res) }
    end,
    queue_many = function(op)
        local out = {}
        for _, q in ipairs(op.items or {}) do
            local ok, res = pcall(queue_bag, q.id, q.bag, q.cancel)
            out[#out + 1] = { id = q.id, ok = ok, result = tostring(res) }
        end
        return { type = "queued_many", items = out }
    end,
    cancel = function(op)
        for _, id in ipairs(op.ids or { op.id }) do cancel_all(id) end
        return { type = "ok", op = "cancel" }
    end,
    align = function(op) return { type = "aligned", scene = op.scene, placed = align(op.anchor, op.actors) } end,
    release = function(op)
        for _, id in ipairs(op.ids or {}) do
            pcall(cancel_all, id)
            pcall(freeze, id, false)
        end
        return { type = "ok", op = "release" }
    end,
}

local function read_box()
    local ok, _, data = cli(string.format("uimod.cfg_load mod_id=%s section=box key=cmd", MOD_ID))
    if not ok or not data then return nil end
    local d = json.decode(tostring(data))
    local raw = d and (d.value or (d.data and d.data.value)) or nil
    if type(raw) == "table" then return raw end
    return json.decode(raw)
end

local function poll()
    local box = read_box()
    if not box or box.seq == nil or box.seq == S.seq then return end
    S.seq = box.seq
    for _, op in ipairs(box.ops or {}) do
        local f = OPS[op.op]
        local ok, res = pcall(f or function() error("unknown op " .. tostring(op.op)) end, op)
        if not ok then
            report({ type = "error", op = op.op, req = op.req, text = tostring(res) })
        elseif res then
            res.req = op.req
            report(res)
        end
    end
end

-- ---------------------------------------------------------------- lifecycle

function M.on_begin()
    pcall(require, "Objects.B2Character")
    pcall(require, "Systems.B2AutonomyOptionManager")
    pcall(require, "Components.B2InteractionComponent")
    find_me()
    local box = read_box()
    S.seq = box and box.seq or nil -- ignore whatever was left from a previous session
    log("Zoi Animation Framework " .. VERSION .. " ready")
end

-- The docs say Main.lua callbacks get no `self`, while working mods declare (self, dt):
-- accept either form.
function M.on_tick(a, b)
    local dt = (type(b) == "number" and b) or (type(a) == "number" and a) or 0
    S.clock = S.clock + dt
    S.poll = S.poll + dt
    if S.poll >= 0.1 then
        S.poll = 0
        local ok, err = pcall(poll)
        if not ok then print("[ZAF] poll error " .. tostring(err)) end
    end
    S.beat = S.beat + dt
    if S.beat >= 3 then
        S.beat = 0
        pcall(find_me)
        report({ type = "alive", me = S.me })
    end
end

function M.on_end()
    for id in pairs(S.frozen) do pcall(freeze, id, false) end
end

return M
