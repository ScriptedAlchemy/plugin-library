#!/usr/bin/env node
import * as __rspack_external_node_fs_1b05aee1 from "node:fs";
import * as __rspack_external_node_http_e245b239 from "node:http";
import * as __rspack_external_node_path_806ed179 from "node:path";
import * as __rspack_external_node_url_3991086a from "node:url";
import { createRequire as __rspack_createRequire } from "node:module";
const __rspack_createRequire_require = __rspack_createRequire(import.meta.url);
var __webpack_modules__ = ({
"node:fs"(module) {

module.exports = __rspack_external_node_fs_1b05aee1;


},
"node:http"(module) {

module.exports = __rspack_external_node_http_e245b239;


},
"node:path"(module) {

module.exports = __rspack_external_node_path_806ed179;


},
"node:url"(module) {

module.exports = __rspack_external_node_url_3991086a;


},
"child_process"(module) {
module.exports = __rspack_createRequire_require("child_process");

},
"fs"(module) {
module.exports = __rspack_createRequire_require("fs");

},
"os"(module) {
module.exports = __rspack_createRequire_require("os");

},
"path"(module) {
module.exports = __rspack_createRequire_require("path");

},
"./lib/bots.js"(module, __unused_rspack_exports, __webpack_require__) {

const { execFile } = __webpack_require__("child_process");
const GBOT_BIN = process.env.GBOT_BIN || "gbot";
const TTL_MS = 20000;
let cache = {
    at: 0,
    value: null
};
let inflight = null;
function runGbot(args) {
    return new Promise((resolve, reject)=>{
        execFile(GBOT_BIN, [
            ...args,
            "--json"
        ], {
            timeout: 15000,
            maxBuffer: 8 * 1024 * 1024
        }, (err, stdout, stderr)=>{
            if (err) {
                const e = new Error(err.code === "ENOENT" ? `\`${GBOT_BIN}\` not found on PATH` : String(stderr || stdout || err.message).trim());
                e.code = err.code;
                return reject(e);
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (parseErr) {
                reject(new Error(`gbot ${args.join(" ")}: bad JSON (${parseErr.message})`));
            }
        });
    });
}
/** Send one confirmed instruction directly through gbot. */ async function sendToBot(target, message) {
    const result = await runGbot([
        "send",
        target,
        message
    ]);
    if (!result || typeof result !== "object") throw new Error("gbot send: expected an object");
    return result;
}
/** Boundary check on gbot output: a shape change surfaces as a 502, not an empty roster. */ function shapeList(list, what) {
    if (!Array.isArray(list)) throw new Error(`gbot ${what} list: expected an array`);
    return list.map((b)=>{
        if (!b || typeof b.id !== "string" || typeof b.name !== "string") {
            throw new Error(`gbot ${what} list: entry without string id/name`);
        }
        return shapeBot(b);
    });
}
function shapeBot(b) {
    return {
        id: b.id,
        name: b.name,
        kind: b.kind || "bot",
        description: b.description || "",
        avatarColor: b.avatarColor || null,
        avatarShape: b.avatarShape || null,
        members: Array.isArray(b.members) ? b.members : undefined
    };
}
/** Bots and groups from `gbot`, cached briefly and de-duplicated across callers. */ async function listBots({ force = false } = {}) {
    if (!force && cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
    if (inflight) return inflight;
    inflight = (async ()=>{
        const [bots, groups] = await Promise.all([
            runGbot([
                "bots",
                "list"
            ]),
            runGbot([
                "groups",
                "list"
            ])
        ]);
        const value = {
            ok: true,
            fetchedAt: new Date().toISOString(),
            bots: shapeList(bots, "bots"),
            groups: shapeList(groups, "groups")
        };
        cache = {
            at: Date.now(),
            value
        };
        return value;
    })();
    try {
        return await inflight;
    } finally{
        inflight = null;
    }
}
module.exports = {
    listBots,
    sendToBot
};


},
"./lib/local-plugins.js"(module, __unused_rspack_exports, __webpack_require__) {

const fs = __webpack_require__("fs");
const os = __webpack_require__("os");
const path = __webpack_require__("path");
// Marketplace installs land in cache/<marketplace>/<slug>/<version-hash>/;
// hand-installed plugins sit directly in local/<name>/. Env overrides exist
// for tests and for hosts that keep the plugin directory elsewhere.
const CACHE_ROOT = process.env.CURSOR_PLUGIN_CACHE || path.join(os.homedir(), ".cursor", "plugins", "cache");
const LOCAL_ROOT = process.env.CURSOR_PLUGIN_LOCAL || path.join(os.homedir(), ".cursor", "plugins", "local");
const LOCAL_MARKETPLACE = "local";
const INDEX_TTL_MS = 15000;
let cached = {
    at: 0,
    plugins: []
};
function listDirs(dir) {
    try {
        return fs.readdirSync(dir, {
            withFileTypes: true
        }).filter((d)=>d.isDirectory()).map((d)=>d.name);
    } catch  {
        return [];
    }
}
function readText(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch  {
        return null;
    }
}
function readJsonFile(file) {
    const raw = readText(file);
    if (raw == null) return null;
    try {
        return JSON.parse(raw);
    } catch  {
        return null;
    }
}
function mtimeOf(file) {
    try {
        return fs.statSync(file).mtimeMs;
    } catch  {
        return 0;
    }
}
function unquote(v) {
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
        return v.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
        return v.slice(1, -1).replace(/''/g, "'");
    }
    if (v === "true") return true;
    if (v === "false") return false;
    return v;
}
/**
 * YAML front matter as skills actually write it: `key: scalar`, quoted
 * scalars, and `>`/`|` block scalars (folded / literal, with `-`/`+` chomping).
 * Nested maps and sequences are not needed by any cached plugin and are skipped.
 */ function parseFrontMatter(md) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
    if (!m) return {
        meta: {},
        body: md
    };
    const lines = m[1].split(/\r?\n/);
    const meta = {};
    for(let i = 0; i < lines.length; i++){
        const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
        if (!kv) continue;
        const value = kv[2].trim();
        const nextIndented = i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]);
        const block = /^([>|])[+-]?$/.exec(value);
        if (!block) {
            if (value === "" && nextIndented) {
                // Nested map or sequence: not needed by the UI, skip its body.
                while(i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1].trim() === ""))i++;
                continue;
            }
            if (value !== "") meta[kv[1]] = unquote(value);
            continue;
        }
        const buf = [];
        while(i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")){
            buf.push(lines[++i].replace(/^\s+/, ""));
        }
        while(buf.length && buf[buf.length - 1] === "")buf.pop();
        meta[kv[1]] = block[1] === ">" ? buf.join(" ").replace(/\s+/g, " ").trim() : buf.join("\n");
    }
    return {
        meta,
        body: md.slice(m[0].length)
    };
}
function firstHeading(body) {
    const h = /^#\s+(.+)$/m.exec(body);
    return h ? h[1].trim() : null;
}
function firstParagraph(body) {
    const buf = [];
    for (const line of body.split(/\r?\n/)){
        const t = line.trim();
        if (!t || /^#/.test(t) || /^---/.test(t)) {
            if (buf.length) break;
            continue;
        }
        buf.push(t);
    }
    return buf.join(" ");
}
function walkFiles(dir, prefix = "") {
    const out = [];
    let entries = [];
    try {
        entries = fs.readdirSync(dir, {
            withFileTypes: true
        });
    } catch  {
        return out;
    }
    for (const e of entries){
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) out.push(...walkFiles(path.join(dir, e.name), rel));
        else out.push(rel);
    }
    return out;
}
/** Shared shape for skills, agents and rules: a markdown doc with a summary. */ function readDoc(root, file, id) {
    const raw = readText(path.join(root, file));
    if (raw == null) return null;
    const { meta, body } = parseFrontMatter(raw);
    return {
        id,
        name: typeof meta.name === "string" && meta.name ? meta.name : firstHeading(body) || id,
        description: typeof meta.description === "string" ? meta.description : firstParagraph(body),
        file,
        bytes: Buffer.byteLength(raw, "utf8"),
        alwaysApply: meta.alwaysApply === true
    };
}
function readSkills(root) {
    const skillsDir = path.join(root, "skills");
    return listDirs(skillsDir).map((id)=>{
        const doc = readDoc(root, `skills/${id}/SKILL.md`, id);
        if (!doc) return null;
        const files = walkFiles(path.join(skillsDir, id)).filter((f)=>f !== "SKILL.md").sort();
        return {
            ...doc,
            files
        };
    }).filter(Boolean).sort((a, b)=>a.id.localeCompare(b.id));
}
function readDocsIn(root, sub, ext) {
    const dir = path.join(root, sub);
    return walkFiles(dir).filter((f)=>ext.test(f)).map((f)=>readDoc(root, `${sub}/${f}`, f.replace(ext, ""))).filter(Boolean);
}
function httpUrl(v) {
    return typeof v === "string" && /^https?:\/\//i.test(v) ? v : null;
}
function normalizeName(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function readManifest(root) {
    return readJsonFile(path.join(root, ".cursor-plugin", "plugin.json")) || readJsonFile(path.join(root, "plugin.json")) || {};
}
/** One plugin directory, before any file inside it has been read. */ function candidate({ marketplace, slug, version, root, installedMarker }) {
    const manifest = readManifest(root);
    return {
        key: `${marketplace}/${slug}`,
        marketplace,
        slug,
        version,
        root,
        manifest,
        installedMarker,
        mtime: mtimeOf(root),
        packageName: manifest.name || slug,
        semver: typeof manifest.version === "string" ? manifest.version : null
    };
}
function scanCache(cacheRoot) {
    const out = [];
    for (const marketplace of listDirs(cacheRoot)){
        for (const slug of listDirs(path.join(cacheRoot, marketplace))){
            const pluginDir = path.join(cacheRoot, marketplace, slug);
            for (const version of listDirs(pluginDir).filter((v)=>!v.startsWith("."))){
                const root = path.join(pluginDir, version);
                // Cursor marks the version it actually installed with a sibling `<hash>.installed`.
                out.push(candidate({
                    marketplace,
                    slug,
                    version,
                    root,
                    installedMarker: fs.existsSync(`${root}.installed`)
                }));
            }
        }
    }
    return out;
}
function scanLocal(localRoot) {
    return listDirs(localRoot).filter((name)=>!name.startsWith(".")).map((name)=>candidate({
            marketplace: LOCAL_MARKETPLACE,
            slug: name,
            version: "local",
            root: path.join(localRoot, name),
            installedMarker: true
        }));
}
function readContents(c) {
    const { manifest, root } = c;
    return {
        key: c.key,
        aliases: c.aliases,
        marketplace: c.marketplace,
        slug: c.slug,
        version: c.version,
        root,
        name: manifest.displayName || manifest.name || c.slug,
        description: manifest.description || "",
        author: manifest.author && manifest.author.name ? manifest.author.name : null,
        homepage: httpUrl(manifest.homepage) || httpUrl(manifest.repository && manifest.repository.url) || httpUrl(manifest.repository),
        semver: c.semver,
        logo: manifest.logo && fs.existsSync(path.join(root, manifest.logo)) ? manifest.logo : null,
        hasReadme: fs.existsSync(path.join(root, "README.md")),
        hasMcp: fs.existsSync(path.join(root, "mcp.json")),
        skills: readSkills(root),
        agents: readDocsIn(root, "agents", /\.md$/),
        rules: readDocsIn(root, "rules", /\.mdc?$/),
        matchKeys: c.matchKeys
    };
}
function compareSemver(a, b) {
    const pa = String(a || "").split(".").map((n)=>parseInt(n, 10) || 0);
    const pb = String(b || "").split(".").map((n)=>parseInt(n, 10) || 0);
    for(let i = 0; i < Math.max(pa.length, pb.length); i++){
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
}
/**
 * The cache often holds one plugin several times: under its numeric id and
 * under its slug, sometimes at different versions. Serve the copy Cursor marked
 * as installed; otherwise the newest. The winner answers to every directory
 * name the plugin was found under.
 */ function dedupe(candidates) {
    const groups = new Map();
    for (const c of candidates){
        const identity = `${c.marketplace}/${c.packageName}`;
        if (!groups.has(identity)) groups.set(identity, []);
        groups.get(identity).push(c);
    }
    const out = [];
    for (const group of groups.values()){
        group.sort((a, b)=>Number(b.installedMarker) - Number(a.installedMarker) || compareSemver(b.semver, a.semver) || b.mtime - a.mtime);
        const keep = group[0];
        const humanSlug = group.find((c)=>!/^\d+$/.test(c.slug)) || keep;
        const aliases = new Set(group.map((c)=>c.key));
        aliases.delete(humanSlug.key);
        const names = group.flatMap((c)=>[
                normalizeName(c.manifest.displayName),
                normalizeName(c.manifest.name),
                normalizeName(c.slug)
            ]);
        out.push({
            ...keep,
            key: humanSlug.key,
            slug: humanSlug.slug,
            aliases: [
                ...aliases
            ],
            matchKeys: [
                ...new Set(names.filter(Boolean))
            ]
        });
    }
    return out;
}
function indexLocalPlugins() {
    if (Date.now() - cached.at < INDEX_TTL_MS) return cached.plugins;
    const candidates = [
        ...scanCache(CACHE_ROOT),
        ...scanLocal(LOCAL_ROOT)
    ];
    cached = {
        at: Date.now(),
        plugins: dedupe(candidates).map(readContents)
    };
    return cached.plugins;
}
function answersTo(p, key) {
    return p.key === key || p.aliases.includes(key);
}
/**
 * Match an installed catalog row to a cached plugin. Order of trust: an
 * explicit cache key from the catalog, a directory named after the plugin id,
 * an exact normalized-name hit, then a name-containment hit only when it is
 * unambiguous. A wrong `null` is honest; a wrong hit would be acted on.
 */ function findLocalPlugin(pluginId, name, cacheKey) {
    const all = indexLocalPlugins();
    if (cacheKey) {
        const hit = all.find((p)=>answersTo(p, cacheKey));
        if (hit) return hit;
    }
    const id = String(pluginId || "");
    const byId = all.find((p)=>p.slug === id || p.aliases.some((a)=>a.endsWith(`/${id}`)));
    if (byId) return byId;
    const norm = normalizeName(name);
    if (!norm) return null;
    const exact = all.filter((p)=>p.matchKeys.includes(norm));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    const loose = all.filter((p)=>p.matchKeys.some((k)=>k.length >= 6 && (norm.includes(k) || k.includes(norm))));
    return loose.length === 1 ? loose[0] : null;
}
function getLocalPlugin(key) {
    return indexLocalPlugins().find((p)=>answersTo(p, key)) || null;
}
/** The wire shape for a cached plugin. Internal fields (root, aliases, …) stay here. */ function toPublic(p) {
    return {
        key: p.key,
        name: p.name,
        description: p.description,
        author: p.author,
        homepage: p.homepage,
        semver: p.semver,
        logo: p.logo,
        hasReadme: p.hasReadme,
        hasMcp: p.hasMcp,
        skills: p.skills,
        agents: p.agents,
        rules: p.rules
    };
}
/**
 * Resolve `rel` inside `root`, following symlinks, or return null if the real
 * path escapes the root or is not a regular file.
 */ function resolveInside(root, rel) {
    let realRoot;
    let full;
    try {
        realRoot = fs.realpathSync(root);
        full = fs.realpathSync(path.resolve(root, rel));
    } catch  {
        return null;
    }
    if (full !== realRoot && !full.startsWith(realRoot + path.sep)) return null;
    try {
        return fs.statSync(full).isFile() ? full : null;
    } catch  {
        return null;
    }
}
module.exports = {
    indexLocalPlugins,
    dedupe,
    compareSemver,
    findLocalPlugin,
    getLocalPlugin,
    toPublic,
    resolveInside,
    parseFrontMatter
};


},

});
// The module cache
var __webpack_module_cache__ = {};

// The require function
function __webpack_require__(moduleId) {

// Check if module is in cache
var cachedModule = __webpack_module_cache__[moduleId];
if (cachedModule !== undefined) {
return cachedModule.exports;
}
// Create a new module (and put it into the cache)
var module = (__webpack_module_cache__[moduleId] = {
exports: {}
});
// Execute the module function
__webpack_modules__[moduleId](module, module.exports, __webpack_require__);

// Return the exports of the module
return module.exports;

}

var __webpack_exports__ = {};
/* import */ var node_fs__rspack_import_0 = __webpack_require__("node:fs");
/* import */ var node_http__rspack_import_1 = __webpack_require__("node:http");
/* import */ var node_path__rspack_import_2 = __webpack_require__("node:path");
/* import */ var node_url__rspack_import_3 = __webpack_require__("node:url");
/* import */ var _lib_local_plugins_js__rspack_import_4 = __webpack_require__("./lib/local-plugins.js");
/* import */ var _lib_bots_js__rspack_import_5 = __webpack_require__("./lib/bots.js");
//






const { findLocalPlugin, getLocalPlugin, indexLocalPlugins, toPublic, resolveInside, parseFrontMatter } = _lib_local_plugins_js__rspack_import_4;
const { listBots, sendToBot } = _lib_bots_js__rspack_import_5;
const ENTRY_DIR = node_path__rspack_import_2["default"].dirname((0,node_url__rspack_import_3.fileURLToPath)(import.meta.url));
const ROOT = node_path__rspack_import_2["default"].basename(ENTRY_DIR) === "scripts" ? node_path__rspack_import_2["default"].resolve(ENTRY_DIR, "..") : ENTRY_DIR;
const PUBLIC_DIR = node_fs__rspack_import_0["default"].existsSync(node_path__rspack_import_2["default"].join(ROOT, "public")) ? node_path__rspack_import_2["default"].join(ROOT, "public") : node_path__rspack_import_2["default"].join(ROOT, "assets", "public");
const PORT = Number(process.env.PORT || 8787);
// Loopback by default: this server shells out to gbot and serves cache files
// without auth. Set HOST=0.0.0.0 explicitly only on a network you trust.
const HOST = process.env.HOST || "127.0.0.1";
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".md": "text/markdown; charset=utf-8",
    ".mdc": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8"
};
function readJson(rel) {
    const sourcePath = node_path__rspack_import_2["default"].join(ROOT, rel);
    const filePath = node_fs__rspack_import_0["default"].existsSync(sourcePath) ? sourcePath : node_path__rspack_import_2["default"].join(ROOT, "assets", rel);
    return JSON.parse(node_fs__rspack_import_0["default"].readFileSync(filePath, "utf8"));
}
function send(res, status, body, type = "application/json; charset=utf-8") {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store"
    });
    res.end(data);
}
function sendFile(res, file, cacheControl = "no-store") {
    const ext = node_path__rspack_import_2["default"].extname(file).toLowerCase();
    node_fs__rspack_import_0["default"].createReadStream(file).on("open", ()=>{
        res.writeHead(200, {
            "Content-Type": MIME[ext] || "application/octet-stream",
            "Cache-Control": cacheControl
        });
    }).on("error", (err)=>{
        if (!res.headersSent) send(res, 404, {
            ok: false,
            error: "read_failed",
            message: err.code
        });
        else res.destroy();
    }).pipe(res);
}
function serveStatic(_req, res, urlPath) {
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const file = resolveInside(PUBLIC_DIR, rel);
    if (!file) return send(res, 404, {
        ok: false,
        error: "not_found",
        path: urlPath
    });
    return sendFile(res, file);
}
function readBody(req) {
    return new Promise((resolve, reject)=>{
        const chunks = [];
        req.on("data", (c)=>chunks.push(c));
        req.on("end", ()=>{
            const raw = Buffer.concat(chunks).toString("utf8");
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (e) {
                reject(e);
            }
        });
        req.on("error", reject);
    });
}
function isSameOriginJson(req) {
    const contentType = req.headers["content-type"];
    if (typeof contentType !== "string" || !/^application\/json(?:;|$)/i.test(contentType)) return false;
    const fetchSite = req.headers["sec-fetch-site"];
    if (typeof fetchSite === "string" && fetchSite !== "same-origin") return false;
    const origin = req.headers.origin;
    if (typeof origin !== "string") return true;
    try {
        return new node_url__rspack_import_3.URL(origin).origin === `http://${req.headers.host}`;
    } catch  {
        return false;
    }
}
async function handleSend(req, res) {
    if (!isSameOriginJson(req)) {
        return send(res, 403, {
            ok: false,
            error: "cross_origin_send_refused"
        });
    }
    let body;
    try {
        body = await readBody(req);
    } catch  {
        return send(res, 400, {
            ok: false,
            error: "invalid_json"
        });
    }
    const plugin_id = body.plugin_id != null ? String(body.plugin_id) : "";
    const skill_id = body.skill_id != null && body.skill_id !== "" ? String(body.skill_id) : undefined;
    const bot_ref = body.bot_ref != null ? String(body.bot_ref) : "";
    if (!plugin_id || !bot_ref) {
        return send(res, 400, {
            ok: false,
            error: "bad_request",
            message: "plugin_id and bot_ref are required"
        });
    }
    const library = buildLibrary();
    const plugin = [
        ...library.installed,
        ...library.marketplace
    ].find((candidate)=>candidate.plugin_id === plugin_id);
    if (!plugin) return send(res, 404, {
        ok: false,
        error: "plugin_not_found"
    });
    const skill = skill_id && plugin.local ? plugin.local.skills.find((candidate)=>candidate.id === skill_id) : undefined;
    if (skill_id && !skill) return send(res, 404, {
        ok: false,
        error: "skill_not_found"
    });
    let roster;
    try {
        roster = await listBots();
    } catch (error) {
        return send(res, 502, {
            ok: false,
            error: "gbot_unavailable",
            message: error.message
        });
    }
    const target = [
        ...roster.bots,
        ...roster.groups
    ].find((candidate)=>candidate.id === bot_ref);
    if (!target || bot_ref.startsWith("-")) {
        return send(res, 404, {
            ok: false,
            error: "bot_not_found"
        });
    }
    const subject = skill ? `the "${skill.name}" skill from the "${plugin.name}" plugin` : `the "${plugin.name}" plugin`;
    try {
        await sendToBot(bot_ref, `Use ${subject} for the current task.`);
        return send(res, 200, {
            ok: true,
            status: "sent",
            plugin_id,
            skill_id: skill_id || null,
            bot_ref,
            message: `Sent ${subject} to the selected Grok Bot target.`
        });
    } catch (error) {
        return send(res, 502, {
            ok: false,
            error: "gbot_unavailable",
            message: error.message
        });
    }
}
function oneLine(s) {
    return String(s || "").split(/\n/)[0].trim();
}
/**
 * Plugins present on this machine but absent from the catalog get their cache
 * key as id (`local:gbot`, `cursor-public:foo`). Catalog ids are numeric, so
 * the colon marks a synthetic id unambiguously and keeps the hash route intact.
 */ const syntheticId = (p)=>`${p.marketplace}:${p.slug}`;
/**
 * The browse model, joined once here. "Installed" means present in this
 * machine's plugin cache or local plugin directory; the catalog supplies
 * marketplace copy, category and ids, and the Catalog's pstack dump supplies
 * skill grouping. Catalog rows that name their cache directory are matched
 * first so a looser name match can't claim a plugin another row owns.
 */ function buildLibrary() {
    const catalog = (readJson("data/unified-catalog.json").plugins || []).filter((p)=>p.stableId != null);
    const cacheHint = (p)=>p.cache && p.cache.slug ? `${p.cache.marketplace}/${p.cache.slug}` : undefined;
    const ordered = [
        ...catalog.filter(cacheHint),
        ...catalog.filter((p)=>!cacheHint(p))
    ];
    const claimed = new Set();
    const installed = [];
    const marketplace = [];
    for (const cat of ordered){
        const id = String(cat.stableId);
        const hit = findLocalPlugin(id, cat.name, cacheHint(cat));
        const local = hit && !claimed.has(hit.key) ? hit : null;
        if (local) claimed.add(local.key);
        (local ? installed : marketplace).push({
            plugin_id: id,
            name: cat.name || local && local.name || "(unnamed)",
            description: oneLine(cat.description) || oneLine(local && local.description),
            category: cat.category || null,
            installed: Boolean(local),
            skill_count: local ? local.skills.length : Number(cat.skillCountReported ?? cat.skillCount) || 0,
            connector_count: Number(cat.connectorCount) || 0,
            local: local ? toPublic(local) : null
        });
    }
    // A directory named after a catalog id whose row already claimed its slug
    // twin is the same plugin cached twice, not a second install.
    const catalogIds = new Set(catalog.map((p)=>String(p.stableId)));
    for (const p of indexLocalPlugins()){
        if (claimed.has(p.key) || catalogIds.has(p.slug)) continue;
        installed.push({
            plugin_id: syntheticId(p),
            name: p.name,
            description: oneLine(p.description),
            category: null,
            installed: true,
            skill_count: p.skills.length,
            connector_count: p.hasMcp ? 1 : 0,
            local: toPublic(p)
        });
    }
    const groups = {};
    try {
        const deep = readJson("data/pstack.json");
        if (deep.plugin_id && Array.isArray(deep.groups)) {
            groups[String(deep.plugin_id)] = deep.groups.map((g)=>({
                    name: g.name || g.id,
                    skillIds: (g.skills || []).map((s)=>s.id)
                }));
        }
    } catch  {
    // no deep dump: skills render ungrouped
    }
    return {
        ok: true,
        installed,
        marketplace,
        groups
    };
}
function handleLibrary(_req, res) {
    return send(res, 200, buildLibrary());
}
/** `/api/local/<marketplace>/<slug>/(doc|file)/<path>` */ function handleLocal(_req, res, pathname) {
    const m = /^\/api\/local\/([^/]+)\/([^/]+)\/(doc|file)\/(.+)$/.exec(pathname);
    if (!m) return send(res, 404, {
        ok: false,
        error: "not_found"
    });
    const plugin = getLocalPlugin(`${m[1]}/${m[2]}`);
    if (!plugin) return send(res, 404, {
        ok: false,
        error: "plugin_not_cached"
    });
    const file = resolveInside(plugin.root, m[4]);
    if (!file) return send(res, 404, {
        ok: false,
        error: "file_not_found"
    });
    if (m[3] === "doc") {
        if (!/\.mdc?$/i.test(file)) return send(res, 415, {
            ok: false,
            error: "not_markdown"
        });
        const { meta, body } = parseFrontMatter(node_fs__rspack_import_0["default"].readFileSync(file, "utf8"));
        return send(res, 200, {
            ok: true,
            meta,
            markdown: body
        });
    }
    return sendFile(res, file, "private, max-age=300");
}
async function handleBots(_req, res, _pathname, url) {
    try {
        return send(res, 200, await listBots({
            force: url.searchParams.has("refresh")
        }));
    } catch (e) {
        return send(res, 502, {
            ok: false,
            error: "gbot_unavailable",
            message: e.message
        });
    }
}
/** Route table: method + exact path or prefix. First match wins. */ const ROUTES = [
    [
        "GET",
        "/api/library",
        handleLibrary
    ],
    [
        "GET",
        "/api/local/",
        handleLocal,
        "prefix"
    ],
    [
        "GET",
        "/api/bots",
        handleBots
    ],
    [
        "POST",
        "/api/send",
        handleSend
    ]
];
async function dispatch(req, res) {
    let url;
    let pathname;
    try {
        url = new node_url__rspack_import_3.URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        // Reject malformed percent-escapes once, here, so handlers can trust pathname.
        pathname = decodeURIComponent(url.pathname);
    } catch  {
        return send(res, 400, {
            ok: false,
            error: "bad_url"
        });
    }
    for (const [method, pathPattern, handler, mode] of ROUTES){
        const hit = mode === "prefix" ? pathname.startsWith(pathPattern) : pathname === pathPattern;
        if (hit && req.method === method) return handler(req, res, pathname, url);
        if (hit) return send(res, 405, {
            ok: false,
            error: "method_not_allowed"
        });
    }
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, pathname);
    return send(res, 405, {
        ok: false,
        error: "method_not_allowed"
    });
}
const server = node_http__rspack_import_1["default"].createServer((req, res)=>{
    Promise.resolve().then(()=>dispatch(req, res)).catch((err)=>{
        console.error(`${req.method} ${req.url} failed:`, err);
        if (!res.headersSent) send(res, 500, {
            ok: false,
            error: "internal",
            message: err.message
        });
        else res.end();
    });
});
server.listen(PORT, HOST, ()=>{
    const { port } = server.address();
    console.log(`plugin-library listening on http://${HOST}:${port}`);
    console.log(`  UI:      http://127.0.0.1:${port}/`);
    console.log(`  library: GET  /api/library`);
    console.log(`  bots:    GET  /api/bots`);
    console.log(`  send:    POST /api/send`);
});

