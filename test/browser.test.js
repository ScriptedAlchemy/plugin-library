"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserModules } = require("./helpers");

const { Markdown } = loadBrowserModules();

test("Markdown.render escapes HTML and renders core blocks", () => {
  const html = Markdown.render("# T <b>\n\npara with `code <x>` and **bold**\n\n- a\n- b\n\n```js\nlet x = 1 < 2;\n```\n\n| h |\n|---|\n| c |\n");
  assert.match(html, /<h1 id="t">T &lt;b&gt;<\/h1>/);
  assert.match(html, /<code>code &lt;x&gt;<\/code>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<pre><code class="lang-js">let x = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(html, /<table><thead><tr><th>h<\/th>/);
  assert.doesNotMatch(html, /<b>/);
});

test("Markdown.render resolves relative links against base and drops unsafe schemes", () => {
  const base = "/api/local/m/p/file/skills/s";
  const html = Markdown.render("[a](references/x.md) [b](./y.md) [c](../up.md) [d](javascript:void%200) [e](https://x.y/z)", { base });
  assert.match(html, /href="\/api\/local\/m\/p\/file\/skills\/s\/references\/x\.md" data-rel="references\/x\.md"/);
  assert.match(html, /href="\/api\/local\/m\/p\/file\/skills\/s\/y\.md" data-rel="y\.md"/);
  assert.match(html, /href="\/api\/local\/m\/p\/file\/skills\/s\/up\.md" data-rel="up\.md"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<a href="https:\/\/x\.y\/z" target="_blank"/);
  assert.equal(Markdown.render("[d](references/x.md)"), "<p>d</p>", "no base: relative links become text");
});
