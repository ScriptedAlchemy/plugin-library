#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import localPlugins from "./lib/local-plugins.js";
import bots from "./lib/bots.js";

const {
  findLocalPlugin,
  getLocalPlugin,
  toPublic,
  resolveInside,
  parseFrontMatter,
} = localPlugins;
const { listBots, sendToBot } = bots;

const ENTRY_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(ENTRY_DIR) === "scripts" ? path.resolve(ENTRY_DIR, "..") : ENTRY_DIR;
const PUBLIC_DIR = fs.existsSync(path.join(ROOT, "public"))
  ? path.join(ROOT, "public")
  : path.join(ROOT, "assets", "public");
const PORT = Number(process.env.PORT || 8787);
// Loopback by default: this server shells out to gbot and serves cache files
// without auth. Set HOST=0.0.0.0 explicitly when exposing over Tailscale.
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
  ".txt": "text/plain; charset=utf-8",
};

function readJson(rel) {
  const sourcePath = path.join(ROOT, rel);
  const filePath = fs.existsSync(sourcePath) ? sourcePath : path.join(ROOT, "assets", rel);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function isSameOriginJson(req) {
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:;|$)/i.test(contentType)) return false;
  const fetchSite = req.headers["sec-fetch-site"];
  if (typeof fetchSite === "string" && fetchSite !== "same-origin") return false;
  const origin = req.headers.origin;
  if (typeof origin !== "string") return true;
  try {
    return new URL(origin).origin === `http://${req.headers.host}`;
  } catch {
    return false;
  }
}

async function handleSend(req, res) {
  if (!isSameOriginJson(req)) {
    return send(res, 403, { ok: false, error: "cross_origin_send_refused" });
  }
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
  if (!plugin_id || !bot_ref) {
    return send(res, 400, {
      ok: false,
      error: "bad_request",
      message: "plugin_id and bot_ref are required",
    });
  }

  const library = buildLibrary();
  const plugin = [...library.installed, ...library.marketplace]
    .find((candidate) => candidate.plugin_id === plugin_id);
  if (!plugin) return send(res, 404, { ok: false, error: "plugin_not_found" });
  const skill = skill_id && plugin.local
    ? plugin.local.skills.find((candidate) => candidate.id === skill_id)
    : undefined;
  if (skill_id && !skill) return send(res, 404, { ok: false, error: "skill_not_found" });

  let roster;
  try {
    roster = await listBots();
  } catch (error) {
    return send(res, 502, { ok: false, error: "gbot_unavailable", message: error.message });
  }
  const target = [...roster.bots, ...roster.groups].find((candidate) => candidate.id === bot_ref);
  if (!target || bot_ref.startsWith("-")) {
    return send(res, 404, { ok: false, error: "bot_not_found" });
  }

  const subject = skill
    ? `the "${skill.name}" skill from the "${plugin.name}" plugin`
    : `the "${plugin.name}" plugin`;
  try {
    await sendToBot(bot_ref, `Use ${subject} for the current task.`);
    return send(res, 200, {
      ok: true,
      status: "sent",
      plugin_id,
      skill_id: skill_id || null,
      bot_ref,
      message: `Sent ${subject} to the selected Grok Bot target.`,
    });
  } catch (error) {
    return send(res, 502, {
      ok: false,
      error: "gbot_unavailable",
      message: error.message,
    });
  }
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
  ["POST", "/api/send", handleSend],
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
  console.log(`  send:    POST /api/send`);
});
