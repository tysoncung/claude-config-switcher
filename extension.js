const vscode = require("vscode");

// The official Claude Code extension's setting we drive.
// NOTE: it is "scope": "machine" => can only live in USER settings, never workspace.
const CC_SETTING = "claudeCode.environmentVariables";
const KEY = "CLAUDE_CONFIG_DIR";

let statusBar;

/** @returns {{label:string, configDir:string}[]} */
function getProfiles() {
  return vscode.workspace
    .getConfiguration("claudeProfileSwitcher")
    .get("profiles", []);
}

/** The CLAUDE_CONFIG_DIR currently set in the user settings (or "" if none). */
function readConfigDir() {
  const arr =
    vscode.workspace.getConfiguration().inspect(CC_SETTING)?.globalValue || [];
  const entry = arr.find((e) => e && e.name === KEY);
  return entry ? entry.value : "";
}

function labelForValue(value) {
  const match = getProfiles().find((p) => (p.configDir || "") === (value || ""));
  if (match) return match.label;
  return value ? value : "default";
}

function updateStatusBar() {
  const value = readConfigDir();
  statusBar.text = `$(account) Claude: ${labelForValue(value)}`;
  statusBar.tooltip = value
    ? `CLAUDE_CONFIG_DIR = ${value}\nClick to switch Claude Code profile`
    : `CLAUDE_CONFIG_DIR = (default ~/.claude)\nClick to switch Claude Code profile`;
  statusBar.show();
}

async function switchProfile() {
  const profiles = getProfiles();
  if (!profiles.length) {
    vscode.window.showErrorMessage(
      'No profiles configured. Set "claudeProfileSwitcher.profiles" in settings.'
    );
    return;
  }

  const current = readConfigDir();
  const items = profiles.map((p) => ({
    label: p.label,
    description: p.configDir || "default (~/.claude)",
    detail: (p.configDir || "") === (current || "") ? "$(check) current" : undefined,
    profile: p,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    title: "Switch Claude Code Profile",
    placeHolder: "Select which CLAUDE_CONFIG_DIR the Claude Code extension should use",
  });
  if (!pick) return;

  await applyProfile(pick.profile);
}

async function applyProfile(profile) {
  const configDir = (profile.configDir || "").trim();

  // The official extension ignores "~" and relative paths. Fail loudly instead.
  if (configDir && !configDir.startsWith("/")) {
    vscode.window.showErrorMessage(
      `Profile "${profile.label}": configDir must be an absolute path (no "~"). Got: ${configDir}`
    );
    return;
  }

  const config = vscode.workspace.getConfiguration();
  const currentGlobal = config.inspect(CC_SETTING)?.globalValue || [];

  // Preserve any other env vars; replace only our CLAUDE_CONFIG_DIR entry.
  const next = currentGlobal.filter((e) => !(e && e.name === KEY));
  if (configDir) next.push({ name: KEY, value: configDir });

  // Machine-scoped setting => must be written to Global (User) settings.
  await config.update(CC_SETTING, next, vscode.ConfigurationTarget.Global);
  updateStatusBar();

  const choice = await vscode.window.showInformationMessage(
    `Claude Code profile set to "${profile.label}". Reload the window for it to take effect.`,
    "Reload Window",
    "Later"
  );
  if (choice === "Reload Window") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

function activate(context) {
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.command = "claudeProfileSwitcher.switch";
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeProfileSwitcher.switch", switchProfile)
  );

  // Keep the status bar in sync if settings change by other means.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration(CC_SETTING) ||
        e.affectsConfiguration("claudeProfileSwitcher.profiles")
      ) {
        updateStatusBar();
      }
    })
  );

  updateStatusBar();
}

function deactivate() {}

module.exports = { activate, deactivate };
