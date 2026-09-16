"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeCache } = require("./helpers");

let child;
let base;
let gbotCalls;

test.before(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-library-gbot-"));
  const gbot = path.join(temp, "gbot");
  gbotCalls = path.join(temp, "calls.jsonl");
  const cache = makeCache();
  const pstack = path.join(cache, "cursor-public", "pstack", "hash");
  fs.mkdirSync(path.join(pstack, ".cursor-plugin"), { recursive: true });
  fs.mkdirSync(path.join(pstack, "skills", "alpha"), { recursive: true });
  fs.writeFileSync(
    path.join(pstack, ".cursor-plugin", "plugin.json"),
    JSON.stringify({ name: "pstack", displayName: "pstack", version: "1.0.0" }),
  );
  fs.writeFileSync(path.join(pstack, "skills", "alpha", "SKILL.md"), "# Alpha\n");
  fs.writeFileSync(`${pstack}.installed`, "");
  // The same plugin cached again under its catalog id: an alias, not a second install.
  fs.cpSync(pstack, path.join(cache, "cursor-public", "9717366", "hash"), { recursive: true });
  // A hand-installed plugin in plugins/local/<name>/ with no catalog row.
  const local = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-library-local-"));
  fs.mkdirSync(path.join(local, "handmade", "skills", "solo"), { recursive: true });
  fs.writeFileSync(path.join(local, "handmade", "plugin.json"), JSON.stringify({ name: "handmade", displayName: "Handmade" }));
  fs.writeFileSync(path.join(local, "handmade", "skills", "solo", "SKILL.md"), "# Solo\n");
  fs.writeFileSync(gbot, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2).filter((arg) => arg !== "--json");
if (args[0] === "send") fs.appendFileSync(process.env.GBOT_CALLS, JSON.stringify(args) + "\\n");
process.stdout.write(JSON.stringify(args[0] === "send" ? { ok: true } : args[0] === "bots" ? [{ id: "bot-1", name: "Bot One" }] : []));
`);
  fs.chmodSync(gbot, 0o755);
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: "0", CURSOR_PLUGIN_CACHE: cache, CURSOR_PLUGIN_LOCAL: local, GBOT_BIN: gbot, GBOT_CALLS: gbotCalls },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = /listening on http:\/\/[^:]+:(\d+)/.exec(out);
      if (m) resolve(m[1]);
    });
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
  base = `http://127.0.0.1:${port}`;
});

test.after(() => child && child.kill());

const status = async (p, init) => (await fetch(base + p, init)).status;

test("/api/library: installed means present in this machine's cache or local dir", async () => {
  const j = await (await fetch(base + "/api/library")).json();
  assert.equal(j.ok, true);
  const ids = j.installed.map((p) => p.plugin_id).sort();
  assert.deepEqual(ids, ["9717366", "local:handmade", "mkt:demo-kit", "mkt:solo"]);
  const pstack = j.installed.find((p) => p.plugin_id === "9717366");
  assert.equal(pstack.local.key, "cursor-public/pstack", "catalog row claims the slug dir, alias dir is folded in");
  assert.equal(pstack.category, "MCP", "catalog copy joins onto the cached plugin");
  const handmade = j.installed.find((p) => p.plugin_id === "local:handmade");
  assert.equal(handmade.name, "Handmade");
  assert.equal(handmade.skill_count, 1);
  assert.ok(j.marketplace.every((p) => !p.installed && p.local === null));
  assert.ok(!j.marketplace.some((p) => p.plugin_id === "9717366"), "an installed plugin is not also listed for sale");
  assert.ok(j.installed.every((p) => !("root" in p.local)), "no filesystem paths leak");
});

test("doc and file routes serve from inside the plugin root only", async () => {
  const doc = await (await fetch(base + "/api/local/mkt/demo-kit/doc/skills/alpha/SKILL.md")).json();
  assert.equal(doc.meta.description, "Folded description.");
  assert.match(doc.markdown, /^# Alpha/);
  assert.equal(await status("/api/local/mkt/42/file/assets/logo.png"), 200, "numeric alias answers");
  assert.equal(await status("/api/local/mkt/demo-kit/doc/assets/logo.png"), 415);
  assert.equal(await status("/api/local/mkt/demo-kit/file/..%2F..%2F..%2Fetc%2Fpasswd"), 404);
  assert.equal(await status("/api/local/mkt/demo-kit/file/../../../etc/passwd"), 404);
  assert.equal(await status("/api/local/mkt/nope/file/x"), 404);
});

test("malformed escapes and wrong methods are errors, not crashes", async () => {
  assert.equal(await status("/api/local/mkt/demo-kit/file/%zz"), 400);
  assert.equal(await status("/api/bots", { method: "POST" }), 405);
  assert.equal(await status("/api/library"), 200, "still alive");
});

test("repo files outside public/ are not served", async () => {
  assert.equal(await status("/server.js"), 404);
  assert.equal(await status("/data/unified-catalog.json"), 404);
  assert.equal(await status("/logs/server.out"), 404);
  assert.equal(await status("/"), 200);
});

test("/api/bots returns the gbot roster", async () => {
  const r = await fetch(base + "/api/bots");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).bots[0].id, "bot-1");
});

test("/api/send messages gbot directly and the Applier API is gone", async () => {
  const r = await fetch(base + "/api/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plugin_id: "9717366", skill_id: "alpha", bot_ref: "bot-1" }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "sent");
  const [args] = fs.readFileSync(gbotCalls, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(args.slice(0, 2), ["send", "bot-1"]);
  assert.match(args[2], /"Alpha" skill from the "pstack" plugin/);
  assert.equal(await status("/api/send", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    body: "{}",
  }), 403);
  assert.equal(await status("/api/send", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: "{}",
  }), 403);
  assert.equal(await status("/api/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plugin_id: "9717366", bot_ref: "--files" }),
  }), 404);
  assert.equal(await status("/api/apply", { method: "POST" }), 405);
  assert.equal(await status("/api/apply/pending"), 404);
});
