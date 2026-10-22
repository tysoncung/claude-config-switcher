const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The official Claude Code extension's setting we drive.
// NOTE: it is "scope": "machine" => can only live in USER settings, never workspace.
const CC_SETTING = "claudeCode.environmentVariables";
const KEY = "CLAUDE_CONFIG_DIR";

let statusBar;

/** Every ~/.claude-<name> directory, as a profile labelled <name>. */
function discoverProfiles() {
  const home = os.homedir();
  let entries;
  try {
    entries = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith(".claude-"))
    .map((e) => ({
      label: e.name.slice(".claude-".length),
      configDir: path.join(home, e.name),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Configured profiles, plus discovered ones whose path isn't already listed. */
function getProfiles() {
  const config = vscode.workspace.getConfiguration("claudeProfileSwitcher");
  const profiles = [...config.get("profiles", [])];
  if (!config.get("autoDiscover", true)) return profiles;

  const known = new Set(profiles.map((p) => p.configDir || ""));
  for (const p of discoverProfiles()) {
    if (!known.has(p.configDir)) profiles.push(p);
  }
  return profiles;
}

/** The CLAUDE_CONFIG_DIR currently set in the user settings (or "" if none). */
function readConfigDir() {
  const arr = vscode.workspace.getConfiguration().inspect(CC_SETTING)?.globalValue || [];
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
  const items = [
    ...profileItems(getProfiles()),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(add) Create new profile...", action: createProfile },
    { label: "$(trash) Delete a profile...", action: deleteProfile },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: "Switch Claude Code Profile",
    placeHolder: "Select which CLAUDE_CONFIG_DIR the Claude Code extension should use",
  });
  if (!pick) return;
  if (pick.action) return pick.action();

  await applyProfile(pick.profile);
}

function profileItems(profiles) {
  const current = readConfigDir();
  return profiles.map((p) => ({
    label: p.label,
    description: p.configDir || "default (~/.claude)",
    detail: (p.configDir || "") === (current || "") ? "$(check) current" : undefined,
    profile: p,
  }));
}

// Things in ~/.claude worth sharing with a new profile. Login and history are
// deliberately excluded so each profile stays a separate account.
const SHAREABLE = ["settings.json", "CLAUDE.md", "agents", "commands", "skills"];

async function createProfile() {
  const home = os.homedir();
  const name = await vscode.window.showInputBox({
    title: "Create Claude Code Profile",
    prompt: "Profile name. The folder will be ~/.claude-<name>.",
    placeHolder: "work",
    validateInput: (v) => {
      v = v.trim();
      if (!v) return "Enter a name.";
      if (!/^[A-Za-z0-9_-]+$/.test(v)) return "Use letters, digits, '-' or '_' only.";
      if (fs.existsSync(path.join(home, `.claude-${v}`)))
        return `~/.claude-${v} already exists.`;
      return undefined;
    },
  });
  if (!name) return;

  const label = name.trim();
  const configDir = path.join(home, `.claude-${label}`);
  fs.mkdirSync(configDir, { recursive: true });

  const source = path.join(home, ".claude");
  const available = SHAREABLE.filter((f) => fs.existsSync(path.join(source, f)));
  if (available.length) {
    const picks = await vscode.window.showQuickPick(
      available.map((f) => ({
        label: f,
        picked: f === "settings.json" || f === "CLAUDE.md",
      })),
      {
        title: `Copy from ~/.claude into ~/.claude-${label}?`,
        placeHolder: "Pick what to share with the new profile (Esc to copy nothing)",
        canPickMany: true,
      }
    );
    for (const p of picks || []) {
      fs.cpSync(path.join(source, p.label), path.join(configDir, p.label), {
        recursive: true,
      });
    }
  }

  // Without auto-discovery the new folder would be invisible, so list it explicitly.
  const config = vscode.workspace.getConfiguration("claudeProfileSwitcher");
  if (!config.get("autoDiscover", true)) {
    const profiles =
      config.inspect("profiles")?.globalValue || config.get("profiles", []);
    await config.update(
      "profiles",
      [...profiles, { label, configDir }],
      vscode.ConfigurationTarget.Global
    );
  }

  const choice = await vscode.window.showInformationMessage(
    `Created profile "${label}" at ${configDir}. Log in to it in a terminal, or switch to it now.`,
    "Log In",
    "Switch Now"
  );
  if (choice === "Log In") {
    const terminal = vscode.window.createTerminal({
      name: `Claude: ${label}`,
      env: { [KEY]: configDir },
    });
    terminal.show();
    terminal.sendText("claude");
    vscode.window.showInformationMessage(
      `Run /login inside Claude Code, then switch to "${label}" from the status bar.`
    );
  } else if (choice === "Switch Now") {
    await applyProfile({ label, configDir });
  }
}

async function deleteProfile() {
  // The default profile (~/.claude) is never offered for deletion.
  const deletable = getProfiles().filter((p) => p.configDir);
  if (!deletable.length) {
    vscode.window.showInformationMessage("There are no profiles to delete.");
    return;
  }

  const pick = await vscode.window.showQuickPick(profileItems(deletable), {
    title: "Delete Claude Code Profile",
    placeHolder: "Select the profile to delete",
  });
  if (!pick) return;
  const { label, configDir } = pick.profile;

  const confirm = await vscode.window.showWarningMessage(
    `Delete profile "${label}"?`,
    {
      modal: true,
      detail: `${configDir} will be moved to the Trash, including its login, settings and history.`,
    },
    "Delete"
  );
  if (confirm !== "Delete") return;

  if (fs.existsSync(configDir)) {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(configDir), {
        recursive: true,
        useTrash: true,
      });
    } catch (err) {
      vscode.window.showErrorMessage(`Could not delete ${configDir}: ${err.message}`);
      return;
    }
  }

  const config = vscode.workspace.getConfiguration("claudeProfileSwitcher");
  const listed = config.inspect("profiles")?.globalValue;
  if (listed?.some((p) => p.configDir === configDir)) {
    await config.update(
      "profiles",
      listed.filter((p) => p.configDir !== configDir),
      vscode.ConfigurationTarget.Global
    );
  }

  if (readConfigDir() === configDir) {
    await applyProfile({ label: "default", configDir: "" });
  } else {
    vscode.window.showInformationMessage(`Deleted profile "${label}".`);
  }
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
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "claudeProfileSwitcher.switch";
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeProfileSwitcher.switch", switchProfile),
    vscode.commands.registerCommand("claudeProfileSwitcher.create", createProfile),
    vscode.commands.registerCommand("claudeProfileSwitcher.delete", deleteProfile)
  );

  // Keep the status bar in sync if settings change by other means.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration(CC_SETTING) ||
        e.affectsConfiguration("claudeProfileSwitcher")
      ) {
        updateStatusBar();
      }
    })
  );

  updateStatusBar();
}

function deactivate() {}

module.exports = { activate, deactivate };
