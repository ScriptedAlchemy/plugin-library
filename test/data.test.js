"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");

// The Plugin Catalog bot regenerates data/ from a sandbox and likes to include
// its own absolute paths. None of them belong in a public repo, and the server
// never reads them.
test("data/ carries no machine or sandbox paths", () => {
  for (const f of fs.readdirSync(DATA).filter((n) => n.endsWith(".json"))) {
    const text = fs.readFileSync(path.join(DATA, f), "utf8");
    const hit = /"(\/home\/|\/workspace\/|\/Users\/|\/Volumes\/)[^"]*"/.exec(text);
    assert.equal(hit, null, `${f} contains ${hit && hit[0]}`);
    JSON.parse(text);
  }
});

test("data/ holds exactly the files the server reads", () => {
  assert.deepEqual(fs.readdirSync(DATA).sort(), ["pstack.json", "unified-catalog.json"]);
});
