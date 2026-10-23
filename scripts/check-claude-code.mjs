// Checks that the latest Claude Code extension still behaves the way per-window
// profiles rely on. Run by .github/workflows/claude-code-compat.yml on a schedule.
//
//   node scripts/check-claude-code.mjs            # latest from the Marketplace
//   node scripts/check-claude-code.mjs some.vsix  # a package you already have

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function download() {
  const res = await fetch(
    "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json;api-version=3.0-preview.1",
      },
      body: JSON.stringify({
        filters: [{ criteria: [{ filterType: 7, value: "anthropic.claude-code" }] }],
        flags: 0x93,
      }),
    }
  );
  const versions = (await res.json()).results[0].extensions[0].versions;
  const latest = versions.find((v) => v.targetPlatform === "linux-x64") || versions[0];
  const url = latest.files.find((f) => f.assetType.endsWith(".VSIXPackage")).source;
  const file = join(mkdtempSync(join(tmpdir(), "claude-code-")), "claude-code.vsix");
  writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  return { file, version: latest.version };
}

const unzip = (vsix, entry) =>
  execFileSync("unzip", ["-p", vsix, entry], { maxBuffer: 256 * 1024 * 1024 }).toString();

const given = process.argv[2];
const { file, version } = given ? { file: given, version: "local" } : await download();

const manifest = JSON.parse(unzip(file, "extension/package.json"));
const bundle = unzip(file, `extension/${manifest.main.replace(/^\.\//, "")}`);

const checks = [
  {
    name: "builds the spawn env from process.env, then the environmentVariables setting",
    ok: [...bundle.matchAll(/"environmentVariables"\)/g)].some((m) =>
      bundle.slice(m.index, m.index + 200).includes("{...process.env}")
    ),
  },
  {
    name: 'does not activate on "*", so this extension seeds the env first',
    ok: !(manifest.activationEvents || []).includes("*"),
  },
  {
    name: "still reads CLAUDE_CONFIG_DIR from process.env",
    ok: bundle.includes("process.env.CLAUDE_CONFIG_DIR"),
  },
];

console.log(`anthropic.claude-code ${manifest.version || version}`);
for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}`);
if (!given) rmSync(join(file, ".."), { recursive: true, force: true });
if (checks.some((c) => !c.ok)) process.exit(1);
