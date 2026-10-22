# Claude Code Profile Switcher

A tiny companion VS Code extension that adds the profile-switching feature the
official Claude Code extension doesn't have. It flips `CLAUDE_CONFIG_DIR` (via
the official extension's `claudeCode.environmentVariables` setting) so you can
jump between separate Claude Code config directories / accounts.

## What it adds

- A **status bar item** (bottom-right) showing the active profile, e.g. `Claude: work`.
- A command **`Claude Code: Switch Profile`** (also the status bar click) that
  pops a picker of your profiles and, on selection, writes the setting and offers
  to reload the window.

## Why a separate extension (not a patch)

The official `anthropic.claude-code` extension is a closed-source, minified
bundle that VS Code replaces on every update — any hand-edit would be lost. This
extension sits beside it and drives it only through the supported
`claudeCode.environmentVariables` setting.

## Important constraints (learned from the official extension's manifest)

- `claudeCode.environmentVariables` is **`scope: machine`** → it can only live in
  **User settings**, never workspace `.vscode/settings.json`. This extension
  therefore always writes to User settings.
- `CLAUDE_CONFIG_DIR` **must be an absolute path**. The official extension ignores
  `~` and relative values. The switcher refuses non-absolute `configDir`s.
- Switching takes effect after a **window reload** (the extension reads env vars
  when it launches Claude). The picker offers to reload for you.

## Configure your profiles

Edit `claudeProfileSwitcher.profiles` in settings. Defaults:

```json
"claudeProfileSwitcher.profiles": [
  { "label": "default",  "configDir": "" },
  { "label": "personal", "configDir": "/Users/wennalee/.claude-personal" },
  { "label": "work",     "configDir": "/Users/wennalee/.claude-work" }
]
```

Empty `configDir` means the built-in default (`~/.claude`).

## Run it (development)

1. Open this folder in VS Code.
2. Press **F5** → an "Extension Development Host" window launches with the
   extension loaded. No `npm install` needed (zero runtime dependencies).
3. Look for `Claude: …` in the status bar; click it to switch.

## Install it permanently

Package to a `.vsix` and install:

```bash
cd ~/codes/claude-profile-switcher
npx @vscode/vsce package          # produces claude-profile-switcher-0.1.0.vsix
code --install-extension claude-profile-switcher-0.1.0.vsix
```

Then reload VS Code. (`vsce` may ask you to set a real `publisher`; any string
works for a local-only install.)
