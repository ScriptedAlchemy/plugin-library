"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const path = require("path");
const { makeCache } = require("./helpers");

let child;
let base;

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: "0", CURSOR_PLUGIN_CACHE: makeCache(), GBOT_BIN: "/nonexistent/gbot" },
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

test("/api/library joins installed rows to the cache", async () => {
  const j = await (await fetch(base + "/api/library")).json();
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.installed) && Array.isArray(j.marketplace));
  assert.ok(j.installed.length > 0);
  assert.ok(j.installed.every((p) => typeof p.plugin_id === "string" && typeof p.skill_count === "number"));
  assert.ok(j.installed.every((p) => !p.local || !("root" in p.local)), "no filesystem paths leak");
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
  assert.equal(await status("/logs/pending.json"), 404);
  assert.equal(await status("/"), 200);
});

test("/api/bots reports a missing gbot as 502", async () => {
  const r = await fetch(base + "/api/bots");
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, "gbot_unavailable");
});
