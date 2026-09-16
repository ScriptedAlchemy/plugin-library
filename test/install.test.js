"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function loadInstaller() {
  return import(pathToFileURL(path.join(__dirname, "..", "install.mjs")).href);
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function makeSourcePlugin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-library-src-"));
  writeFile(path.join(root, "package.json"), JSON.stringify({ name: "plugin-library", version: "0.3.0" }, null, 2));
  writeFile(path.join(root, ".cursor-plugin", "plugin.json"), JSON.stringify({ name: "plugin-library", version: "0.3.0" }, null, 2));
  writeFile(path.join(root, "README.md"), "# Plugin Library\n");
  writeFile(path.join(root, "commands", "plugin-library.md"), "# command\n");
  writeFile(path.join(root, "skills", "plugin-library", "SKILL.md"), "# skill\n");
  writeFile(path.join(root, ".git", "config"), "[core]\n");
  writeFile(path.join(root, "logs", "server.out"), "log\n");
  writeFile(path.join(root, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
  writeFile(path.join(root, "screens", "tour.png"), "png\n");
  writeFile(path.join(root, "data", "catalog.json"), "{}\n");
  writeFile(path.join(root, "test", "install.test.js"), "test\n");
  return root;
}

test("installBundle copies only the packaged plugin and writes a receipt", async () => {
  const { installBundle, RECEIPT_FILE } = await loadInstaller();
  const sourceRoot = makeSourcePlugin();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-library-dest-"));

  const result = installBundle({ sourceRoot, targetRoot });
  const installRoot = path.join(targetRoot, "plugin-library");

  assert.equal(result.changed, true);
  assert.equal(result.mode, "local");
  assert.equal(fs.lstatSync(installRoot).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(installRoot, "README.md")), true);
  assert.equal(fs.existsSync(path.join(installRoot, "commands", "plugin-library.md")), true);
  assert.equal(fs.existsSync(path.join(installRoot, ".git")), false);
  assert.equal(fs.existsSync(path.join(installRoot, "logs")), false);
  assert.equal(fs.existsSync(path.join(installRoot, "node_modules")), false);
  assert.equal(fs.existsSync(path.join(installRoot, "screens")), false);
  assert.equal(fs.existsSync(path.join(installRoot, "data", "catalog.json")), true);
  assert.equal(fs.existsSync(path.join(installRoot, "test")), false);

  const receipt = JSON.parse(fs.readFileSync(path.join(installRoot, RECEIPT_FILE), "utf8"));
  assert.equal(receipt.plugin, "plugin-library");
  assert.equal(receipt.version, "0.3.0");
  assert.equal(receipt.mode, "local");
  assert.deepEqual(receipt.registrations, ["cursor-local-plugin"]);
  assert.ok(Array.isArray(receipt.files) && receipt.files.includes("README.md"));
  assert.match(receipt.contentHash, /^[a-f0-9]{64}$/);
});

test("installBundle is idempotent when the content hash matches", async () => {
  const { installBundle } = await loadInstaller();
  const sourceRoot = makeSourcePlugin();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-library-dest-"));

  const first = installBundle({ sourceRoot, targetRoot });
  const second = installBundle({ sourceRoot, targetRoot });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.reason, "content hash matches");
});

test("planInstall and uninstallBundle support replace and dry-run uninstall", async () => {
  const { installBundle, planInstall, uninstallBundle } = await loadInstaller();
  const sourceRoot = makeSourcePlugin();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-library-dest-"));
  const installRoot = path.join(targetRoot, "plugin-library");

  installBundle({ sourceRoot, targetRoot });
  writeFile(path.join(sourceRoot, "INSTALL.md"), "# install\n");

  const replacePlan = planInstall({ sourceRoot, targetRoot, replace: true });
  assert.equal(replacePlan.action, "replace");
  assert.equal(replacePlan.targetDir, installRoot);

  const uninstallPlan = uninstallBundle({ targetRoot, plan: true });
  assert.equal(uninstallPlan.action, "remove");
  assert.equal(fs.existsSync(installRoot), true);

  const uninstall = uninstallBundle({ targetRoot });
  assert.equal(uninstall.changed, true);
  assert.equal(fs.existsSync(installRoot), false);
});
