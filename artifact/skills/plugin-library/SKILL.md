---
name: plugin-library
description: Open or query the Plugin Library explorer when the user wants to browse plugins, read a skill's full SKILL.md, or hand a skill to a Grok Bot. Use for "show me pstack's skills", "open the plugin library", "what does the why skill say".
---

# Plugin Library

A local web explorer over the Cursor plugin cache and the Plugin Catalog. Three
panes: plugins, a plugin's skills / agents / rules, and the full `SKILL.md` of
whatever is clicked. "Send to a bot" picks a target from the live `gbot`
roster and confirms before sending a direct message.

## Commands

In Cursor, use `/plugin-library [query]`. On a portable host without Cursor
commands, use the read-only API below only when the explorer is already
running; ask the user to start it rather than guessing an installation path.

## Read-only API

- `GET http://127.0.0.1:8787/api/library` returns
  `{ installed, marketplace, groups }`.
- `GET http://127.0.0.1:8787/api/local/<marketplace>/<slug>/doc/skills/<id>/SKILL.md`
  returns `{ meta, markdown }`.

Quote from `markdown`; never paraphrase a skill as if it were the skill's own
words.

## Hard rule

Do not call `POST /api/send`. Sending a plugin or skill to a bot is a
user-confirmed Explorer action; there is no agent-side path around it.
