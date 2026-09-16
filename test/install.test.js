"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const artifactRoot = path.join(__dirname, "..", "artifact");
const installer = path.join(artifactRoot, "install.mjs");
const { version } = require("../package.json");
const V = version.replace(/\./g, "\\.");

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-library-install-"));
  fs.mkdirSync(path.join(home, ".cursor"));
  return home;
}

function runInstaller(home, args = []) {
  const env = {
    ...process.env,
    HOME: home,
    XDG_STATE_HOME: path.join(home, ".local", "state"),
  };
  delete env.AGENT_BUNDLE_STATE_ROOT;
  return spawnSync(process.execPath, [installer, ...args], {
    encoding: "utf8",
    env,
  });
}

test("generated installer copies only the artifact and writes a lifecycle receipt", (t) => {
  const home = makeHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));

  const result = runInstaller(home);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Installed plugin-library@${V}`));

  const installed = path.join(home, ".cursor", "plugins", "local", "plugin-library");
  assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(installed, ".cursor-plugin", "plugin.json")), true);
  assert.equal(fs.existsSync(path.join(installed, "commands", "plugin-library.md")), true);
  assert.equal(fs.existsSync(path.join(installed, "skills", "plugin-library", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(installed, "assets", "data", "unified-catalog.json")), true);
  assert.equal(fs.existsSync(path.join(installed, "scripts", "plugin-library.mjs")), true);

  const receipt = JSON.parse(
    fs.readFileSync(path.join(installed, ".agent-bundle-install.json"), "utf8"),
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(artifactRoot, "agent-bundle.manifest.json"), "utf8"),
  );
  assert.equal(receipt.format, "agent-bundle-install-receipt/2");
  assert.equal(receipt.plugin, "plugin-library");
  assert.equal(receipt.version, version);
  assert.equal(receipt.host, "cursor");
  assert.equal(receipt.mode, "local");
  assert.equal(receipt.scope, "user");
  assert.deepEqual(receipt.registrations, [{ kind: "cursor-local-plugin" }]);
  assert.deepEqual(
    [...receipt.files].sort(),
    ["agent-bundle.manifest.json", ...manifest.files.map((file) => file.path)].sort(),
  );
  assert.match(receipt.contentHash, /^[a-f0-9]{64}$/);
});

test("generated installer is idempotent for identical content", (t) => {
  const home = makeHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));

  assert.equal(runInstaller(home).status, 0);
  const second = runInstaller(home);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, new RegExp(`Already installed plugin-library@${V}`));
});

test("generated installer plans and performs receipt-owned uninstall", (t) => {
  const home = makeHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  const installed = path.join(home, ".cursor", "plugins", "local", "plugin-library");

  assert.equal(runInstaller(home).status, 0);
  const plan = runInstaller(home, ["--uninstall", "--plan"]);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, new RegExp(`Would uninstall plugin-library@${V}`));
  assert.equal(fs.existsSync(installed), true);

  const uninstall = runInstaller(home, ["--uninstall"]);
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.match(uninstall.stdout, new RegExp(`Uninstalled plugin-library@${V}`));
  assert.equal(fs.existsSync(installed), false);
});
