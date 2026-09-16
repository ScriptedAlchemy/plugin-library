/**
 * plugin-library <start|stop|status|open [query]> [--json] [--browser] [--port N]
 *
 * `start` is idempotent: if the server already answers on the port it is left
 * alone, otherwise one is spawned detached and this process waits for health.
 * `open` starts, resolves `query` (plugin name, id, or skill id) to a deep link,
 * prints it, and with --browser hands it to the OS browser.
 */
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PID_FILE = path.join(ROOT, "logs", "server.pid");
const LOG_FILE = path.join(ROOT, "logs", "server.out");
const SERVER_ENTRY = fs.existsSync(path.join(ROOT, "scripts", "plugin-library-server.mjs"))
  ? path.join(ROOT, "scripts", "plugin-library-server.mjs")
  : path.join(ROOT, "server.js");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

const json = flag("--json");
const browser = flag("--browser");
const port = Number(option("--port", process.env.PORT || 8787));
const command = args.shift() || "open";
const query = args.join(" ").trim();
const base = `http://127.0.0.1:${port}`;

const out = (obj) => {
  if (json) console.log(JSON.stringify(obj));
  else console.log(obj.url || obj.message || JSON.stringify(obj));
};

async function healthy() {
  try {
    const r = await fetch(`${base}/api/library`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function start() {
  if (await healthy()) return { started: false, pid: readPid() };
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const log = fs.openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  for (let i = 0; i < 40; i++) {
    if (await healthy()) return { started: true, pid: child.pid };
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not become healthy on ${base}; see ${LOG_FILE}`);
}

function readPid() {
  try {
    return Number(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    return null;
  }
}

function stop() {
  const pid = readPid();
  if (!pid) return { stopped: false, message: "no pidfile; nothing to stop" };
  try {
    process.kill(pid, "SIGTERM");
    fs.rmSync(PID_FILE, { force: true });
    return { stopped: true, pid };
  } catch (e) {
    fs.rmSync(PID_FILE, { force: true });
    return { stopped: false, pid, message: e.code === "ESRCH" ? "process already gone" : e.message };
  }
}

/** Plugin name / id / skill id → hash route. Exact hits first, then substring. */
async function resolveHash(q) {
  if (!q) return "";
  const lib = await (await fetch(`${base}/api/library`)).json();
  const all = [...lib.installed, ...lib.marketplace];
  const norm = (s) => String(s || "").toLowerCase();
  const nq = norm(q);
  const byId = all.find((p) => p.plugin_id === q);
  if (byId) return `#/p/${byId.plugin_id}`;
  for (const p of lib.installed) {
    const skill = (p.local?.skills || []).find((s) => norm(s.id) === nq || norm(s.name) === nq);
    if (skill) return `#/p/${p.plugin_id}/s/${encodeURIComponent(skill.id)}`;
  }
  const byName = all.find((p) => norm(p.name) === nq) || all.find((p) => norm(p.name).includes(nq));
  if (byName) return `#/p/${byName.plugin_id}`;
  for (const p of lib.installed) {
    const skill = (p.local?.skills || []).find((s) => norm(s.id).includes(nq));
    if (skill) return `#/p/${p.plugin_id}/s/${encodeURIComponent(skill.id)}`;
  }
  return "";
}

function openInBrowser(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  return new Promise((resolve) => execFile(opener, [url], () => resolve()));
}

try {
  switch (command) {
    case "start": {
      const r = await start();
      out({ ok: true, url: `${base}/`, ...r, message: r.started ? `started on ${base}` : `already running on ${base}` });
      break;
    }
    case "stop":
      out({ ok: true, ...stop() });
      break;
    case "status": {
      const up = await healthy();
      out({ ok: true, running: up, url: `${base}/`, pid: readPid(), message: up ? `running on ${base}` : "not running" });
      break;
    }
    case "open": {
      const r = await start();
      const hash = await resolveHash(query);
      const url = `${base}/${hash}`;
      if (browser) await openInBrowser(url);
      out({ ok: true, url, resolved: Boolean(hash) || !query, query: query || null, started: r.started });
      break;
    }
    default:
      console.error(`unknown command: ${command}\nusage: plugin-library <start|stop|status|open [query]> [--json] [--browser] [--port N]`);
      process.exit(2);
  }
} catch (e) {
  if (json) console.log(JSON.stringify({ ok: false, error: e.message }));
  else console.error(e.message);
  process.exit(1);
}
