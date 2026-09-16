# Plugin Library (sidecar browse UI)

Three-pane explorer for the Plugin Catalog: plugins → skills / agents / rules → the full `SKILL.md` rendered in a reading pane, sourced live from the on-disk plugin cache. "Apply to a bot" picks a target from the live `gbot` roster and confirms before anything is queued.

## Tour

Installed plugins, sorted by how much they ship. Search covers plugin names, descriptions and skill ids.

![Library](screens/01-library.png)

pstack's 47 skills, grouped the way the Catalog suggests (Workflows, Bot+style, Principles, Language), with agents and rules below.

![pstack](screens/02-pstack.png)

Click a skill and the full `SKILL.md` opens in the reading pane. Front matter becomes chips, sibling reference files become tabs, and relative links between them switch tabs instead of leaving the page. `#/p/9717366/s/why` is a shareable deep link.

![Reading a skill](screens/03-read-skill.png)

![A reference file](screens/04-reference-tab.png)

"Apply to a bot" pulls the live roster from `gbot` (bots and groups, with their avatars) and ends in one sentence you confirm. Every `/api/apply` status is turned into plain language; an install that isn't there yet is its own explicit step.

![Pick a bot](screens/05-pick-a-bot.png)

![Confirm](screens/06-confirm.png)

Every installed plugin gets the same treatment, not only pstack.

![Cursor Team Kit](screens/07-cursor-team-kit.png)

Marketplace listings show catalog copy and offer an install path.

![Marketplace](screens/08-marketplace.png)

Regenerate: the screenshots come from a headless-Chrome tour; keep them at 1600×1000 @2x so they match.

## Start

Requires Node 22.19+, a Cursor plugin cache at `~/.cursor/plugins/cache`, and
the [`gbot`](https://github.com/ScriptedAlchemy/grok-bot-cli) CLI on `PATH` for
the bot picker (the explorer works without it; the picker reports the missing
roster).

```bash
git clone https://github.com/ScriptedAlchemy/plugin-library.git
cd plugin-library
npm start
```

Default **8787** (`PORT=8787`). Binds loopback (`127.0.0.1`) by default because it shells out to `gbot` and serves cache files without auth; set `HOST=0.0.0.0` only on a trusted network. Open `http://127.0.0.1:8787/`.

## Install

### Cursor from GitHub

The `agent-bundle-artifact` branch is the generated, validated plugin root.
In Cursor Dashboard → Plugins → Team Marketplaces, choose **Add Marketplace**,
import `https://github.com/ScriptedAlchemy/plugin-library`, and select the
`agent-bundle-artifact` branch. Then install **Plugin Library** from Customize.
Team Marketplaces require a Cursor Teams or Enterprise plan.
If you previously imported `main`, re-import the marketplace and select the
generated branch.

#### Without team marketplace

```sh
git clone --branch agent-bundle-artifact --depth 1 \
  https://github.com/ScriptedAlchemy/plugin-library.git
cd plugin-library && node ./install.mjs
```

Reload Cursor (`Developer: Reload Window`). From that clone directory, verify
with `npx --no-install agent-bundle doctor --from . --host cursor`.

For a local proof from a checkout:

```bash
npm ci
npm run build
node artifact/install.mjs
npx --no-install agent-bundle doctor --from artifact --host cursor
```

### Grok Bot plugin path

This project treats Grok Bot's plugin path as an Agent Plugins 1.0.0 consumer.
Provide the generated root from the `agent-bundle-artifact` branch to that
host-managed flow; its `plugin.json` and `skills/` are the portable projection.
The `gbot` CLI has no plugin-install command, so the local gate proves the
portable pack, not remote Grok Bot activation.

In a Cursor agent session:

- `/plugin-library` opens the explorer (embedded browser when the session has one, OS browser otherwise).
- `/plugin-library pstack` or `/plugin-library why` deep-links to that plugin or skill.

On Grok Bot, load the `plugin-library` skill and use its read-only API against
an already-running explorer; the slash command is Cursor-only.

The command drives `scripts/plugin-library.mjs`, which is idempotent: it reuses
a running server or starts one detached (pid in `logs/server.pid`, output in
`logs/server.out`) and waits for `/api/library` to answer.

```bash
node artifact/scripts/plugin-library.mjs open [query] [--json] [--browser]
node artifact/scripts/plugin-library.mjs status --json
node artifact/scripts/plugin-library.mjs stop
```

The bundled skill also tells agents how to answer skill questions from the read-only API without opening a window, and forbids them from calling `POST /api/apply` — applying to a bot stays a user click.

`npm test` builds the generated artifact, then runs the `node --test` suite
(installer lifecycle, front matter, cache dedupe, path containment,
apply-status mapping, and an HTTP smoke test against a throwaway cache).

## Browse API (read-only)

| Route | Returns |
|-------|---------|
| `GET /api/library` | `{ installed, marketplace, groups }`: catalog rows joined to the on-disk plugin cache (`~/.cursor/plugins/cache`), with skills, agents, rules and logo per installed plugin |
| `GET /api/local/<marketplace>/<slug>/doc/<path>` | `{ meta, markdown }` for any `.md`/`.mdc` inside that cached plugin |
| `GET /api/local/<marketplace>/<slug>/file/<path>` | any other file inside that cached plugin (logos, scripts). Symlinks and `..` that leave the plugin root are 404 |
| `GET /api/bots` | live bots + groups from `gbot bots list` / `gbot groups list` (20s cache; `?refresh=1` bypasses) |

Override the cache root with `CURSOR_PLUGIN_CACHE`, the CLI with `GBOT_BIN`.

## Apply contract (Plugin Applier)

`POST /api/apply` body:

```json
{ "plugin_id": "…", "bot_ref": "…", "skill_id?": "…", "confirmed": true, "mode?": "profile_bake|nudge_send" }
```

| Result | When |
|--------|------|
| `needs_install_confirm` | not installed, `confirmed` not true |
| `install_queued` | not installed, `confirmed: true` → Applier drains → `InstallPlugin` (account only) |
| `missing_attach_api` | installed; no per-bot skill attach yet (default) |
| `profile_bake_queued` / `nudge_send_queued` | only if `mode` set + confirmed (opt-in; never silent) |

Also: `GET /api/apply/pending`, `POST /api/apply/ack` `{ "id" }`.

Explorer UI confirm counts as the user's Explorer confirm. No silent fleet bot writes.

## Data

Catalog JSON in `data/` (from Plugin Catalog) is copied to `assets/data/` in
the built plugin and read server-side only. pstack skill grouping:
`data/pstack.json`. When a plugin is cached twice (numeric id and slug), the
copy marked `<hash>.installed` wins, then the highest version.
