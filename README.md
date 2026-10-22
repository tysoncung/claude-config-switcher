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
bundle that VS Code replaces on every update. Any hand-edit would be lost. This
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

## Create a new profile

A profile is just a separate Claude Code config directory. Each directory keeps
its own login, settings, history, and `CLAUDE.md`, so you can run a personal
account and a work account side by side.

### 1. Create the config directory

Pick a name and create the folder. Use your real home path, since you will need
the absolute path later.

```bash
mkdir -p ~/.claude-work
echo "$HOME/.claude-work"     # copy this absolute path, e.g. /Users/you/.claude-work
```

### 2. Log in to that profile

Start the Claude Code CLI with `CLAUDE_CONFIG_DIR` pointing at the new folder,
then sign in with the account you want for this profile.

```bash
CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude
# inside Claude Code, run:
/login
```

The login is stored inside `~/.claude-work`, so it does not affect your default
`~/.claude` profile. Type `/exit` when done.

Optional: copy over settings you want to share between profiles.

```bash
cp ~/.claude/settings.json ~/.claude-work/   # global settings
cp ~/.claude/CLAUDE.md     ~/.claude-work/   # global instructions
```

### 3. Add the profile to VS Code

Open your **User** settings JSON (`Cmd+Shift+P` then
`Preferences: Open User Settings (JSON)`) and add the profile to
`claudeProfileSwitcher.profiles`, using the absolute path from step 1:

```json
"claudeProfileSwitcher.profiles": [
  { "label": "default", "configDir": "" },
  { "label": "work",    "configDir": "/Users/you/.claude-work" }
]
```

Do not use `~` here. The Claude Code extension ignores it.

### 4. Switch to it

Click `Claude: ...` in the status bar (or run `Claude Code: Switch Profile`),
pick **work**, and choose **Reload Window**. Claude Code now runs with the
`work` login and settings. Switch back to **default** the same way.

### Tip: matching terminal aliases

To use the same profiles from the terminal, add aliases to `~/.zshrc`:

```bash
alias claude-work='CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude'
alias claude-personal='CLAUDE_CONFIG_DIR="$HOME/.claude-personal" claude'
```

## Configure your profiles

Edit `claudeProfileSwitcher.profiles` in settings. Defaults:

```json
"claudeProfileSwitcher.profiles": [
  { "label": "default",  "configDir": "" },
  { "label": "personal", "configDir": "/Users/you/.claude-personal" },
  { "label": "work",     "configDir": "/Users/you/.claude-work" }
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

## Publish a release

A GitHub Actions workflow ([.github/workflows/release.yml](.github/workflows/release.yml))
builds the `.vsix` and attaches it to a GitHub Release whenever you push a
version tag.

1. Bump `version` in `package.json` (e.g. `0.1.0` to `0.2.0`) and commit.
2. Tag the commit with the same version, prefixed with `v`, and push the tag:

   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```

3. The workflow checks that the tag matches `package.json`, packages the
   extension with `vsce`, and creates a release with the `.vsix` attached and
   auto-generated notes.

Users then download the `.vsix` from the Releases page and install it:

```bash
code --install-extension claude-profile-switcher-0.2.0.vsix
```

You can also run the workflow by hand from the **Actions** tab. That builds the
`.vsix` as a downloadable artifact without creating a release.
