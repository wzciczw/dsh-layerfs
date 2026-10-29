// Host git-sync.js without dsh, Docker, git sync CLI internals:
//   node packages/host/tests/git-sync.mjs
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusOf, configure, act, mirrorOf } from "../src/git-sync.js";

const dir = mkdtempSync(join(tmpdir(), "dsh-layerfs-git-sync-"));
const mirror = join(dir, "mirror");
mkdirSync(join(mirror, ".git"), { recursive: true });
const log = join(dir, "calls.jsonl");
const fake = join(dir, "fake-cli.mjs");
writeFileSync(fake, `import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (args[0] === "init") {
  const repo = args[args.indexOf("--repo") + 1];
  writeFileSync(${JSON.stringify(join(mirror, ".git", "layerfs-git-sync.json"))}, "{}\\n");
  console.log(JSON.stringify({ ok: true, configFile: repo + "/.git/layerfs-git-sync.json" }));
} else if (args[0] === "status") {
  console.log(JSON.stringify({ repo: ${JSON.stringify(mirror)}, gitHit: "a", gitDirty: false, layerfsMain: "b", layerfsChanged: false, gitChanged: false, advice: "ok" }, null, 2));
} else if (args[0] === "export") {
  console.log(JSON.stringify({ branch: "layerfs/export", commit: "c" }));
} else if (args[0] === "import" && args.includes("--abort")) {
  console.log(JSON.stringify({ aborted: true }));
} else if (args[0] === "import") {
  console.error("ERROR: conflict worktree C:/tmp/wt"); process.exit(3);
} else { console.log(JSON.stringify({ ok: true })); }
`);
const cli = join(dir, process.platform === "win32" ? "fake-cli.cmd" : "fake-cli");
writeFileSync(cli, process.platform === "win32" ? `@echo off\r\nnode "${fake}" %*\r\n` : `#!/bin/sh\nexec node "${fake}" "$@"\n`);
if (process.platform !== "win32") chmodSync(cli, 0o755);
const spec = { stateDir: join(dir, "state"), gitSync: cli };

const unconfigured = await statusOf(spec, "demo");
assert.equal(unconfigured.configured, false);
assert.equal(mirrorOf(spec, "demo"), null);

const configured = await configure(spec, "demo", mirror);
assert.equal(configured.configured, true);
assert.equal(configured.mirror, mirror);
assert.equal(configured.status.advice, "ok");

const calls = readFileSync(log, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
assert.deepEqual(calls[0].slice(0, 2), ["init", "--repo"]);
assert.equal(mirrorOf(spec, "demo"), mirror);

const exported = await act(spec, "demo", { action: "export", ref: "agent-a", mergeInto: "main" });
assert.equal(exported.result.branch, "layerfs/export");
const exportCall = readFileSync(log, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line)).at(-2);
assert(exportCall.includes("--ref") && exportCall.includes("agent-a") && exportCall.includes("--merge-into") && exportCall.includes("main"));

await assert.rejects(() => act(spec, "demo", { action: "import" }), (error) => error.status === 409 && /conflict worktree/.test(error.message));
const aborted = await act(spec, "demo", { action: "import", abort: true });
assert.equal(aborted.result.aborted, true);
await assert.rejects(() => act(spec, "demo", { action: "nope" }), /unknown git sync action/);
console.log("git-sync: ok");