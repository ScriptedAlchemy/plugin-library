import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "npm_execpath is required; run this smoke through npm");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-library-packed-"));
const packages = path.join(temp, "packages");
const prefix = path.join(temp, "prefix");
const home = path.join(temp, "home");
fs.mkdirSync(packages, { recursive: true });
fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });

const runNpm = (args) =>
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

try {
  const packed = JSON.parse(
    runNpm(["pack", "./dist", "--json", "--ignore-scripts", "--pack-destination", packages]),
  );
  assert.equal(packed.length, 1);
  const tarball = path.join(packages, packed[0].filename);
  runNpm(["install", "--global", "--prefix", prefix, "--ignore-scripts", tarball]);

  const env = { ...process.env, HOME: home };
  const installBin = path.join(prefix, "bin", "plugin-library-install");
  const libraryBin = path.join(prefix, "bin", "plugin-library");
  execFileSync(installBin, ["install", "cursor"], { env, stdio: "inherit" });
  execFileSync(installBin, ["doctor", "--host", "cursor"], { env, stdio: "inherit" });

  const installed = path.join(home, ".cursor", "plugins", "local", "plugin-library");
  assert.ok(fs.existsSync(path.join(installed, ".cursor-plugin", "plugin.json")));
  assert.ok(fs.existsSync(path.join(installed, "assets", "data", "unified-catalog.json")));
  assert.ok(fs.existsSync(path.join(installed, "scripts", "plugin-library.mjs")));

  const port = 30_000 + (process.pid % 20_000);
  try {
    const started = JSON.parse(
      execFileSync(libraryBin, ["start", "--json", "--port", String(port)], {
        env,
        encoding: "utf8",
      }),
    );
    assert.equal(started.ok, true);
    const library = await (await fetch(`http://127.0.0.1:${port}/api/library`)).json();
    assert.equal(library.ok, true);
  } finally {
    execFileSync(libraryBin, ["stop", "--json", "--port", String(port)], {
      env,
      stdio: "ignore",
    });
  }
} finally {
  fs.rmSync(temp, { force: true, recursive: true });
}
