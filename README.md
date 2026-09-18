# Plugin Library

## Install

Requires Node 22.19+ and npm. Generated Agent Bundle artifacts are committed in `artifact/` on `main`; no project dependency installation or local build is needed.

Install the bot picker CLI from npm before installing the plugin:

```sh
npm install --global grok-bot-cli
```

### Cursor: install from GitHub

Dashboard → Plugins → Team Marketplaces → Add Marketplace:

```text
https://github.com/ScriptedAlchemy/plugin-library
```

Use the default `main` branch and install **Plugin Library**. Team Marketplaces require a Teams or Enterprise plan.

### Cursor: install from a clone

```sh
git clone --depth 1 https://github.com/ScriptedAlchemy/plugin-library.git
cd plugin-library
node artifact/install.mjs
```

Reload Cursor with **Developer: Reload Window**, then run `/plugin-library` in an agent session to open the explorer.

The npm package provides `gbot` on `PATH`. Sign in to Grok Bot before using the bot picker.

### Other Agent Plugins hosts

Use the committed `artifact/` directory with your host's plugin installer. It contains `plugin.json`, skills, bundled executables, and assets. The `/plugin-library` slash command is Cursor-only.

## Screenshots

![Plugin library](screens/01-library.png)

![pstack skills](screens/02-pstack.png)

![Reading a skill](screens/03-read-skill.png)

![Reference file](screens/04-reference-tab.png)

![Bot picker](screens/05-pick-a-bot.png)

![Send confirmation](screens/06-confirm.png)

![Cursor Team Kit](screens/07-cursor-team-kit.png)

![Marketplace](screens/08-marketplace.png)
