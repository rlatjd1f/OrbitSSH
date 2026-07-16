import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "electron", "helpers", "InputSourceSwitcher.swift");
const outputDirectory = path.join(root, "electron", "helpers", "bin");
const output = path.join(outputDirectory, "InputSourceSwitcher");

if (os.platform() !== "darwin") {
  process.exit(0);
}

fs.mkdirSync(outputDirectory, { recursive: true });
const result = spawnSync(
  "/usr/bin/swiftc",
  [source, "-framework", "Carbon", "-o", output],
  { stdio: "inherit" },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

fs.chmodSync(output, 0o755);
