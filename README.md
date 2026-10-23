# Claude Config Switcher

A tiny companion VS Code extension that adds the profile-switching feature the
official Claude Code extension doesn't have. It picks which `CLAUDE_CONFIG_DIR`
Claude Code uses, so you can keep separate config directories / accounts and
use a different one in each window or project.

## Install

From the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=tysoncung.cc-config-switcher):
search for **Claude Config Switcher** in the Extensions view, or run

```bash
code --install-extension tysoncung.cc-config-switcher
```

## What it adds

- A **status bar item** (bottom-right) showing this window's profile and why:
  `$(account)` global default, `$(pinned)` pinned to the project, `$(window)`
  this window only. `$(sync)` means a change is waiting for a reload.
- **`Claude Code: Switch Profile`** (also the status bar click). Clicking a
  profile changes whichever setting decides this window. The buttons on each
  row choose instead: **pin to this project**, **use in this window only**, or
  **make the global default**.
- **`Claude Code: Pin Profile to This Project`**, **`Use Profile in This Window
  Only`** and **`Set Global Default Profile`** for the same thing from the
  Command Palette.
- **`Claude Code: Create Profile`**, **`Set Profile Color`** and **`Delete
  Profile`**, also at the bottom of the switcher picker.
- An optional **color per profile**: while that profile is active the whole
  status bar is tinted, so you always know which account you are on.
- The **integrated terminal follows along**: `claude` run in a new terminal uses
  the same profile as the Claude Code panel in that window.

## Which profile a window uses

The first of these that is set wins:

1. **This window only.** Remembered for this workspace on this machine, not
   written to the project.
2. **Pinned to this project.** Saved as `claudeConfigSwitcher.profile` in the
   project's `.vscode/settings.json`, so it can be committed. It is the profile
   *label*, so teammates need a profile with the same name. Ignored until the
   folder is trusted.
3. **Global default.** `claudeConfigSwitcher.defaultProfile` in your User
   settings.

If none is set, Claude Code keeps whatever `CLAUDE_CONFIG_DIR` VS Code was
started with (normally none, which means `~/.claude`).

## How it works

The Claude Code extension starts `claude` with this window's environment plus
its `claudeCode.environmentVariables` setting. Every window has its own
extension host, so this extension sets `CLAUDE_CONFIG_DIR` in that environment
for its own window, and in the environment for new integrated terminals. It
starts early (activation event `*`) so the value is in place before Claude Code
reads it.

- **Reload after switching.** Claude Code reads some of its config location when
  it starts, so the picker offers to reload the window.
- **Keep `CLAUDE_CONFIG_DIR` out of `claudeCode.environmentVariables`.** That
  setting applies to every window and overrides this extension. Versions before
  1.2 stored the profile there; it is moved into the global default
  automatically. The status bar warns if it shows up again.
- **The default profile leaves the variable unset** rather than pointing it at
  `~/.claude`, because Claude Code stores the login under a different name
  whenever the variable is set.
- **Paths.** A leading `~` is expanded for you. Relative paths are refused.

## How it differs from symlink-based switchers

Some switchers repoint `~/.claude` as a symlink. That changes the config for
every terminal and every Claude session on the machine, and does not work on
Windows. This extension never touches `~/.claude` or your shell files:

- each window can use a different account at the same time;
- it works on macOS, Linux and Windows;
- it asks before reloading the window, and only removes status bar colors it
  wrote itself.

## Why a separate extension (not a patch)

The official `anthropic.claude-code` extension is a closed-source, minified
bundle that VS Code replaces on every update. Any hand-edit would be lost. This
extension sits beside it and only sets environment variables it already reads.

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
`claudeConfigSwitcher.profiles`:

```json
"claudeConfigSwitcher.profiles": [
  { "label": "default", "configDir": "" },
  { "label": "work",    "configDir": "~/.claude-work" }
]
```

A leading `~` is expanded to your home folder.

#### 4. Switch to it

Click `Claude: ...` in the status bar (or run `Claude Code: Switch Profile`),
pick **work**, and choose **Reload Window**. Claude Code now runs with the
`work` login and settings. Switch back to **default** the same way.

To use **work** only in one project, click the pin button on its row instead.
Other windows keep their own profile.

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
`claudeConfigSwitcher.profiles`:

```json
"claudeConfigSwitcher.profiles": [
  { "label": "default",  "configDir": "" },
  { "label": "personal", "configDir": "/Users/you/.claude-personal" },
  { "label": "work",     "configDir": "/Volumes/Work/claude-config" }
]
```

Empty `configDir` means the built-in default (`~/.claude`). Discovered
directories already listed here are not shown twice. Set
`claudeConfigSwitcher.autoDiscover` to `false` to show only the profiles you
list.

New integrated terminals get the window's `CLAUDE_CONFIG_DIR` too, and VS Code
offers to relaunch terminals that are already open. Set
`claudeConfigSwitcher.syncTerminal` to `false` if you manage that variable
yourself.

Profiles, colors and the global default are User-level settings only, so a
project's `.vscode/settings.json` cannot add a profile or point one at another
directory. It can only pin one of your existing profiles by label.

Settings were named `claudeProfileSwitcher.*` before 1.1.0. They are copied to
`claudeConfigSwitcher.*` automatically on first start.

## Profile colors

Run **`Claude Code: Set Profile Color`** (or **Set profile color...** in the
switcher), pick a profile, then a preset, a custom hex value, or **No color**.
New profiles are also asked for a color when created. Colors are stored in
`claudeConfigSwitcher.colors`, keyed by profile label:

```json
"claudeConfigSwitcher.colors": { "work": "#c62828", "personal": "#2e7d32" }
```

The extension writes `statusBar.background` and a readable text color into
`workbench.colorCustomizations`: the global default's color in your User
settings, so all windows agree, and a pinned or window-only profile's color in
the workspace settings. It only ever removes values it wrote itself, so your own
color customizations are left alone. Give pinned profiles a color of their own:
a pinned profile with no color shows the global default's tint. A theme-specific
block such as `"[Default Dark Modern]": { ... }` in that setting takes priority
over the tint.

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
pnpm run package                  # produces cc-config-switcher-<version>.vsix
code --install-extension cc-config-switcher-<version>.vsix
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
   auto-generated notes. If the `VSCE_PAT` repository secret is set, it also
   publishes the same `.vsix` to the VS Code Marketplace.

Users can install from the Marketplace, or download the `.vsix` from the
Releases page and install it:

```bash
code --install-extension cc-config-switcher-1.2.1.vsix
```

You can also run the workflow by hand from the **Actions** tab. That builds the
`.vsix` as a downloadable artifact without creating a release.
