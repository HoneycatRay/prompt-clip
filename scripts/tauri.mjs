import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = { ...process.env };
const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const cargoExecutable = path.join(
  cargoBin,
  process.platform === "win32" ? "cargo.exe" : "cargo",
);
const pathKey =
  Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
const pathEntries = (env[pathKey] ?? "").split(path.delimiter);
const requiredBins = [path.dirname(process.execPath)];

if (existsSync(cargoExecutable)) {
  requiredBins.push(cargoBin);
}

const normalizePathEntry = (entry) =>
  process.platform === "win32"
    ? entry.replace(/[\\/]+$/, "").toLowerCase()
    : entry;
const existingPaths = new Set(pathEntries.map(normalizePathEntry));
const additionalBins = requiredBins.filter(
  (bin) => !existingPaths.has(normalizePathEntry(bin)),
);

env[pathKey] = [...additionalBins, ...pathEntries].filter(Boolean).join(path.delimiter);
for (const key of Object.keys(env)) {
  if (key !== pathKey && key.toLowerCase() === "path") {
    delete env[key];
  }
}

if (process.platform === "win32" && !env.CARGO_TARGET_DIR) {
  env.CARGO_TARGET_DIR = path.join(os.homedir(), ".cargo", "target", "prompt-clip");
}

const cargoCheck = spawnSync("cargo", ["--version"], { env, encoding: "utf8" });
if (cargoCheck.error || cargoCheck.status !== 0) {
  console.error(
    `Rust Cargo is unavailable. Install Rust from https://rustup.rs/ or add its bin directory to PATH.${
      cargoCheck.error ? `\n${cargoCheck.error.message}` : ""
    }`,
  );
  process.exit(cargoCheck.status ?? 1);
}

const tauriCli = fileURLToPath(
  new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
);
if (!existsSync(tauriCli)) {
  console.error("Tauri CLI is missing. Run `npm install` before using `npm run tauri`.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Failed to start Tauri CLI: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
