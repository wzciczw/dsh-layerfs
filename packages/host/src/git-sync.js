// Git sync for one LayerFS project: a thin Host bridge to an installed
// layerfs-git-sync CLI. The UI never runs git itself; the CLI owns the mirror,
// manifest and conflict worktrees. This module stores only which local mirror a
// project uses and runs the CLI's documented commands.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const TIMEOUT_MS = 120_000;

const stateFile = (spec, project) => join(spec.stateDir, "git-sync", `${project}.json`);

export function mirrorOf(spec, project) {
  try { return JSON.parse(readFileSync(stateFile(spec, project), "utf8")).mirror ?? null; } catch { return null; }
}

export function setMirror(spec, project, mirror) {
  if (typeof mirror !== "string" || !isAbsolute(mirror)) throw Object.assign(new Error("mirror must be an absolute path"), { status: 400 });
  if (!existsSync(mirror) || !statSync(mirror).isDirectory()) throw Object.assign(new Error("mirror folder does not exist"), { status: 400 });
  if (!existsSync(join(mirror, ".git"))) throw Object.assign(new Error("mirror folder is not a git repository (.git missing)"), { status: 400 });
  mkdirSync(join(spec.stateDir, "git-sync"), { recursive: true });
  writeFileSync(stateFile(spec, project), JSON.stringify({ mirror }, null, 2) + "\n");
  return mirror;
}

const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
const commandOf = (spec) => process.env.DSH_LAYERFS_GIT_SYNC_CLI || spec.gitSync || "layerfs-git-sync";

/** One CLI attempt; no retry. Resolves {code, stdout, stderr}; the caller decides. */
export function runCli(spec, args) {
  const command = commandOf(spec);
  const onWindows = process.platform === "win32";
  const line = [command, ...args].map(quote).join(" ");
  const child = onWindows ? spawn(line, { shell: true, windowsHide: true, env: process.env }) : spawn(command, args, { windowsHide: true, env: process.env });
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "", timer;
    timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error(`git sync timed out after ${TIMEOUT_MS} ms`), { status: 504 })); }, TIMEOUT_MS);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(Object.assign(error, { status: 500 })); });
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
  });
}

const configOf = (mirror) => join(mirror, ".git", "layerfs-git-sync.json");

function parse(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  try { return JSON.parse(lines[lines.length - 1] ?? "null"); } catch { return null; }
}

function fail(answer) {
  const message = answer.stderr.trim() || answer.stdout.trim() || `git sync exited ${answer.code}`;
  throw Object.assign(new Error(message), { status: answer.code === 3 ? 409 : 500, code: answer.code });
}

export async function statusOf(spec, project) {
  const mirror = mirrorOf(spec, project);
  if (!mirror) return { configured: false, command: commandOf(spec) };
  let answer;
  try { answer = await runCli(spec, ["status", "--config", configOf(mirror), "--json"]); }
  catch (error) { return { configured: true, mirror, command: commandOf(spec), error: error.message }; }
  if (answer.code !== 0) return { configured: true, mirror, command: commandOf(spec), error: (answer.stderr || answer.stdout).trim() };
  return { configured: true, mirror, command: commandOf(spec), status: parse(answer.stdout) };
}

export async function configure(spec, project, mirror) {
  setMirror(spec, project, mirror);
  if (!existsSync(configOf(mirror))) {
    const answer = await runCli(spec, ["init", "--repo", mirror, "--store", `layerfs:${project}`, "--json"]);
    if (answer.code !== 0) fail(answer);
  }
  return statusOf(spec, project);
}

export async function act(spec, project, body) {
  const mirror = mirrorOf(spec, project);
  if (!mirror) throw Object.assign(new Error("configure a local git mirror first"), { status: 400 });
  const config = configOf(mirror);
  const action = body?.action;
  let args;
  if (action === "status") return statusOf(spec, project);
  if (action === "export") {
    args = ["export", "--config", config, "--json"];
    if (typeof body.ref === "string" && body.ref) args.push("--ref", body.ref);
    if (typeof body.branch === "string" && body.branch) args.push("--branch", body.branch);
    if (typeof body.mergeInto === "string" && body.mergeInto) args.push("--merge-into", body.mergeInto);
  } else if (action === "import") {
    args = ["import", "--config", config, "--json"];
    if (body.publish === true) args.push("--publish");
    if (typeof body.resolved === "string" && body.resolved) args.push("--resolved", body.resolved);
    if (body.abort === true) args.push("--abort");
  } else if (action === "publish") {
    args = ["publish", "--config", config, "--json"];
    if (typeof body.branch === "string" && body.branch) args.push("--branch", body.branch);
  } else {
    throw Object.assign(new Error(`unknown git sync action: ${action}`), { status: 400 });
  }
  const answer = await runCli(spec, args);
  if (answer.code !== 0) fail(answer);
  return { result: parse(answer.stdout), status: await statusOf(spec, project) };
}