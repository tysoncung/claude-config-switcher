const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The official Claude Code extension builds the env for every `claude` it spawns
// as { ...process.env, ...claudeCode.environmentVariables }. Both extensions share
// this window's extension host, so setting process.env here picks the profile for
// this window only, as long as the (machine-wide) setting doesn't override it.
const CC_SETTING = "claudeCode.environmentVariables";
const KEY = "CLAUDE_CONFIG_DIR";
const NS = "claudeConfigSwitcher";

// Whatever VS Code was launched with, restored when no profile is chosen.
const AMBIENT = process.env[KEY];

// 1.1.0 mirrored the profile into the terminal env setting for this OS.
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

// Where a window's profile comes from, highest priority first.
const LEVELS = ["window", "project", "global"];
const LEVEL_NAME = {
  window: "this window only",
  project: "pinned to this project",
  global: "global default",
  none: "not set",
};
const LEVEL_ICON = { window: "$(window)", project: "$(pinned)", global: "$(account)" };

const BUTTONS = {
  project: { iconPath: new vscode.ThemeIcon("pinned"), tooltip: "Pin to this project" },
  window: {
    iconPath: new vscode.ThemeIcon("window"),
    tooltip: "Use in this window only",
  },
  global: { iconPath: new vscode.ThemeIcon("globe"), tooltip: "Make the global default" },
};

let statusBar;
let ctx;
let applied; // the resolution currently in process.env

function cfg() {
  return vscode.workspace.getConfiguration(NS);
}

function hasFolder() {
  return Boolean(vscode.workspace.workspaceFolders?.length);
}

/** Expands a leading "~", which the official extension would otherwise ignore. */
function expandHome(p) {
  p = (p || "").trim();
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\"))
    return path.join(os.homedir(), p.slice(2));
  return p;
}

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

/** Configured profiles, plus discovered ones, always including "default" (~/.claude). */
function getProfiles() {
  const profiles = cfg()
    .get("profiles", [])
    .map((p) => ({ label: p.label, configDir: expandHome(p.configDir) }));
  if (!profiles.some((p) => !p.configDir))
    profiles.unshift({ label: "default", configDir: "" });
  if (!cfg().get("autoDiscover", true)) return profiles;

  const known = new Set(profiles.map((p) => p.configDir));
  for (const p of discoverProfiles()) {
    if (!known.has(p.configDir)) profiles.push(p);
  }
  return profiles;
}

/** The CLAUDE_CONFIG_DIR entry in the official extension's setting, if any. */
function settingConfigDir() {
  const arr = vscode.workspace.getConfiguration().inspect(CC_SETTING)?.globalValue || [];
  return arr.find((e) => e && e.name === KEY)?.value;
}

/** Label chosen at each level, before checking that the profile exists. */
function chosenLabels() {
  const project = cfg().inspect("profile");
  return {
    window: ctx.workspaceState.get("profile"),
    // A cloned repo must not pick a profile until the folder is trusted.
    project: vscode.workspace.isTrusted
      ? (project?.workspaceFolderValue ?? project?.workspaceValue)
      : undefined,
    global: cfg().get("defaultProfile") || undefined,
  };
}

/** Which profile this window should use, and why. */
function resolve() {
  const profiles = getProfiles();
  const chosen = chosenLabels();
  const problems = [];
  for (const level of LEVELS) {
    const label = chosen[level];
    if (!label) continue;
    const profile = profiles.find((p) => p.label === label);
    if (!profile) {
      problems.push(`No profile named "${label}" (${LEVEL_NAME[level]}).`);
    } else if (profile.configDir && !path.isAbsolute(profile.configDir)) {
      problems.push(
        `Profile "${label}" needs an absolute configDir, got ${profile.configDir}.`
      );
    } else {
      return { profile, level, problems };
    }
  }
  return { profile: undefined, level: "none", problems };
}

function sameTarget(a, b) {
  return a.profile?.configDir === b.profile?.configDir;
}

/** Point this window's extension host and new terminals at the resolved profile. */
function applyEnv(r) {
  const dir = r.profile ? r.profile.configDir : AMBIENT;
  // "default" leaves the variable unset: Claude Code keys its stored login on
  // whether CLAUDE_CONFIG_DIR is set, even when it points at ~/.claude.
  if (dir) process.env[KEY] = dir;
  else delete process.env[KEY];

  const env = ctx.environmentVariableCollection;
  env.clear();
  env.description = "Claude Code profile for this window";
  if (r.profile?.configDir && cfg().get("syncTerminal", true)) {
    env.replace(KEY, r.profile.configDir);
  }
  applied = r;
}

function updateStatusBar() {
  const now = resolve();
  const label = applied.profile?.label ?? (AMBIENT ? "inherited" : "default");
  const pending = !sameTarget(now, applied);
  const problems = [...now.problems];
  if (settingConfigDir()) {
    problems.push(
      `${CC_SETTING} sets ${KEY}, which overrides the profile for every window.`
    );
  }

  statusBar.text = `${LEVEL_ICON[applied.level] || "$(account)"} Claude: ${label}${
    pending ? " $(sync)" : ""
  }`;
  statusBar.tooltip = [
    `Profile: ${label} (${LEVEL_NAME[applied.level]})`,
    `${KEY} = ${process.env[KEY] || "(default ~/.claude)"}`,
    pending
      ? `Reload the window to switch to "${now.profile?.label ?? "inherited"}".`
      : "",
    ...problems.map((p) => `⚠ ${p}`),
    "Click to switch Claude Code profile",
  ]
    .filter(Boolean)
    .join("\n");
  statusBar.backgroundColor = problems.length
    ? new vscode.ThemeColor("statusBarItem.warningBackground")
    : undefined;
  statusBar.show();
}

function getColor(label) {
  return cfg().get("colors", {})[label];
}

/** Black or white, whichever reads better on the given background. */
function contrastText(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? "#000000" : "#ffffff";
}

/**
 * Write a status bar tint at one settings level. Only removes values this
 * extension wrote itself, so the user's own colorCustomizations survive.
 */
async function writeTint(target, memento, color) {
  const config = vscode.workspace.getConfiguration();
  const info = config.inspect("workbench.colorCustomizations");
  const current =
    (target === vscode.ConfigurationTarget.Global
      ? info?.globalValue
      : info?.workspaceValue) || {};
  const owned = memento.get("ownedColors", {});

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
      target
    );
  }
  await memento.update("ownedColors", wrote);
}

/**
 * User settings carry the global default's tint, so every window agrees on it.
 * A window on a project pin or window-only profile adds its own in workspace settings.
 */
async function syncColor() {
  const global = cfg().get("defaultProfile") || (AMBIENT ? undefined : "default");
  await writeTint(vscode.ConfigurationTarget.Global, ctx.globalState, getColor(global));
  if (hasFolder()) {
    const own = applied.level === "project" || applied.level === "window";
    await writeTint(
      vscode.ConfigurationTarget.Workspace,
      ctx.workspaceState,
      own ? getColor(applied.profile.label) : undefined
    );
  }
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
  const colors = { ...(cfg().inspect("colors")?.globalValue || {}) };
  if (color) colors[label] = color;
  else delete colors[label];
  await cfg().update(
    "colors",
    Object.keys(colors).length ? colors : undefined,
    vscode.ConfigurationTarget.Global
  );
}

async function pickProfile(title, placeHolder) {
  const pick = await vscode.window.showQuickPick(profileItems(getProfiles()), {
    title,
    placeHolder,
  });
  return pick?.profile;
}

async function setProfileColor() {
  const profile = await pickProfile(
    "Set Claude Code Profile Color",
    "Select the profile to color"
  );
  if (!profile) return;
  const color = await pickColor(profile.label);
  if (color !== undefined) await saveColor(profile.label, color);
}

function profileItems(profiles, buttons = []) {
  const chosen = chosenLabels();
  return profiles.map((p) => ({
    label: p.label,
    description: [p.configDir || "~/.claude", getColor(p.label)]
      .filter(Boolean)
      .join("  ·  "),
    detail: [
      applied.profile?.label === p.label ? "$(check) this window" : "",
      ...LEVELS.filter((l) => chosen[l] === p.label).map((l) => LEVEL_NAME[l]),
    ]
      .filter(Boolean)
      .join("  ·  "),
    buttons,
    profile: p,
  }));
}

/** Store a profile label at one level; undefined clears that level. */
async function setLevel(level, label) {
  if (level === "window") {
    await ctx.workspaceState.update("profile", label);
  } else if (level === "project") {
    await cfg().update("profile", label, vscode.ConfigurationTarget.Workspace);
  } else {
    await cfg().update("defaultProfile", label, vscode.ConfigurationTarget.Global);
  }
}

/** Apply a change made in this window and offer the reload Claude Code needs. */
async function afterChange(message) {
  const now = resolve();
  if (sameTarget(now, applied)) {
    applied = now;
    updateStatusBar();
    await syncColor();
    vscode.window.showInformationMessage(message);
    return;
  }
  applyEnv(now);
  updateStatusBar();
  await syncColor();
  const choice = await vscode.window.showInformationMessage(
    `${message} Reload the window for Claude Code to use "${now.profile?.label ?? "inherited"}".`,
    "Reload Window",
    "Later"
  );
  if (choice === "Reload Window") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

async function useProfile(level, profile) {
  if (level === "project" && !hasFolder()) {
    vscode.window.showErrorMessage("Open a folder first to pin a profile to it.");
    return;
  }
  await setLevel(level, profile.label);
  const outranked = LEVELS.slice(0, LEVELS.indexOf(level)).find((l) => chosenLabels()[l]);
  const done = {
    window: "used in this window only",
    project: "pinned to this project",
    global: "the global default",
  }[level];
  await afterChange(
    `"${profile.label}" is now ${done}.${
      outranked ? ` This window still uses its ${LEVEL_NAME[outranked]} profile.` : ""
    }`
  );
}

async function switchProfile() {
  // A plain click changes whichever level decides this window right now.
  const level = applied.level === "none" ? "global" : applied.level;
  const chosen = chosenLabels();
  const buttons = LEVELS.filter((l) => l !== "project" || hasFolder()).map(
    (l) => BUTTONS[l]
  );
  const actions = [
    chosen.window && {
      label: "$(close) Stop using a window-only profile",
      clear: "window",
    },
    chosen.project && { label: "$(pinned) Remove this project's pin", clear: "project" },
    { label: "$(add) Create new profile...", action: createProfile },
    { label: "$(symbol-color) Set profile color...", action: setProfileColor },
    { label: "$(trash) Delete a profile...", action: deleteProfile },
  ].filter(Boolean);

  const qp = vscode.window.createQuickPick();
  qp.title = "Switch Claude Code Profile";
  const sets = {
    window: "this window's profile",
    project: "this project's pin",
    global: "the global default",
  }[level];
  qp.placeholder = `Pick a profile to change ${sets}, or use a row's buttons`;
  qp.items = [
    ...profileItems(getProfiles(), buttons),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    ...actions,
  ];

  const result = await new Promise((done) => {
    qp.onDidAccept(() => done({ item: qp.selectedItems[0], level }));
    qp.onDidTriggerItemButton((e) =>
      done({
        item: e.item,
        level: LEVELS.find((l) => BUTTONS[l] === e.button),
      })
    );
    qp.onDidHide(() => done(undefined));
    qp.show();
  });
  qp.dispose();
  if (!result?.item) return;

  const { item } = result;
  if (item.action) return item.action();
  if (item.clear) {
    await setLevel(item.clear, undefined);
    return afterChange(
      item.clear === "window" ? "Window-only profile cleared." : "Project pin removed."
    );
  }
  await useProfile(result.level, item.profile);
}

function levelCommand(level, title) {
  return async () => {
    const profile = await pickProfile(title, "Select a profile");
    if (profile) await useProfile(level, profile);
  };
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
  if (!cfg().get("autoDiscover", true)) {
    const profiles = cfg().inspect("profiles")?.globalValue || cfg().get("profiles", []);
    await cfg().update(
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
    await useProfile(applied.level === "none" ? "global" : applied.level, {
      label,
      configDir,
    });
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

  const listed = cfg().inspect("profiles")?.globalValue;
  if (listed?.some((p) => expandHome(p.configDir) === configDir)) {
    await cfg().update(
      "profiles",
      listed.filter((p) => expandHome(p.configDir) !== configDir),
      vscode.ConfigurationTarget.Global
    );
  }
  if (getColor(label)) await saveColor(label, "");

  const chosen = chosenLabels();
  for (const level of LEVELS) {
    if (chosen[level] === label) await setLevel(level, undefined);
  }
  await afterChange(`Deleted profile "${label}".`);
}

/**
 * Copy settings from the pre-1.1 "claudeProfileSwitcher" namespace. Another
 * extension also uses claudeProfileSwitcher.profiles (with "name" instead of
 * "label"), so that key is only taken over when it is in our shape.
 */
async function migrateNamespace() {
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
    const newKey = `${NS}.${key}`;
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

/**
 * Before 1.2 the profile lived in claudeCode.environmentVariables, which applies
 * to every window and overrides the per-window value. Turn it into the global
 * default and take it out of that setting.
 */
async function migrateGlobalSetting() {
  const dir = settingConfigDir();
  if (!dir) return;
  const config = vscode.workspace.getConfiguration();

  if (cfg().inspect("defaultProfile")?.globalValue === undefined) {
    let profile = getProfiles().find((p) => p.configDir === expandHome(dir));
    if (!profile) {
      profile = {
        label: path.basename(dir).replace(/^\.claude-/, "") || dir,
        configDir: dir,
      };
      const listed = cfg().inspect("profiles")?.globalValue || cfg().get("profiles", []);
      await cfg().update(
        "profiles",
        [...listed, profile],
        vscode.ConfigurationTarget.Global
      );
    }
    await cfg().update(
      "defaultProfile",
      profile.label,
      vscode.ConfigurationTarget.Global
    );
  }

  const rest = (config.inspect(CC_SETTING)?.globalValue || []).filter(
    (e) => !(e && e.name === KEY)
  );
  await config.update(
    CC_SETTING,
    rest.length ? rest : undefined,
    vscode.ConfigurationTarget.Global
  );

  const term = config.inspect(TERMINAL_ENV)?.globalValue;
  if (term?.[KEY] === dir) {
    const { [KEY]: _, ...others } = term;
    await config.update(
      TERMINAL_ENV,
      Object.keys(others).length ? others : undefined,
      vscode.ConfigurationTarget.Global
    );
  }
}

function activate(context) {
  ctx = context;

  // Seed the env synchronously, before the Claude Code extension activates and
  // reads it. A pre-1.2 global setting still counts until it is migrated below.
  const first = resolve();
  const legacy = settingConfigDir();
  if (!first.profile && legacy) {
    const profile = getProfiles().find((p) => p.configDir === expandHome(legacy)) || {
      label: path.basename(legacy),
      configDir: expandHome(legacy),
    };
    applyEnv({ profile, level: "global", problems: [] });
  } else {
    applyEnv(first);
  }

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = `${NS}.switch`;
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand(`${NS}.switch`, switchProfile),
    vscode.commands.registerCommand(
      `${NS}.pinToProject`,
      levelCommand("project", "Pin Claude Code Profile to This Project")
    ),
    vscode.commands.registerCommand(
      `${NS}.useForWindow`,
      levelCommand("window", "Use Claude Code Profile in This Window Only")
    ),
    vscode.commands.registerCommand(
      `${NS}.setDefault`,
      levelCommand("global", "Set Global Default Claude Code Profile")
    ),
    vscode.commands.registerCommand(`${NS}.create`, createProfile),
    vscode.commands.registerCommand(`${NS}.delete`, deleteProfile),
    vscode.commands.registerCommand(`${NS}.setColor`, setProfileColor)
  );

  // Changes made elsewhere (another window, a settings file) apply on reload;
  // the status bar shows that one is pending.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CC_SETTING) || e.affectsConfiguration(NS)) {
        updateStatusBar();
        syncColor();
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(updateStatusBar)
  );

  updateStatusBar();
  migrateNamespace()
    .then(migrateGlobalSetting)
    .finally(() => {
      // The migration only moved where the choice is stored, not the choice itself.
      if (sameTarget(resolve(), applied)) applied = resolve();
      updateStatusBar();
      syncColor();
    });
}

function deactivate() {}

module.exports = { activate, deactivate };
