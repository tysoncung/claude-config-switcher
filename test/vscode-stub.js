// A small in-memory stand-in for the parts of the VS Code API the extension uses.
// User and workspace settings are plain objects keyed by full setting name.

const Module = require("node:module");
const path = require("node:path");

const EXTENSION = path.join(__dirname, "..", "extension.js");

function memento() {
  const data = {};
  return {
    data,
    get: (k, d) => (k in data ? data[k] : d),
    update: async (k, v) => {
      if (v === undefined) delete data[k];
      else data[k] = v;
    },
  };
}

/**
 * Load a fresh copy of extension.js against a new fake VS Code.
 * @param {object} opts.user initial User settings
 * @param {object} opts.workspace initial Workspace settings
 * @param {boolean} opts.trusted whether the workspace is trusted
 * @param {string[]} opts.failing settings whose writes throw, like a broken settings.json
 */
function load({
  user = {},
  workspace = {},
  trusted = true,
  hasFolder = true,
  failing = [],
} = {}) {
  const listeners = [];
  const commands = {};
  const messages = [];
  const quickPicks = [];
  let nextPick;
  let nextQuickPick;
  let nextInput;

  const fire = (key) => {
    for (const fn of listeners) fn({ affectsConfiguration: (s) => key.startsWith(s) });
  };

  function getConfiguration(section) {
    const full = (k) => (section ? `${section}.${k}` : k);
    return {
      get(k, d) {
        const key = full(k);
        // Only window-scoped settings may come from the workspace.
        const v =
          (key === "claudeConfigSwitcher.profile" ? workspace[key] : undefined) ??
          user[key];
        return v === undefined ? d : v;
      },
      inspect: (k) => ({
        globalValue: user[full(k)],
        workspaceValue: workspace[full(k)],
      }),
      async update(k, v, target) {
        const key = full(k);
        if (key.startsWith("claudeProfileSwitcher."))
          throw new Error("not a registered setting");
        if (failing.includes(key)) throw new Error("settings.json has errors");
        const store = target === 2 ? workspace : user;
        if (v === undefined) delete store[key];
        else store[key] = v;
        fire(key);
      },
    };
  }

  const terminalEnv = {
    vars: {},
    clear() {
      this.vars = {};
    },
    replace(k, v) {
      this.vars[k] = v;
    },
  };

  let statusBar;
  const vscode = {
    workspace: {
      getConfiguration,
      onDidChangeConfiguration: (fn) => listeners.push(fn),
      onDidGrantWorkspaceTrust: () => ({}),
      get isTrusted() {
        return trusted;
      },
      get workspaceFolders() {
        return hasFolder ? [{}] : undefined;
      },
      fs: {},
    },
    window: {
      createStatusBarItem: () => {
        statusBar = { show() {} };
        return statusBar;
      },
      showQuickPick: async (items) => nextPick?.(items),
      showInputBox: async (opts) => nextInput?.(opts),
      createQuickPick() {
        const qp = {
          items: [],
          selectedItems: [],
          onDidAccept: (f) => {
            qp.accept = f;
          },
          onDidTriggerItemButton: (f) => {
            qp.button = f;
          },
          onDidHide: (f) => {
            qp.hide = f;
          },
          show: () => {
            quickPicks.push(qp);
            nextQuickPick(qp);
          },
          dispose() {},
        };
        return qp;
      },
      showInformationMessage: async (m) => {
        messages.push(m);
        return "Later";
      },
      showErrorMessage: async (m) => {
        messages.push(`ERROR ${m}`);
      },
    },
    commands: {
      registerCommand: (id, fn) => {
        commands[id] = fn;
        return {};
      },
      executeCommand: async () => {},
    },
    ThemeIcon: class {
      constructor(id) {
        this.id = id;
      }
    },
    ThemeColor: class {
      constructor(id) {
        this.id = id;
      }
    },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    StatusBarAlignment: { Right: 2 },
    QuickPickItemKind: { Separator: -1 },
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "vscode") return vscode;
    return originalLoad.call(this, request, ...rest);
  };
  delete require.cache[EXTENSION];
  let ext;
  try {
    ext = require(EXTENSION);
  } finally {
    Module._load = originalLoad;
  }

  const context = {
    globalState: memento(),
    workspaceState: memento(),
    subscriptions: [],
    environmentVariableCollection: terminalEnv,
  };

  return {
    ext,
    context,
    user,
    workspace,
    terminalEnv,
    messages,
    commands,
    fire,
    get statusBar() {
      return statusBar;
    },
    activate: () => ext.activate(context),
    /** Answer the next showQuickPick by item label. */
    pick(label) {
      nextPick = (items) => items.find((i) => i.label === label);
    },
    /** Answer every showQuickPick with fn(items). */
    answer(fn) {
      nextPick = fn;
    },
    /** Type value into the next input box. */
    input(value) {
      nextInput = () => value;
    },
    /** Accept a row of the switcher, or press one of its buttons ("project", "window", "global"). */
    switcher(match, button) {
      nextQuickPick = (qp) => {
        const item = qp.items.find(match);
        if (!button) {
          qp.selectedItems = [item];
          qp.accept();
        } else {
          const tooltip = { project: "project", window: "window", global: "global" }[
            button
          ];
          qp.button({
            item,
            button: item.buttons.find((b) => b.tooltip.includes(tooltip)),
          });
        }
      };
      return commands["claudeConfigSwitcher.switch"]();
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

module.exports = { load, settle };
