---
name: plugin-library
description: Open the Plugin Library explorer (installed + marketplace plugins, full skill text, apply-to-bot). Optional argument jumps to a plugin or skill.
---

# /plugin-library [plugin or skill]

Launch the explorer and put it in front of the user.

1. Start (idempotent) and resolve the deep link:

   ```sh
   node "${CURSOR_PLUGIN_ROOT}/bin/plugin-library.mjs" open --json $ARGUMENTS
   ```

   If `CURSOR_PLUGIN_ROOT` is unset, the plugin lives at `~/.cursor/plugins/local/plugin-library`.
   The result is `{ ok, url, resolved, started }`. `url` already contains the `#/p/<id>/s/<skill>` route when `$ARGUMENTS` matched a plugin name, plugin id, or skill id.

2. Show it in the embedded browser when this session has one: call `browser_navigate` (cursor-ide-browser) with `url`.
   Without an embedded browser, re-run step 1 with `--browser` to hand the URL to the OS browser.

3. Reply with the URL as a link, whether the server was freshly started, and, if `resolved` is false with a non-empty argument, say the argument matched nothing and the library root opened instead.

Never POST to `/api/apply` on the user's behalf. Applying a skill to a bot is a click the user makes in the UI.
