#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { randomUUID } = require("crypto");
const {
  findLocalPlugin,
  getLocalPlugin,
  toPublic,
  resolveInside,
  parseFrontMatter,
} = require("./lib/local-plugins");
const { listBots } = require("./lib/bots");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 8787);
// Loopback by default: this server shells out to gbot and serves cache files
// without auth. Set HOST=0.0.0.0 explicitly when exposing over Tailscale.
const HOST = process.env.HOST || "127.0.0.1";
const APPLY_LOG = path.join(ROOT, "logs", "apply.jsonl");
const PENDING_PATH = path.join(ROOT, "logs", "pending.json");

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
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Applier contract (Plugin Applier owns this):
 * POST /api/apply  body: { plugin_id, bot_ref, skill_id?, confirmed?, mode? }
 *   mode: omit | "install" | "apply" | "profile_bake" | "nudge_send"
 *   confirmed: true only after Explorer UI confirm (counts as the user's Explorer confirm)
 *
 * Responses:
 *   bad_request
 *   needs_install_confirm   — not installed, confirmed !== true
 *   install_queued          — not installed, confirmed === true → Applier drains → InstallPlugin
 *   missing_attach_api      — installed, bot skill attach not available yet
 *   profile_bake_queued / nudge_send_queued — only if mode opted in + confirmed
 *   already_installed_noop  — confirmed install request but plugin already installed and no skill/bot apply
 *
 * GET  /api/apply/pending   — undrained queue for Applier
 * POST /api/apply/ack       — { id } mark drained (Applier after InstallPlugin / handling)
 */

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function installedIds() {
  try {
    const idx = readJson("data/installed-index.json");
    return new Set((idx.installed || []).map((p) => String(p.plugin_id)));
  } catch {
    return new Set();
  }
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function sendFile(res, file, cacheControl = "no-store") {
  const ext = path.extname(file).toLowerCase();
  fs.createReadStream(file)
    .on("open", () => {
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": cacheControl,
      });
    })
    .on("error", (err) => {
      if (!res.headersSent) send(res, 404, { ok: false, error: "read_failed", message: err.code });
      else res.destroy();
    })
    .pipe(res);
}

function serveStatic(_req, res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = resolveInside(PUBLIC_DIR, rel);
  if (!file) return send(res, 404, { ok: false, error: "not_found", path: urlPath });
  return sendFile(res, file);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
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

function ensureLogsDir() {
  fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
}

function appendApplyLog(entry) {
  ensureLogsDir();
  fs.appendFileSync(APPLY_LOG, JSON.stringify(entry) + "\n");
}

function loadPending() {
  ensureLogsDir();
  if (!fs.existsSync(PENDING_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_PATH, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function savePending(list) {
  ensureLogsDir();
  fs.writeFileSync(PENDING_PATH, JSON.stringify(list, null, 2) + "\n");
}

function enqueuePending(item) {
  const list = loadPending();
  list.push(item);
  savePending(list);
}

async function handleApply(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { ok: false, error: "invalid_json" });
  }

  const plugin_id = body.plugin_id != null ? String(body.plugin_id) : "";
  const skill_id =
    body.skill_id != null && body.skill_id !== "" ? String(body.skill_id) : undefined;
  const bot_ref = body.bot_ref != null ? String(body.bot_ref) : "";
  const confirmed = body.confirmed === true;
  const mode =
    body.mode != null && body.mode !== "" ? String(body.mode) : undefined;

  const base = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    plugin_id,
    skill_id: skill_id || null,
    bot_ref,
    confirmed,
    mode: mode || null,
  };

  if (!plugin_id || !bot_ref) {
    const response = {
      ok: false,
      error: "bad_request",
      message: "plugin_id and bot_ref are required",
    };
    appendApplyLog({ ...base, response });
    return send(res, 400, response);
  }

  const installed = installedIds().has(plugin_id);

  // Account install path
  if (!installed) {
    if (!confirmed) {
      const response = {
        ok: false,
        error: "needs_install_confirm",
        plugin_id,
        message:
          "Plugin is not installed. Re-POST with confirmed:true after UI confirm; Applier will InstallPlugin (account-wide, no fleet bot writes).",
      };
      appendApplyLog({ ...base, response });
      return send(res, 200, response);
    }

    const pending = {
      ...base,
      action: "install",
      status: "queued",
    };
    enqueuePending(pending);
    const response = {
      ok: true,
      error: null,
      status: "install_queued",
      id: base.id,
      plugin_id,
      skill_id: skill_id || null,
      bot_ref,
      message:
        "Queued for Plugin Applier InstallPlugin. No bot profile mutation. Drain via GET /api/apply/pending then POST /api/apply/ack.",
    };
    appendApplyLog({ ...base, response, pending });
    return send(res, 200, response);
  }

  // Opt-in modes only (never silent)
  if (mode === "profile_bake" || mode === "nudge_send") {
    if (!confirmed) {
      const response = {
        ok: false,
        error: "needs_mode_confirm",
        mode,
        plugin_id,
        bot_ref,
        message: `Re-POST with confirmed:true to queue ${mode} (mutates/messages the named bot).`,
      };
      appendApplyLog({ ...base, response });
      return send(res, 200, response);
    }
    const pending = {
      ...base,
      action: mode,
      status: "queued",
    };
    enqueuePending(pending);
    const response = {
      ok: true,
      error: null,
      status: `${mode}_queued`,
      id: base.id,
      plugin_id,
      skill_id: skill_id || null,
      bot_ref,
      mode,
      message: `Queued ${mode} for Applier. Still requires Applier to execute; no silent fleet.`,
    };
    appendApplyLog({ ...base, response, pending });
    return send(res, 200, response);
  }

  // Default apply = per-bot skill attach — not available yet
  const response = {
    ok: false,
    error: "missing_attach_api",
    status: "missing_attach_api",
    plugin_id,
    skill_id: skill_id || null,
    bot_ref,
    message:
      "Plugin is installed account-wide, but there is no per-bot skill attach API yet. No profile bake / nudge unless mode=profile_bake|nudge_send + confirmed.",
  };
  appendApplyLog({ ...base, response });
  return send(res, 200, response);
}

async function handleAck(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { ok: false, error: "invalid_json" });
  }
  const id = body.id != null ? String(body.id) : "";
  if (!id) {
    return send(res, 400, { ok: false, error: "bad_request", message: "id required" });
  }
  const before = loadPending();
  const kept = before.filter((p) => p.id !== id);
  const removed = before.length - kept.length;
  savePending(kept);
  const response = {
    ok: removed > 0,
    error: removed > 0 ? null : "not_found",
    id,
    remaining: kept.length,
  };
  appendApplyLog({
    ts: new Date().toISOString(),
    kind: "ack",
    id,
    response,
  });
  return send(res, 200, response);
}

function handlePending(_req, res) {
  const pending = loadPending();
  return send(res, 200, {
    ok: true,
    count: pending.length,
    pending,
  });
}

function oneLine(s) {
  return String(s || "").split(/\n/)[0].trim();
}

/**
 * The browse model, joined once here: installed rows from the index, catalog
 * copy from the unified catalog, on-disk contents from the plugin cache, and
 * the Catalog's suggested skill grouping for pstack.
 */
function buildLibrary() {
  const installedRows = readJson("data/installed-index.json").installed || [];
  const catalog = readJson("data/unified-catalog.json").plugins || [];
  const catalogById = new Map(catalog.map((p) => [String(p.stableId ?? ""), p]));

  const installed = installedRows.map((row) => {
    const id = String(row.plugin_id);
    const cat = catalogById.get(id);
    const hint = cat && cat.cache && cat.cache.slug ? `${cat.cache.marketplace}/${cat.cache.slug}` : undefined;
    const local = findLocalPlugin(id, row.name, hint);
    return {
      plugin_id: id,
      name: row.name,
      description: oneLine(row.description) || (local && local.description) || oneLine(cat && cat.description),
      category: (cat && cat.category) || null,
      installed: true,
      skill_count: local ? local.skills.length : Number(row.skill_count) || 0,
      connector_count: Number(row.connector_count) || 0,
      local: local ? toPublic(local) : null,
    };
  });
  const installedIds = new Set(installed.map((p) => p.plugin_id));

  const marketplace = catalog
    .filter((p) => p.stableId != null && !installedIds.has(String(p.stableId)))
    .map((p) => ({
      plugin_id: String(p.stableId),
      name: p.name || "(unnamed)",
      description: oneLine(p.description),
      category: p.category || null,
      installed: false,
      skill_count: Number(p.skillCountReported ?? p.skillCount) || 0,
      connector_count: Number(p.connectorCount) || 0,
      local: null,
    }));

  const groups = {};
  try {
    const deep = readJson("data/pstack.json");
    if (deep.plugin_id && Array.isArray(deep.groups)) {
      groups[String(deep.plugin_id)] = deep.groups.map((g) => ({
        name: g.name || g.id,
        skillIds: (g.skills || []).map((s) => s.id),
      }));
    }
  } catch {
    // no deep dump: skills render ungrouped
  }

  return { ok: true, installed, marketplace, groups };
}

function handleLibrary(_req, res) {
  return send(res, 200, buildLibrary());
}

/** `/api/local/<marketplace>/<slug>/(doc|file)/<path>` */
function handleLocal(_req, res, pathname) {
  const m = /^\/api\/local\/([^/]+)\/([^/]+)\/(doc|file)\/(.+)$/.exec(pathname);
  if (!m) return send(res, 404, { ok: false, error: "not_found" });
  const plugin = getLocalPlugin(`${m[1]}/${m[2]}`);
  if (!plugin) return send(res, 404, { ok: false, error: "plugin_not_cached" });
  const file = resolveInside(plugin.root, m[4]);
  if (!file) return send(res, 404, { ok: false, error: "file_not_found" });

  if (m[3] === "doc") {
    if (!/\.mdc?$/i.test(file)) return send(res, 415, { ok: false, error: "not_markdown" });
    const { meta, body } = parseFrontMatter(fs.readFileSync(file, "utf8"));
    return send(res, 200, { ok: true, meta, markdown: body });
  }
  return sendFile(res, file, "private, max-age=300");
}

async function handleBots(_req, res, _pathname, url) {
  try {
    return send(res, 200, await listBots({ force: url.searchParams.has("refresh") }));
  } catch (e) {
    return send(res, 502, { ok: false, error: "gbot_unavailable", message: e.message });
  }
}

/** Route table: method + exact path or prefix. First match wins. */
const ROUTES = [
  ["GET", "/api/library", handleLibrary],
  ["GET", "/api/local/", handleLocal, "prefix"],
  ["GET", "/api/bots", handleBots],
  ["POST", "/api/apply", handleApply],
  ["GET", "/api/apply/pending", handlePending],
  ["POST", "/api/apply/ack", handleAck],
];

async function dispatch(req, res) {
  let url;
  let pathname;
  try {
    url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    // Reject malformed percent-escapes once, here, so handlers can trust pathname.
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, { ok: false, error: "bad_url" });
  }
  for (const [method, pathPattern, handler, mode] of ROUTES) {
    const hit = mode === "prefix" ? pathname.startsWith(pathPattern) : pathname === pathPattern;
    if (hit && req.method === method) return handler(req, res, pathname, url);
    if (hit) return send(res, 405, { ok: false, error: "method_not_allowed" });
  }
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, pathname);
  return send(res, 405, { ok: false, error: "method_not_allowed" });
}

const server = http.createServer((req, res) => {
  Promise.resolve()
    .then(() => dispatch(req, res))
    .catch((err) => {
      console.error(`${req.method} ${req.url} failed:`, err);
      if (!res.headersSent) send(res, 500, { ok: false, error: "internal", message: err.message });
      else res.end();
    });
});

server.listen(PORT, HOST, () => {
  const { port } = server.address();
  console.log(`plugin-library listening on http://${HOST}:${port}`);
  console.log(`  UI:      http://127.0.0.1:${port}/`);
  console.log(`  library: GET  /api/library`);
  console.log(`  bots:    GET  /api/bots`);
  console.log(`  apply:   POST /api/apply`);
  console.log(`  pending: GET  /api/apply/pending`);
  console.log(`  ack:     POST /api/apply/ack`);
});
