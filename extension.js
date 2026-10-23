const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The official Claude Code extension's setting we drive.
// NOTE: it is "scope": "machine" => can only live in USER settings, never workspace.
const CC_SETTING = "claudeCode.environmentVariables";
const KEY = "CLAUDE_CONFIG_DIR";

// Integrated terminal env for this OS, so `claude` in a terminal matches the panel.
const TERMINAL_ENV = `terminal.integrated.env.${
  { darwin: "osx", win32: "windows" }[process.platform] || "linux"
}`;

const PRESET_COLORS = [
  ["Red", "#c62828"],
  ["Orange", "#ef6c00"],
  ["Amber", "#f9a825"],
  ["Green", "#2e7d32"],
  ["Teal", "#00897b"],
  ["Blue", "#1565c0"],
  ["Purple", "#6a1b9a"],
  ["Pink", "#ad1457"],
  ["Slate", "#546e7a"],
];

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

let statusBar;
let state;

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

/** Expands a leading "~", which the official extension would otherwise ignore. */
function expandHome(p) {
  p = (p || "").trim();
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\"))
    return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Configured profiles, plus discovered ones whose path isn't already listed. */
function getProfiles() {
  const config = vscode.workspace.getConfiguration("claudeConfigSwitcher");
  const profiles = config
    .get("profiles", [])
    .map((p) => ({ label: p.label, configDir: expandHome(p.configDir) }));
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

function getColor(label) {
  return vscode.workspace.getConfiguration("claudeConfigSwitcher").get("colors", {})[
    label
  ];
}

/** Black or white, whichever reads better on the given background. */
function contrastText(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? "#000000" : "#ffffff";
}

/**
 * Tint the status bar with the active profile's color. Only removes values this
 * extension wrote itself, so the user's own colorCustomizations survive.
 */
async function syncColor() {
  const color = getColor(labelForValue(readConfigDir()));
  const config = vscode.workspace.getConfiguration();
  const current = config.inspect("workbench.colorCustomizations")?.globalValue || {};
  const owned = state.get("ownedColors", {});

  const next = { ...current };
  for (const [k, v] of Object.entries(owned)) {
    if (next[k] === v) delete next[k];
  }
  const wrote = {};
  if (color && HEX_COLOR.test(color)) {
    const fg = contrastText(color);
    wrote["statusBar.background"] = color;
    wrote["statusBar.noFolderBackground"] = color;
    wrote["statusBar.foreground"] = fg;
    wrote["statusBar.noFolderForeground"] = fg;
    Object.assign(next, wrote);
  }

  if (JSON.stringify(next) !== JSON.stringify(current)) {
    await config.update(
      "workbench.colorCustomizations",
      Object.keys(next).length ? next : undefined,
      vscode.ConfigurationTarget.Global
    );
  }
  await state.update("ownedColors", wrote);
}

/** @returns hex color, "" for no color, or undefined if cancelled. */
async function pickColor(label) {
  const items = [
    ...PRESET_COLORS.map(([name, hex]) => ({ label: name, description: hex, hex })),
    { label: "$(edit) Custom hex...", custom: true },
    { label: "$(close) No color", hex: "" },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: `Status bar color for "${label}"`,
    placeHolder: "The whole status bar is tinted while this profile is active",
  });
  if (!pick) return undefined;
  if (!pick.custom) return pick.hex;

  const hex = await vscode.window.showInputBox({
    title: `Status bar color for "${label}"`,
    prompt: "Hex color, e.g. #8b2fc9",
    value: getColor(label) || "#",
    validateInput: (v) => (HEX_COLOR.test(v.trim()) ? undefined : "Use #rgb or #rrggbb."),
  });
  return hex === undefined ? undefined : hex.trim();
}

async function saveColor(label, color) {
  const config = vscode.workspace.getConfiguration("claudeConfigSwitcher");
  const colors = { ...(config.inspect("colors")?.globalValue || {}) };
  if (color) colors[label] = color;
  else delete colors[label];
  await config.update(
    "colors",
    Object.keys(colors).length ? colors : undefined,
    vscode.ConfigurationTarget.Global
  );
}

async function setProfileColor() {
  const pick = await vscode.window.showQuickPick(profileItems(getProfiles()), {
    title: "Set Claude Code Profile Color",
    placeHolder: "Select the profile to color",
  });
  if (!pick) return;
  const color = await pickColor(pick.profile.label);
  if (color !== undefined) await saveColor(pick.profile.label, color);
}

async function switchProfile() {
  const items = [
    ...profileItems(getProfiles()),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(add) Create new profile...", action: createProfile },
    { label: "$(symbol-color) Set profile color...", action: setProfileColor },
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
    description: [p.configDir || "default (~/.claude)", getColor(p.label)]
      .filter(Boolean)
      .join("  ·  "),
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

  const color = await pickColor(label);
  if (color) await saveColor(label, color);

  // Without auto-discovery the new folder would be invisible, so list it explicitly.
  const config = vscode.workspace.getConfiguration("claudeConfigSwitcher");
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

  const config = vscode.workspace.getConfiguration("claudeConfigSwitcher");
  const listed = config.inspect("profiles")?.globalValue;
  if (listed?.some((p) => expandHome(p.configDir) === configDir)) {
    await config.update(
      "profiles",
      listed.filter((p) => expandHome(p.configDir) !== configDir),
      vscode.ConfigurationTarget.Global
    );
  }
  if (getColor(label)) await saveColor(label, "");

  if (readConfigDir() === configDir) {
    await applyProfile({ label: "default", configDir: "" });
  } else {
    vscode.window.showInformationMessage(`Deleted profile "${label}".`);
  }
}

async function applyProfile(profile) {
  const configDir = expandHome(profile.configDir);

  // The official extension ignores relative paths. Fail loudly instead.
  if (configDir && !path.isAbsolute(configDir)) {
    vscode.window.showErrorMessage(
      `Profile "${profile.label}": configDir must be an absolute path. Got: ${configDir}`
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

  if (config.get("claudeConfigSwitcher.syncTerminal", true)) {
    const env = { ...(config.inspect(TERMINAL_ENV)?.globalValue || {}) };
    if (configDir) env[KEY] = configDir;
    else delete env[KEY];
    await config.update(
      TERMINAL_ENV,
      Object.keys(env).length ? env : undefined,
      vscode.ConfigurationTarget.Global
    );
  }
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

/**
 * Copy settings from the pre-1.1 "claudeProfileSwitcher" namespace. Another
 * extension also uses claudeProfileSwitcher.profiles (with "name" instead of
 * "label"), so that key is only taken over when it is in our shape.
 */
async function migrateSettings() {
  const config = vscode.workspace.getConfiguration();
  for (const key of ["profiles", "autoDiscover", "colors"]) {
    const oldKey = `claudeProfileSwitcher.${key}`;
    const old = config.inspect(oldKey)?.globalValue;
    if (old === undefined) continue;
    if (
      key === "profiles" &&
      !(Array.isArray(old) && old.every((p) => p && "label" in p))
    )
      continue;
    const newKey = `claudeConfigSwitcher.${key}`;
    if (config.inspect(newKey)?.globalValue === undefined) {
      await config.update(newKey, old, vscode.ConfigurationTarget.Global);
    }
    try {
      await config.update(oldKey, undefined, vscode.ConfigurationTarget.Global);
    } catch {
      // VS Code may refuse to write a key no extension registers; leaving it is harmless.
    }
  }
}

function activate(context) {
  state = context.globalState;
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "claudeConfigSwitcher.switch";
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeConfigSwitcher.switch", switchProfile),
    vscode.commands.registerCommand("claudeConfigSwitcher.create", createProfile),
    vscode.commands.registerCommand("claudeConfigSwitcher.delete", deleteProfile),
    vscode.commands.registerCommand("claudeConfigSwitcher.setColor", setProfileColor)
  );

  // Keep the status bar in sync if settings change by other means.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration(CC_SETTING) ||
        e.affectsConfiguration("claudeConfigSwitcher")
      ) {
        updateStatusBar();
        syncColor();
      }
    })
  );

  migrateSettings().finally(() => {
    updateStatusBar();
    syncColor();
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
