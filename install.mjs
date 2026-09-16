#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TARGET_ROOT = path.join(os.homedir(), ".cursor", "plugins", "local");
const EXCLUDED_TOP_LEVEL = new Set([".git", "logs", "node_modules", "screens", "data", "test"]);

export const RECEIPT_FILE = ".agent-bundle-install.json";

function exists(targetPath) {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getPluginMeta(sourceRoot) {
  const pkg = readJson(path.join(sourceRoot, "package.json"));
  return {
    name: pkg.name || "plugin-library",
    version: pkg.version || "0.0.0",
  };
}

function walkFiles(rootPath, currentDir, acc) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootPath, absolutePath);
    const topLevel = relativePath.split(path.sep)[0];
    if (EXCLUDED_TOP_LEVEL.has(topLevel)) continue;
    if (entry.isSymbolicLink()) {
      throw new Error(`refusing to package symlinked path: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      walkFiles(rootPath, absolutePath, acc);
      continue;
    }
    if (entry.isFile()) acc.push(relativePath.split(path.sep).join("/"));
  }
}

export function listBundleFiles(sourceRoot = SOURCE_ROOT) {
  const files = [];
  walkFiles(sourceRoot, sourceRoot, files);
  files.sort();
  return files;
}

export function computeContentHash(sourceRoot = SOURCE_ROOT, files = listBundleFiles(sourceRoot)) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(sourceRoot, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readReceipt(targetDir) {
  const receiptPath = path.join(targetDir, RECEIPT_FILE);
  if (!exists(receiptPath)) return null;
  try {
    return readJson(receiptPath);
  } catch {
    return null;
  }
}

export function planInstall({
  sourceRoot = SOURCE_ROOT,
  targetRoot = DEFAULT_TARGET_ROOT,
  replace = false,
  force = false,
} = {}) {
  const plugin = getPluginMeta(sourceRoot);
  const files = listBundleFiles(sourceRoot);
  const contentHash = computeContentHash(sourceRoot, files);
  const targetDir = path.join(targetRoot, plugin.name);
  const receipt = readReceipt(targetDir);

  if (!exists(targetDir)) {
    return { action: "install", plugin: plugin.name, version: plugin.version, mode: "local", files, contentHash, targetDir };
  }
  if (!replace && !force && receipt?.contentHash === contentHash) {
    return { action: "noop", plugin: plugin.name, version: plugin.version, mode: "local", files, contentHash, targetDir };
  }
  if (replace || force) {
    return { action: "replace", plugin: plugin.name, version: plugin.version, mode: "local", files, contentHash, targetDir };
  }
  return {
    action: "replace-required",
    plugin: plugin.name,
    version: plugin.version,
    mode: "local",
    files,
    contentHash,
    targetDir,
    reason: "existing install differs; rerun with --replace or --force",
  };
}

function stageCopy({ sourceRoot, targetDir, files, receipt }) {
  const stagingDir = `${targetDir}.tmp-${process.pid}-${Date.now()}`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  for (const relativePath of files) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const destPath = path.join(stagingDir, relativePath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
  }
  fs.writeFileSync(path.join(stagingDir, RECEIPT_FILE), JSON.stringify(receipt, null, 2) + "\n");
  return stagingDir;
}

export function installBundle(options = {}) {
  const plan = planInstall(options);
  if (plan.action === "noop") {
    return { ...plan, changed: false, reason: "content hash matches" };
  }
  if (plan.action === "replace-required") {
    throw new Error(plan.reason);
  }

  fs.mkdirSync(path.dirname(plan.targetDir), { recursive: true });
  const receipt = {
    plugin: plan.plugin,
    version: plan.version,
    contentHash: plan.contentHash,
    files: plan.files,
    mode: "local",
    registrations: ["cursor-local-plugin"],
  };
  const stagingDir = stageCopy({
    sourceRoot: options.sourceRoot || SOURCE_ROOT,
    targetDir: plan.targetDir,
    files: plan.files,
    receipt,
  });

  fs.rmSync(plan.targetDir, { recursive: true, force: true });
  fs.renameSync(stagingDir, plan.targetDir);
  return { ...plan, changed: true };
}

export function uninstallBundle({ targetRoot = DEFAULT_TARGET_ROOT, sourceRoot = SOURCE_ROOT, plan = false } = {}) {
  const plugin = getPluginMeta(sourceRoot);
  const targetDir = path.join(targetRoot, plugin.name);
  const installed = exists(targetDir);
  if (plan) {
    return {
      action: installed ? "remove" : "noop",
      plugin: plugin.name,
      version: plugin.version,
      targetDir,
      mode: "local",
      changed: false,
    };
  }
  if (!installed) {
    return { action: "noop", plugin: plugin.name, version: plugin.version, targetDir, mode: "local", changed: false };
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  return { action: "remove", plugin: plugin.name, version: plugin.version, targetDir, mode: "local", changed: true };
}

function parseArgs(argv) {
  return {
    plan: argv.includes("--plan"),
    replace: argv.includes("--replace"),
    force: argv.includes("--force"),
    uninstall: argv.includes("--uninstall"),
  };
}

function printResult(result, dryRun) {
  if (result.action === "noop" && !result.changed) {
    console.log(`${result.plugin} is already installed at ${result.targetDir} (${result.reason || "no changes"})`);
    return;
  }
  if (dryRun) {
    console.log(`[plan] ${result.action} ${result.plugin} in ${result.targetDir}`);
    return;
  }
  if (result.action === "remove") {
    console.log(`Removed ${result.plugin} from ${result.targetDir}`);
    return;
  }
  console.log(`Installed ${result.plugin}@${result.version} to ${result.targetDir}`);
  console.log("Reload Cursor to pick up the updated local plugin.");
}

export async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.uninstall) {
    const result = uninstallBundle({ plan: flags.plan });
    printResult(result, flags.plan);
    return result;
  }
  const result = flags.plan ? planInstall(flags) : installBundle(flags);
  printResult(result, flags.plan);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
