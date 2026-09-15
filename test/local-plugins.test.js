"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeCache } = require("./helpers");

process.env.CURSOR_PLUGIN_CACHE = makeCache();
const lib = require("../lib/local-plugins");

test("parseFrontMatter: quoted, folded, literal, nested map", () => {
  const md = [
    "---",
    'title: "He said \\"hi\\""',
    "folded: >-",
    "  one",
    "  two",
    "",
    "literal: |",
    "  a",
    "  b",
    "flag: true",
    "nested:",
    "  k: v",
    "  j: w",
    "after: yes",
    "---",
    "# Body",
  ].join("\n");
  const { meta, body } = lib.parseFrontMatter(md);
  assert.deepEqual(meta, { title: 'He said "hi"', folded: "one two", literal: "a\nb", flag: true, after: "yes" });
  assert.equal(body, "# Body");
});

test("parseFrontMatter: no front matter leaves body intact", () => {
  assert.deepEqual(lib.parseFrontMatter("# Hi\n"), { meta: {}, body: "# Hi\n" });
});

test("compareSemver orders numerically", () => {
  assert.ok(lib.compareSemver("1.10.0", "1.9.0") > 0);
  assert.ok(lib.compareSemver("0.1", "0.1.0") === 0);
  assert.ok(lib.compareSemver(null, "0.0.1") < 0);
});

test("dedupe prefers the .installed copy over a newer unmarked one and keeps the human slug", () => {
  const [kit] = lib.indexLocalPlugins().filter((p) => p.name === "Demo Kit");
  assert.equal(kit.key, "mkt/demo-kit");
  assert.deepEqual(kit.aliases, ["mkt/42"]);
  assert.equal(kit.semver, "1.0.0", "installed marker beats semver");
  assert.deepEqual(kit.skills.map((s) => s.id), ["alpha"]);
  assert.equal(kit.skills[0].description, "Folded description.");
  assert.deepEqual(kit.skills[0].files, ["references/more.md"]);
  assert.equal(kit.logo, "assets/logo.png");
});

test("findLocalPlugin: cache hint, numeric id, exact name, ambiguous → null", () => {
  assert.equal(lib.findLocalPlugin("999", "nope", "mkt/42").key, "mkt/demo-kit");
  assert.equal(lib.findLocalPlugin("42", "whatever").key, "mkt/demo-kit");
  assert.equal(lib.findLocalPlugin("999", "Demo Kit").key, "mkt/demo-kit");
  assert.equal(lib.findLocalPlugin("999", "Demo").key, "mkt/demo-kit", "unique containment");
  assert.equal(lib.findLocalPlugin("999", "zzz"), null);
  assert.equal(lib.getLocalPlugin("mkt/42").key, "mkt/demo-kit");
});

test("toPublic hides filesystem internals", () => {
  const pub = lib.toPublic(lib.getLocalPlugin("mkt/demo-kit"));
  assert.ok(!("root" in pub) && !("aliases" in pub) && !("matchKeys" in pub));
});

test("resolveInside: traversal and symlink escapes are rejected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pl-out-"));
  fs.writeFileSync(path.join(root, "ok.txt"), "x");
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(outside, "secret"), "x");
  fs.symlinkSync(path.join(outside, "secret"), path.join(root, "link"));
  assert.equal(lib.resolveInside(root, "ok.txt"), fs.realpathSync(path.join(root, "ok.txt")));
  assert.equal(lib.resolveInside(root, "../" + path.basename(outside) + "/secret"), null);
  assert.equal(lib.resolveInside(root, "link"), null, "symlink out of root");
  assert.equal(lib.resolveInside(root, "sub"), null, "directories are not files");
  assert.equal(lib.resolveInside(root, "missing"), null);
});
