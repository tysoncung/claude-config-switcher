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
- Commands **`Claude Code: Create Profile`** and **`Claude Code: Delete Profile`**,
  also available at the bottom of the switcher picker.

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

### From VS Code

Run **`Claude Code: Create Profile`** (or pick **Create new profile...** in the
switcher) and enter a name such as `work`. The extension:

1. creates `~/.claude-work`,
2. offers to copy `settings.json`, `CLAUDE.md`, `agents`, `commands` and `skills`
   from `~/.claude` (login and history are never copied),
3. offers **Log In**, which opens a terminal running `claude` with
   `CLAUDE_CONFIG_DIR` set so you can run `/login`, or **Switch Now**.

To remove one, run **`Claude Code: Delete Profile`**. After confirmation the
folder is moved to the Trash (so it can be recovered), and if it was the active
profile the switcher goes back to **default**. The default `~/.claude` is never
offered for deletion.

### By hand

#### 1. Create the config directory

Pick a name and create the folder as `~/.claude-<name>`. The extension finds
these automatically.

```bash
mkdir -p ~/.claude-work
```

#### 2. Log in to that profile

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

#### 3. (Optional) Add the profile to VS Code

`~/.claude-work` already appears in the picker as **work**. Only do this step if
you want a different label or your folder lives somewhere other than
`~/.claude-<name>`. Open your **User** settings JSON (`Cmd+Shift+P` then
`Preferences: Open User Settings (JSON)`) and add the profile to
`claudeProfileSwitcher.profiles`, using an absolute path:

```json
"claudeProfileSwitcher.profiles": [
  { "label": "default", "configDir": "" },
  { "label": "work",    "configDir": "/Users/you/.claude-work" }
]
```

Do not use `~` here. The Claude Code extension ignores it.

#### 4. Switch to it

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

Out of the box the picker shows **default** plus every `~/.claude-<name>`
directory in your home folder, labelled `<name>`. So `~/.claude-work` shows up
as **work** with no setup.

To rename a profile or point at a directory somewhere else, list it in
`claudeProfileSwitcher.profiles`:

```json
"claudeProfileSwitcher.profiles": [
  { "label": "default",  "configDir": "" },
  { "label": "personal", "configDir": "/Users/you/.claude-personal" },
  { "label": "work",     "configDir": "/Volumes/Work/claude-config" }
]
```

Empty `configDir` means the built-in default (`~/.claude`). Discovered
directories already listed here are not shown twice. Set
`claudeProfileSwitcher.autoDiscover` to `false` to show only the profiles you
list.

## Run it (development)

1. Open this folder in VS Code.
2. Press **F5** → an "Extension Development Host" window launches with the
   extension loaded. The extension has zero runtime dependencies, so this works
   without installing anything.
3. Look for `Claude: …` in the status bar; click it to switch.

Tooling uses [pnpm](https://pnpm.io). Run `pnpm install` once, then:

```bash
pnpm lint        # Biome lint + format check
pnpm format      # apply Biome fixes
pnpm run package # build the .vsix
```

CI runs Biome and packaging on every push and pull request, and audits the
GitHub workflows with [zizmor](https://docs.zizmor.sh). Dependency and action
updates come from [Renovate](https://docs.renovatebot.com) (`renovate.json`).

## Install it permanently

Package to a `.vsix` and install:

```bash
cd ~/codes/claude-profile-switcher
pnpm install
pnpm run package                  # produces claude-profile-switcher-<version>.vsix
code --install-extension claude-profile-switcher-<version>.vsix
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
   extension with `pnpm run package`, and creates a release with the `.vsix` attached and
   auto-generated notes.

Users then download the `.vsix` from the Releases page and install it:

```bash
code --install-extension claude-profile-switcher-0.3.0.vsix
```

You can also run the workflow by hand from the **Actions** tab. That builds the
`.vsix` as a downloadable artifact without creating a release.
