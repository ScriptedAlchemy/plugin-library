"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

/** A throwaway plugin cache with the shapes the real one has. */
function makeCache() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-cache-"));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const manifest = (name, version) => JSON.stringify({ name, displayName: "Demo Kit", version, logo: "assets/logo.png" });

  // Numeric-id dir at 1.0.0, marked installed; slug dir at 1.1.0, unmarked.
  write("mkt/42/aaa/.cursor-plugin/plugin.json", manifest("demo-kit", "1.0.0"));
  write("mkt/42/aaa/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: >-\n  Folded\n  description.\nmetadata:\n  nested: 1\n---\n# Alpha\n\nBody [see](references/more.md).\n");
  write("mkt/42/aaa/skills/alpha/references/more.md", "# More\n");
  write("mkt/42/aaa/assets/logo.png", "png");
  write("mkt/42/aaa.installed", "");
  write("mkt/demo-kit/bbb/.cursor-plugin/plugin.json", manifest("demo-kit", "1.1.0"));
  write("mkt/demo-kit/bbb/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: \"Newer \\\"quoted\\\"\"\n---\n# Alpha v2\n");
  write("mkt/demo-kit/bbb/skills/beta/SKILL.md", "# Beta\n\nFirst paragraph.\n");
  // A connector-only plugin with no manifest.
  write("mkt/solo/ccc/mcp.json", "{}");
  return root;
}

/** Load the browser IIFEs (markdown.js, picker.js) into one sandbox and return its globals. */
function loadBrowserModules() {
  const window = {};
  window.window = window; // the sandbox global doubles as `window`, like a browser
  const ctx = vm.createContext(window);
  for (const f of ["markdown.js", "picker.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", f), "utf8"), ctx, { filename: f });
  }
  return window;
}

module.exports = { makeCache, loadBrowserModules };
