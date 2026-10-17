-- Minimal JSON encode/decode for the Zoi Animation Studio mod (sandbox-safe, no loadstring).
local M = {}

local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function is_array(t)
    local n = 0
    for k in pairs(t) do
        if type(k) ~= "number" or k < 1 or k % 1 ~= 0 then return false end
        n = n + 1
    end
    for i = 1, n do if t[i] == nil then return false end end
    return true
end

local encode
encode = function(v)
    local t = type(v)
    if t == "nil" then return "null" end
    if t == "boolean" then return v and "true" or "false" end
    if t == "number" then
        if v ~= v or v == math.huge or v == -math.huge then return "null" end
        if v % 1 == 0 and v > -1e15 and v < 1e15 then return string.format("%d", v) end
        return string.format("%.6g", v)
    end
    if t == "string" then
        return '"' .. v:gsub('[%c"\\]', function(c) return escapes[c] or string.format("\\u%04x", c:byte()) end) .. '"'
    end
    if t == "table" then
        local out = {}
        if next(v) == nil then return "[]" end
        if is_array(v) then
            for i = 1, #v do out[i] = encode(v[i]) end
            return "[" .. table.concat(out, ",") .. "]"
        end
        for k, val in pairs(v) do out[#out + 1] = encode(tostring(k)) .. ":" .. encode(val) end
        return "{" .. table.concat(out, ",") .. "}"
    end
    return '"' .. tostring(v) .. '"'
end
M.encode = encode

-- ---------------------------------------------------------------- decode

local function skip(s, i)
    local _, e = s:find("^[ \n\r\t]*", i)
    return e + 1
end

local decode_value

local function decode_string(s, i)
    local out, j = {}, i + 1
    while true do
        local c = s:sub(j, j)
        if c == "" then error("unterminated string") end
        if c == '"' then return table.concat(out), j + 1 end
        if c == "\\" then
            local n = s:sub(j + 1, j + 1)
            local map = { b = "\b", f = "\f", n = "\n", r = "\r", t = "\t", ['"'] = '"', ["\\"] = "\\", ["/"] = "/" }
            if map[n] then out[#out + 1] = map[n]; j = j + 2
            elseif n == "u" then
                local code = tonumber(s:sub(j + 2, j + 5), 16) or 63
                if code < 0x80 then out[#out + 1] = string.char(code)
                elseif code < 0x800 then out[#out + 1] = string.char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40)
                else out[#out + 1] = string.char(0xE0 + math.floor(code / 0x1000), 0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40) end
                j = j + 6
            else error("bad escape") end
        else
            local k = s:find('["\\]', j)
            if not k then error("unterminated string") end
            out[#out + 1] = s:sub(j, k - 1)
            j = k
        end
    end
end

decode_value = function(s, i)
    i = skip(s, i)
    local c = s:sub(i, i)
    if c == "{" then
        local obj = {}
        i = skip(s, i + 1)
        if s:sub(i, i) == "}" then return obj, i + 1 end
        while true do
            local key
            key, i = decode_string(s, skip(s, i))
            i = skip(s, i)
            if s:sub(i, i) ~= ":" then error("expected ':'") end
            obj[key], i = decode_value(s, i + 1)
            i = skip(s, i)
            local d = s:sub(i, i)
            if d == "}" then return obj, i + 1 end
            if d ~= "," then error("expected ','") end
            i = i + 1
        end
    elseif c == "[" then
        local arr = {}
        i = skip(s, i + 1)
        if s:sub(i, i) == "]" then return arr, i + 1 end
        while true do
            arr[#arr + 1], i = decode_value(s, i)
            i = skip(s, i)
            local d = s:sub(i, i)
            if d == "]" then return arr, i + 1 end
            if d ~= "," then error("expected ','") end
            i = i + 1
        end
    elseif c == '"' then
        return decode_string(s, i)
    elseif s:find("^true", i) then return true, i + 4
    elseif s:find("^false", i) then return false, i + 5
    elseif s:find("^null", i) then return nil, i + 4
    else
        local num = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", i)
        if not num or num == "" then error("unexpected '" .. c .. "' at " .. i) end
        return tonumber(num), i + #num
    end
end

function M.decode(s)
    if type(s) ~= "string" or s == "" then return nil end
    local ok, v = pcall(decode_value, s, 1)
    if ok then return v end
    return nil
end

return M
