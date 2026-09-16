# Install Plugin Library

## Cursor

Works on both macOS and Linux. The installer uses Node's `os.homedir()` and `path.join()` so the local plugin lands at `~/.cursor/plugins/local/plugin-library` on either platform without any Mac-only path assumptions.

From a checkout, install the local plugin copy with:

```bash
node ./install.mjs
```

That safe-copies this repo into `~/.cursor/plugins/local/plugin-library` and writes a small `.agent-bundle-install.json` receipt so repeat installs can no-op when nothing changed. End users do not need the `agent-bundle` package or CLI for this flow. Reload Cursor after install.

If you would rather add it straight from GitHub, use Cursor's Add Plugin flow with:

```text
https://github.com/ScriptedAlchemy/plugin-library
```

Cursor Marketplace submission is a separate step at <https://cursor.com/marketplace/publish>.

## Sidecar UI

The explorer server is a sidecar app. Start it from a checkout with:

```bash
npm start
```

It binds `127.0.0.1:8787` by default. Open <http://127.0.0.1:8787/>.

On this cloud run, Linux install/test coverage is the verified path. After merge, do a macOS Plugin Explorer smoke check in Cursor as the final consumer validation.

## Claude

```bash
claude plugin marketplace add https://github.com/ScriptedAlchemy/plugin-library
claude plugin install plugin-library@plugin-library-marketplace
```

## Codex

```bash
codex plugin marketplace add https://github.com/ScriptedAlchemy/plugin-library
codex plugin add plugin-library@plugin-library-marketplace
```
