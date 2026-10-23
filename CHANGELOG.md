# Changelog

## 1.2.2

- Listed in the AI category, with a gallery banner and a screenshot.
- Also published to [Open VSX](https://open-vsx.org/extension/tysoncung/cc-config-switcher)
  for Cursor, Windsurf and VSCodium.

## 1.2.1

- First release on the VS Code Marketplace. The extension ID is
  `tysoncung.cc-config-switcher`; the display name is still Claude Config
  Switcher.

## 1.2.0

- **A different profile per window or project.** The profile is set in each
  window's own environment instead of the machine-wide
  `claudeCode.environmentVariables` setting, so two windows can use two
  accounts at once.
- A window uses, in order: a profile chosen for **this window only**, a
  profile **pinned to the project** (`claudeConfigSwitcher.profile` in
  `.vscode/settings.json`), or the **global default**
  (`claudeConfigSwitcher.defaultProfile`).
- Buttons on each row of the switcher choose where to apply a profile. New
  commands: Pin Profile to This Project, Use Profile in This Window Only, Set
  Global Default Profile.
- The status bar shows where the profile comes from, and when a change is
  waiting for a reload.
- New integrated terminals get the window's profile through VS Code's terminal
  environment, so no settings are written for them.
- A project pin is ignored until the folder is trusted. Profiles, colors and
  the global default can only be set in User settings.
- `CLAUDE_CONFIG_DIR` in `claudeCode.environmentVariables` (where 1.1 kept it)
  is moved into the global default automatically.

## 1.1.0

- Settings renamed from `claudeProfileSwitcher.*` to `claudeConfigSwitcher.*`
  so they no longer clash with another extension; old settings are copied over.
- Windows paths such as `C:\Users\me\.claude-work` work.
- A leading `~` in `configDir` is expanded instead of refused.
- New integrated terminals use the same profile as the Claude Code panel.
- Extension icon.

## 1.0.0

- Status bar switcher for `CLAUDE_CONFIG_DIR`, with auto-discovery of
  `~/.claude-<name>` folders.
- Create, delete (to the Trash) and color profiles.
