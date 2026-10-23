const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { load, settle } = require("./vscode-stub");

const KEY = "CLAUDE_CONFIG_DIR";
const HOME = os.homedir();
const WORK = path.join(HOME, ".claude-work");
const ABS = path.resolve("/tmp/claude-personal");

const PROFILES = {
  "claudeConfigSwitcher.profiles": [
    { label: "default", configDir: "" },
    { label: "work", configDir: "~/.claude-work" },
    { label: "personal", configDir: ABS },
  ],
  "claudeConfigSwitcher.autoDiscover": false,
};

beforeEach(() => {
  delete process.env[KEY];
});

test("global default sets the host env and terminal env, ~ expanded", async () => {
  const vs = load({
    user: { ...PROFILES, "claudeConfigSwitcher.defaultProfile": "work" },
  });
  vs.activate();
  await settle();
  assert.equal(process.env[KEY], WORK);
  assert.deepEqual(vs.terminalEnv.vars, { [KEY]: WORK });
  assert.match(vs.statusBar.text, /Claude: work$/);
});

test("default profile leaves the variable unset", async () => {
  const vs = load({
    user: { ...PROFILES, "claudeConfigSwitcher.defaultProfile": "default" },
  });
  vs.activate();
  await settle();
  assert.equal(process.env[KEY], undefined);
  assert.deepEqual(vs.terminalEnv.vars, {});
});

test("project pin beats the global default, window-only beats both", async () => {
  const vs = load({
    user: { ...PROFILES, "claudeConfigSwitcher.defaultProfile": "work" },
    workspace: { "claudeConfigSwitcher.profile": "personal" },
  });
  vs.activate();
  await settle();
  assert.equal(process.env[KEY], ABS);
  assert.match(vs.statusBar.text, /pinned.*personal/);

  await vs.switcher((i) => i.label === "default", "window");
  assert.equal(vs.context.workspaceState.data.profile, "default");
  assert.equal(process.env[KEY], undefined);
  assert.match(vs.statusBar.text, /window.*default/);
});

test("untrusted folder ignores the project pin", async () => {
  const vs = load({
    user: { ...PROFILES, "claudeConfigSwitcher.defaultProfile": "work" },
    workspace: { "claudeConfigSwitcher.profile": "personal" },
    trusted: false,
  });
  vs.activate();
  await settle();
  assert.equal(process.env[KEY], WORK);
});

test("plain click changes the level that decides this window", async () => {
  const vs = load({
    user: { ...PROFILES, "claudeConfigSwitcher.defaultProfile": "work" },
    workspace: { "claudeConfigSwitcher.profile": "personal" },
  });
  vs.activate();
  await settle();
  await vs.switcher((i) => i.label === "work");
  assert.equal(vs.workspace["claudeConfigSwitcher.profile"], "work");
  assert.equal(vs.user["claudeConfigSwitcher.defaultProfile"], "work");
});

test("pin button writes the workspace setting and the pinned color", async () => {
  const vs = load({
    user: {
      ...PROFILES,
      "claudeConfigSwitcher.colors": { personal: "#2e7d32", work: "#c62828" },
      "claudeConfigSwitcher.defaultProfile": "work",
    },
  });
  vs.activate();
  await settle();
  assert.equal(
    vs.user["workbench.colorCustomizations"]["statusBar.background"],
    "#c62828"
  );

  await vs.switcher((i) => i.label === "personal", "project");
  assert.equal(vs.workspace["claudeConfigSwitcher.profile"], "personal");
  assert.equal(
    vs.workspace["workbench.colorCustomizations"]["statusBar.background"],
    "#2e7d32"
  );
  // The User tint still belongs to the global default, so other windows agree.
  assert.equal(
    vs.user["workbench.colorCustomizations"]["statusBar.background"],
    "#c62828"
  );
  assert.match(vs.messages.at(-1), /pinned to this project/);
});

test("a change from another window is only pending until reload", async () => {
  const vs = load({
    user: { ...PROFILES, "claudeConfigSwitcher.defaultProfile": "work" },
  });
  vs.activate();
  await settle();
  vs.user["claudeConfigSwitcher.defaultProfile"] = "personal";
  vs.fire("claudeConfigSwitcher.defaultProfile");
  await settle();
  assert.equal(process.env[KEY], WORK);
  assert.match(vs.statusBar.text, /\$\(sync\)/);
});

test("relative configDir is refused and reported", async () => {
  const vs = load({
    user: {
      ...PROFILES,
      "claudeConfigSwitcher.profiles": [{ label: "rel", configDir: "rel/dir" }],
      "claudeConfigSwitcher.defaultProfile": "rel",
    },
  });
  vs.activate();
  await settle();
  assert.equal(process.env[KEY], undefined);
  assert.match(vs.statusBar.tooltip, /absolute configDir/);
});

test("unknown label falls through to the next level with a warning", async () => {
  const vs = load({
    user: { ...PROFILES, "claudeConfigSwitcher.defaultProfile": "work" },
    workspace: { "claudeConfigSwitcher.profile": "gone" },
  });
  vs.activate();
  await settle();
  assert.equal(process.env[KEY], WORK);
  assert.match(vs.statusBar.tooltip, /No profile named "gone"/);
});

test("1.1 global setting is used at once, then migrated out", async () => {
  const vs = load({
    user: {
      ...PROFILES,
      "claudeCode.environmentVariables": [
        { name: "OTHER", value: "1" },
        { name: KEY, value: ABS },
      ],
      "terminal.integrated.env.osx": { FOO: "bar", [KEY]: ABS },
      "terminal.integrated.env.linux": { FOO: "bar", [KEY]: ABS },
      "terminal.integrated.env.windows": { FOO: "bar", [KEY]: ABS },
    },
  });
  vs.activate();
  // Seeded synchronously, before any await, so Claude Code sees it.
  assert.equal(process.env[KEY], ABS);
  await settle();
  assert.equal(vs.user["claudeConfigSwitcher.defaultProfile"], "personal");
  assert.deepEqual(vs.user["claudeCode.environmentVariables"], [
    { name: "OTHER", value: "1" },
  ]);
  const os = { darwin: "osx", win32: "windows" }[process.platform] || "linux";
  assert.deepEqual(vs.user[`terminal.integrated.env.${os}`], { FOO: "bar" });
  assert.doesNotMatch(vs.statusBar.text, /\$\(sync\)/);
});

test("pre-1.1 settings namespace is copied over", async () => {
  const vs = load({
    user: {
      "claudeProfileSwitcher.profiles": [{ label: "work", configDir: WORK }],
      "claudeProfileSwitcher.colors": { work: "#c62828" },
    },
  });
  vs.activate();
  await settle();
  assert.deepEqual(vs.user["claudeConfigSwitcher.profiles"], [
    { label: "work", configDir: WORK },
  ]);
  assert.deepEqual(vs.user["claudeConfigSwitcher.colors"], { work: "#c62828" });
});

test("another extension's claudeProfileSwitcher.profiles is left alone", async () => {
  const theirs = [{ name: "Work", configDir: "~/.claude-work" }];
  const vs = load({ user: { "claudeProfileSwitcher.profiles": theirs } });
  vs.activate();
  await settle();
  assert.equal(vs.user["claudeConfigSwitcher.profiles"], undefined);
  assert.deepEqual(vs.user["claudeProfileSwitcher.profiles"], theirs);
});

test("Windows drive paths count as absolute", () => {
  assert.ok(path.win32.isAbsolute("C:\\Users\\me\\.claude-work"));
});
