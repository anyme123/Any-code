import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const strict = process.argv.includes("--strict");
const CMAKE_WINDOWS_PATHS = [
  "C:\\Program Files\\CMake\\bin\\cmake.exe",
  "C:\\Program Files (x86)\\CMake\\bin\\cmake.exe",
];

function hasCommand(command) {
  const checker = process.platform === "win32" ? "where" : "command";
  const checkerArgs = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(checker, checkerArgs, { stdio: "ignore" });
  if (result.status === 0) {
    return true;
  }

  if (process.platform === "win32" && command === "cmake") {
    return CMAKE_WINDOWS_PATHS.some((commandPath) => existsSync(commandPath));
  }

  return false;
}

function hasNodeMajorAtLeast(minimumMajor) {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
  return Number.isInteger(major) && major >= minimumMajor;
}

const missing = [];
if (!hasNodeMajorAtLeast(18)) {
  missing.push("node>=18");
}
for (const command of ["npm", "rustc", "cargo"]) {
  if (!hasCommand(command)) {
    missing.push(command);
  }
}

if (missing.length === 0) {
  console.log("Doctor: OK");
  process.exit(0);
}

console.log(`Doctor: missing dependencies: ${missing.join(" ")}`);

switch (process.platform) {
  case "darwin":
    console.log("Install: brew install node rust");
    break;
  case "linux":
    console.log("Install Node.js 18+ and Rust from your distribution or rustup.rs.");
    break;
  case "win32":
    console.log("Install Node.js from https://nodejs.org/ and Rust from https://rustup.rs/.");
    break;
  default:
    console.log("Install Node.js 18+ and Rust before building this project.");
    break;
}

process.exit(strict ? 1 : 0);
