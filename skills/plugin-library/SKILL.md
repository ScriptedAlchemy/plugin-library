---
name: plugin-library
description: Open or query the Plugin Library explorer when the user wants to browse plugins, read a skill's full SKILL.md, or hand a skill to a Grok Bot. Use for "show me pstack's skills", "open the plugin library", "what does the why skill say".
---

# Plugin Library

A local web explorer over the Cursor plugin cache and the Plugin Catalog. Three panes: plugins, a plugin's skills / agents / rules, and the full `SKILL.md` of whatever is clicked. "Apply to a bot" picks a target from the live `gbot` roster and confirms before anything is queued.

Public repo: `https://github.com/ScriptedAlchemy/plugin-library`. After `node ./install.mjs`, expect the installed plugin root at `~/.cursor/plugins/local/plugin-library`. A Mac path like `/Volumes/bigssd/.../plugin-library` is only a development checkout, not the installed plugin location agents should assume.

## Commands

```sh
node "${CURSOR_PLUGIN_ROOT}/bin/plugin-library.mjs" open [query] [--json] [--browser]
node "${CURSOR_PLUGIN_ROOT}/bin/plugin-library.mjs" status --json
node "${CURSOR_PLUGIN_ROOT}/bin/plugin-library.mjs" stop
```

`open` starts the server if it is not already answering, resolves `query` (plugin name, plugin id, or skill id) to a deep link, and prints it. Prefer the embedded browser (`browser_navigate`) over `--browser`.

## Read-only API, when the user wants an answer instead of a window

- `GET http://127.0.0.1:8787/api/library` → `{ installed, marketplace, groups }`. Installed rows carry `local.skills[]` with `id`, `name`, `description`, `files`.
- `GET http://127.0.0.1:8787/api/local/<marketplace>/<slug>/doc/skills/<id>/SKILL.md` → `{ meta, markdown }`. Use the `local.key` from the library row as `<marketplace>/<slug>`.

Quote from `markdown`; never paraphrase a skill as if it were the skill's own words.

## Hard rule

Do not call `POST /api/apply`. The Explorer confirm click is the confirm; there is no agent-side path around it.
