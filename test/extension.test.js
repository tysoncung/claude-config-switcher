const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

/** Run fn with a throwaway home folder, so tests never touch the real one. */
async function withHome(fn) {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-home-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    await fn(home);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

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

test("window-only profile colors the status bar item, not the project's settings", async () => {
  const vs = load({
    user: {
      ...PROFILES,
      "claudeConfigSwitcher.colors": { personal: "#2e7d32", work: "#c62828" },
      "claudeConfigSwitcher.defaultProfile": "work",
    },
  });
  vs.activate();
  await settle();

  await vs.switcher((i) => i.label === "personal", "window");
  assert.equal(vs.workspace["workbench.colorCustomizations"], undefined);
  assert.equal(vs.statusBar.color, "#2e7d32");
  assert.equal(
    vs.user["workbench.colorCustomizations"]["statusBar.background"],
    "#c62828"
  );
});

test("the workspace tint 1.2 wrote for a window-only profile is cleared", async () => {
  const tint = { "statusBar.background": "#2e7d32" };
  const vs = load({
    user: { ...PROFILES, "claudeConfigSwitcher.colors": { personal: "#2e7d32" } },
    workspace: {
      "workbench.colorCustomizations": { ...tint, "editor.background": "#000" },
    },
  });
  vs.context.workspaceState.data.profile = "personal";
  vs.context.workspaceState.data.ownedColors = tint;
  vs.activate();
  await settle();
  assert.deepEqual(vs.workspace["workbench.colorCustomizations"], {
    "editor.background": "#000",
  });
});

test("a discovered folder doesn't shadow a listed profile with the same name", async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, ".claude-work"));
    fs.mkdirSync(path.join(home, ".claude-extra"));
    const vs = load({
      user: { "claudeConfigSwitcher.profiles": [{ label: "work", configDir: ABS }] },
    });
    vs.activate();
    await settle();

    let shown;
    vs.answer((items) => {
      shown = items;
    });
    await vs.commands["claudeConfigSwitcher.setColor"]();
    assert.deepEqual(
      shown.map((i) => [i.label, i.profile.configDir]),
      [
        ["default", ""],
        ["work", ABS],
        ["extra", path.join(home, ".claude-extra")],
      ]
    );
  });
});

/** Share settings.json, and pick No color. */
const createAnswers = (items) =>
  items.some((i) => "picked" in i)
    ? items.filter((i) => i.picked)
    : items.find((i) => i.hex === "");

test("create profile copies the picked files into ~/.claude-<name>", async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, ".claude"));
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");
    const vs = load();
    vs.activate();
    await settle();

    vs.input("work");
    vs.answer(createAnswers);
    await vs.commands["claudeConfigSwitcher.create"]();
    assert.ok(fs.existsSync(path.join(home, ".claude-work", "settings.json")));
    assert.match(vs.messages.at(-1), /Created profile "work"/);
  });
});

test("a failed copy into a new profile removes the half-made folder", async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, ".claude"));
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");
    const vs = load();
    vs.activate();
    await settle();

    vs.input("work");
    vs.answer(createAnswers);
    const { cpSync } = fs;
    fs.cpSync = () => {
      throw new Error("EACCES: permission denied");
    };
    try {
      await vs.commands["claudeConfigSwitcher.create"]();
    } finally {
      fs.cpSync = cpSync;
    }
    assert.equal(fs.existsSync(path.join(home, ".claude-work")), false);
    assert.match(vs.messages.at(-1), /^ERROR Could not copy .*EACCES/);
  });
});

test("a settings write that fails during migration is reported", async () => {
  const vs = load({
    user: { ...PROFILES, "claudeCode.environmentVariables": [{ name: KEY, value: ABS }] },
    failing: ["claudeCode.environmentVariables"],
  });
  vs.activate();
  await settle();
  assert.equal(process.env[KEY], ABS);
  assert.ok(
    vs.messages.some((m) =>
      /^ERROR .*could not update your settings: settings\.json has errors/.test(m)
    )
  );
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
