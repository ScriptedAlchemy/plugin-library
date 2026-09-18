# Install plugin-library

Browse installed and marketplace plugins, read every skill in full, and hand one to a Grok Bot.

Version: `0.4.0`

Run these commands from this bundle directory. The bundle is self-contained: every command below is
a host command or the bundled installer, and nothing requires the `agent-bundle` CLI. Where that CLI is
mentioned it is optional and automates the same steps.

## Cursor

Cursor has no non-interactive plugin install command. The bundled installer supports two delivery modes.

### Local plugin (default)

```sh
node ./install.mjs
```

It safe-copies the bundle to `~/.cursor/plugins/local/plugin-library`. Restart Cursor or run
`Developer: Reload Window` after installation. Cursor loads rules, skills, MCP servers, and the
manifest-declared `hooks/hooks.json` from that directory; plugin hooks run from the plugin root with
`${CURSOR_PLUGIN_ROOT}` substituted and need no `~/.cursor/hooks.json` entry.

### Reinstall after a same-version rebuild

The installer writes an install receipt (`.agent-bundle-install.json`: plugin, version, content hash,
owned files) beside the plugin manifest. Re-running `node ./install.mjs` on an identical artifact
is a no-op that says so. When the installed copy has the same version but different content, the
installer replaces its owned files in place and leaves runtime state (`state/`) untouched:

```sh
node ./install.mjs            # same-version content drift of a receipt-managed copy is replaced
node ./install.mjs --replace  # also replace a different installed version, or adopt a pre-receipt copy
```

`--force` is an alias for `--replace`. A directory that is not an agent-bundle install of this
plugin is always refused with an installed-versus-artifact content-hash comparison; remove it
manually. The optional `agent-bundle` CLI applies the same policy through
`agent-bundle install cursor --from ./ [--replace]`.

### Uninstall

```sh
node ./install.mjs --uninstall --plan                        # print exactly what would be removed
node ./install.mjs --uninstall                               # remove the receipt-owned files; keep state/
node ./install.mjs --uninstall --purge-data --confirm-purge  # also remove durable runtime state
node ./install.mjs --uninstall --mode marketplace            # remove a staged marketplace repository
```

Uninstall removes exactly what the receipt owns: the listed files, the directories the installer
created (including `~/.cursor/plugins/local` when the installer made it), and nothing else. Durable
runtime state under `state/` (state kernel, notices journal) — and, for an Agent Plugins pack with a stdio
server, the `~/.cursor/agent-bundle/plugin-data/<name>` directory the receipt records as `PLUGIN_DATA` — is kept
unless `--purge-data --confirm-purge` is passed (a kept data directory leaves a remnant receipt behind so a later
purge still finds it; an empty one is pruned); unowned files are left in place and listed. A supported older
receipt with no recorded state location retains the current environment's default as unproven; a keep-data run
cannot turn that observation into later purge authority. A directory without a receipt is refused unless
`--force` (which removes a pre-receipt legacy copy by its inventory); owned content that no longer matches
the receipt is refused unless `--force`; a directory that is not this plugin's install is always refused.
A second run is a `Not installed` no-op. With the optional `agent-bundle` CLI,
`agent-bundle uninstall cursor --from ./ [--mode marketplace]` applies the same policy, and
`agent-bundle doctor --from ./` shows the lifecycle stage (placed, registered, enabled, active) with
unobservable stages typed `unavailable`.

### Marketplace plugin

```sh
node ./install.mjs --mode marketplace
```

It stages a committed Git repository at `~/.cursor/agent-bundle/marketplaces/plugin-library` whose
`.cursor-plugin/marketplace.json` lists this plugin, then prints the exact Cursor step: Customize -> Plugins ->
"Add Plugins from Local Repository" -> select that directory -> Install. Cursor then shows the plugin as a
marketplace install (not "local") and manages it from Customize. `git` must be on PATH. Verify in Cursor:
Customize -> Plugins lists the plugin, and its files appear under `~/.cursor/plugins/cache`. The optional
`agent-bundle` CLI performs the same check with `agent-bundle doctor --host cursor`.

## Portable Agent Plugin

Portable is a distribution profile, not a host runtime with one universal install location.
This bundle follows the Agent Plugins open standard (Agent Plugins 1.0.0, https://agent-plugins.org).
Cursor loads this format natively from `~/.cursor/plugins/local/<name>`; restart Cursor or run
`Developer: Reload Window` after copying it. The bundled installer provides the Cursor local copy:

```sh
node ./install.mjs
```

### Other recorded clients

Each line below is pinned to that client's own documentation on the date shown, and names only the
paths this build actually wrote. Recognizing a document and running what it configures are separate:
`mcp` records that the client reads the emitted `mcp.json` as MCP configuration, while `placeholders`
records that it expands the reserved `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` and provides them to the
process it spawns. A client can do the first without the second, and then a plugin-relative server
is configured but not runnable there.

- **Antigravity** (docs retrieved 2026-09-06; no product or CLI version is published on any page) loads nothing from this bundle as published. Not loaded: manifest, skills, mcp, placeholders, hooks.
- **Cascade (Devin Desktop)** (docs.devin.ai/desktop retrieved 2026-09-06; Windsurf renamed to Devin Desktop, Cascade documented as the legacy agent beside the Devin Local agent) loads the components it recognizes without reading the manifest. Reads: `skills`. Install: `cp -R skills/<skill> .agents/skills/<skill>`. Not loaded: manifest, mcp, placeholders, hooks.
  - Partial `skills`: 2026-09-06: the emitted package root is not a Cascade discovery root; each skill directory is copied into .windsurf/skills/, ~/.codeium/windsurf/skills/, or .agents/skills/ before Cascade sees it, and the copy is what loads.
- **Cline** (@cline/cli 0.0.13 exercised 2026-09-06; docs.cline.bot retrieved 2026-09-06 (@cline/sdk 0.0.82)) loads the components it recognizes without reading the manifest. Reads: `skills`. Install: `cp -R skills/<skill> ~/.cline/skills/<skill>`. Not loaded: manifest, mcp, placeholders, hooks.
  - Partial `skills`: 2026-09-06: the skill tree must be copied into one of Cline's own roots; the emitted package is not a Cline install unit, and no CLI verb in @cline/cli 0.0.13 performs the copy.
- **CodeWhale** (Hmbown/CodeWhale main 19d34a5fb6c07b34e0b7234beb74a1cf1969efb4, docs retrieved 2026-09-06 (native Agent Plugins v1.0.0 support since v0.9.4)) loads this bundle as one plugin. Reads: `plugin.json`, `skills`. Install: `/plugin install ./<plugin directory>`. Not loaded: placeholders, hooks.
- **GitHub Copilot CLI** (@github/copilot 1.0.83, installed and exercised 2026-09-06) loads this bundle as one plugin. Reads: `plugin.json`, `skills`. Install: `copilot plugin install <plugin directory>`. Not loaded: hooks. A root that also carries `.plugin/plugin.json` uses it for manifest and still reads the rest. A root that also carries `.mcp.json` uses it for mcp and still reads the rest.
- **Devin CLI** (Agent Plugins 1.0.0; docs retrieved 2026-09-06, plugins documented as closed beta) loads this bundle as one plugin. Reads: `plugin.json`, `skills`. Install: `devin plugins install <plugin directory>`. Not loaded: hooks. A root that also carries `.devin-plugin/plugin.json` is read as that plugin instead. A root that also carries `.claude-plugin/plugin.json` is read as that plugin instead.
- **Gemini CLI** (@google/gemini-cli 0.58.0, installed and exercised 2026-09-06) loads the components it recognizes without reading the manifest. Reads: `skills`. Install: `gemini skills install <plugin directory>/skills/<skill>`. Not loaded: manifest, mcp, placeholders, hooks.
- **Grok Build** (xai-org/grok-build main 72a61251fcffb464bcc687aeb5a998e5a98ec0c9, docs retrieved 2026-09-06) loads the components it recognizes without reading the manifest. Reads: `skills`. Install from a marketplace (no local-directory install is verified for this artifact): `grok plugin install <marketplace plugin name> --trust`. Not loaded: manifest, mcp, placeholders, hooks.
- **Hermes Agent** (hermes-agent.nousresearch.com developer guide retrieved 2026-09-06; no version is printed on the page) loads this bundle as one plugin. Reads: `plugin.json`, `skills`. Install from a Git repository (no local-directory install is verified for this artifact): `hermes plugins install <owner>/<repository> --no-enable`. Not loaded: hooks.
  - Partial `manifest`: 2026-09-06: the validation rule set is not published: the page never states that the manifest root is treated as closed or what happens to an unknown root key.
- **JetBrains Junie** (junie.jetbrains.com/docs retrieved 2026-09-06, agent-skills page dated 01 September 2026; no CLI version is published on the page) loads the components it recognizes without reading the manifest. Reads: `skills`. Register: `junie --skill-location <plugin directory>/skills`. Not loaded: manifest, mcp, placeholders, hooks.
  - Partial `skills`: 2026-09-06: the emitted skills/ root is not a default location, so it loads only once registered with --skill-location or the skill-locations config field, and "if a project-level and a user-level skills have the same name, the user-level skill will be skipped".
- **Kiro (Powers)** (kiro.dev/docs/powers pages updated September 2, 2026 and August 4, 2026, retrieved 2026-09-06) loads this bundle as one plugin. Reads: `plugin.json`, `skills`. Install: `Powers panel -> Add Custom Power -> Import power from a folder -> select <plugin directory> -> Install`. Not loaded: placeholders, hooks.
  - Partial `manifest`: 2026-09-06: Kiro's "Required fields" table additionally requires version, description, author, and keywords, where the canonical schema requires only $schema and name — so a bundle that declares no portable author or keywords metadata does not meet Kiro's tightened manifest, and Kiro publishes no validation-error behavior to say what happens then.
- **OpenClaw** (Agent Plugins 1.0.0; docs retrieved 2026-09-06) loads this bundle as one plugin, but this build also writes `.cursor-plugin/plugin.json`, which it reads as the plugin instead.
- **OpenCode** (opencode-ai 1.18.29 exercised 2026-09-06; opencode.ai/docs retrieved 2026-09-06) loads the components it recognizes without reading the manifest. Reads: `skills`. Install: `cp -R skills/<skill> .agents/skills/<skill>`. Not loaded: manifest, mcp, placeholders, hooks.
  - Partial `skills`: 2026-09-06: the skill tree must be copied into one of OpenCode's own roots; the emitted package as a whole is not an OpenCode install unit, and skill names must be unique across all roots ("Ensure skill names are unique across all locations").
- **Pi** (@mariozechner/pi-coding-agent 0.73.1 installed from npm 2026-09-07; packaged docs/skills.md and docs/packages.md read from that release) loads the components it recognizes without reading the manifest. Reads: `skills`. Register: `pi --skill <plugin directory>/skills`. Not loaded: manifest, mcp, placeholders, hooks.
  - Partial `skills`: 2026-09-07: the emitted skills/ root is not one of the scanned default roots, so it loads only when it is named with --skill or added to the `skills` settings array; discovery inside it is recursive once named.
- **Qoder CLI** (docs retrieved 2026-09-06; no CLI version is published on any page) loads the components it recognizes without reading the manifest. Reads: `skills`. Install: `qoder plugins install <plugin directory> --scope user`. Not loaded: manifest, placeholders, hooks. A root that also carries `.mcp.json` uses it for mcp and still reads the rest.
- **Swival** (docs retrieved 2026-09-06; no product version is published on the documentation pages) loads the components it recognizes without reading the manifest. Reads: `skills`. Register: `swival --skills-dir <plugin directory>/skills "<task>"`. Not loaded: manifest, mcp, placeholders, hooks.
  - Partial `skills`: 2026-09-06: the emitted skills/ root is not a default location, so it loads only once registered with --skills-dir or the swival.toml skills_dir field, and it loses by name to the default roots: "If the same skill name exists in multiple locations, the first one in the precedence order wins", with .swival/skills/ and .agents/skills/ ahead of --skills-dir paths. A registered tree outside the project resolves as external, which Swival adds "as read-only roots".
- **VS Code (Copilot agent plugins)** (code.visualstudio.com/docs/agent-customization/agent-plugins, page footer 9/2/2026, retrieved 2026-09-06) loads this bundle as one plugin. Reads: `plugin.json`, `skills`. Register: `"chat.pluginLocations": { "<plugin directory>": true }`. Not loaded: placeholders, hooks.
- **Zed Agent** (zed.dev/docs retrieved 2026-09-06; no page publishes a version or last-updated date) loads the components it recognizes without reading the manifest. Reads: `skills`. Install: `cp -R skills/<skill> ~/.agents/skills/<skill>`. Not loaded: manifest, mcp, placeholders, hooks.
  - Partial `skills`: 2026-09-06: only the skill folders load, one copy at a time, and the catalog is capped — "50KB catalog budget… Skills that don't fit are dropped from the catalog with a warning in the UI" — so a large emitted skill set is not guaranteed to be wholly visible.

### Cursor placeholder expansion

Cursor 3.18.25 spawns the stdio servers of an Agent Plugins package without expanding
`${PLUGIN_ROOT}` / `${PLUGIN_DATA}` in `args`, `env` values, or `cwd`, without providing the
reserved `PLUGIN_ROOT` / `PLUGIN_DATA` variables (spec §9.1), with an omitted `cwd` defaulting to
the home directory, and with plugin-relative `./` commands resolved against the workspace folder
(spec §7.2.1). The installer therefore rewrites `mcp.json` in the Cursor copy only: the plugin root
becomes `~/.cursor/plugins/local/<name>`, the data directory `~/.cursor/agent-bundle/plugin-data/<name>`
(created by the installer), an omitted `cwd` becomes the plugin root, `./` commands resolve against
it, and every stdio server gains `PLUGIN_ROOT` / `PLUGIN_DATA` in its environment. The bundle itself
stays spec-conformant; the pre-expansion document is kept in `.agent-bundle-install.json` (`cursorExpansion`),
and the optional `agent-bundle doctor --host cursor` verifies the expanded paths (`AB7326`). Nothing is changed for
other clients; the recorded clients above name which of them expand the placeholders themselves.

### Reinstall after a same-version rebuild

The installer records an install receipt (`.agent-bundle-install.json`) and replaces its owned files in
place when the same version was rebuilt with different content; runtime state (`state/`) is never
touched. Pass `--replace` (alias `--force`) to replace a different installed version or to adopt a
copy installed before receipts existed. Foreign directories are refused with a content-hash
comparison. For a client that manages its own copy, remove and re-add the plugin through that client
when only content changed at the same version.

### Uninstall

```sh
node ./install.mjs --uninstall --plan                        # print exactly what would be removed
node ./install.mjs --uninstall                               # remove the receipt-owned files; keep state/
node ./install.mjs --uninstall --purge-data --confirm-purge  # also remove durable runtime state
```

Uninstall removes exactly what the receipt owns (files, installer-created directories) and keeps
durable runtime state under `state/` (and the recorded `PLUGIN_DATA` directory of an Agent Plugins pack)
unless `--purge-data --confirm-purge` is passed. A missing
receipt or modified owned content is refused unless `--force`; foreign directories are always refused.
