import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs",
  ".css",
  ".json",
  ".toml",
]);

const EXCLUDED_DIRS = new Set([
  ".git",
  ".factory",
  ".claude",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "src-tauri/target",
]);

const EXCLUDED_PREFIXES = [
  "src-tauri/binaries/",
  "src-tauri/gen/",
];

const EXCLUDED_FILES = new Set(["package-lock.json"]);

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function parseArgs(argv) {
  const config = {
    root: process.cwd(),
    threshold: 3000,
    mode: "warn",
    limit: 25,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root") {
      config.root = path.resolve(readOptionValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--threshold") {
      const threshold = Number(readOptionValue(argv, index, token));
      if (!Number.isFinite(threshold) || threshold <= 0) {
        throw new Error(`Invalid threshold: ${threshold}`);
      }
      config.threshold = threshold;
      index += 1;
      continue;
    }
    if (token === "--mode") {
      const mode = readOptionValue(argv, index, token);
      if (!["report", "warn", "fail"].includes(mode)) {
        throw new Error(`Invalid mode: ${mode}`);
      }
      config.mode = mode;
      index += 1;
      continue;
    }
    if (token === "--limit") {
      const limit = Number(readOptionValue(argv, index, token));
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error(`Invalid limit: ${limit}`);
      }
      config.limit = limit;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return config;
}

function toRelativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function shouldSkipDirectory(root, directoryPath) {
  const relative = toRelativePath(root, directoryPath);
  return EXCLUDED_DIRS.has(path.basename(directoryPath)) || EXCLUDED_DIRS.has(relative);
}

function shouldSkipFile(root, filePath) {
  const relative = toRelativePath(root, filePath);
  return EXCLUDED_FILES.has(relative) || EXCLUDED_PREFIXES.some((prefix) => relative.startsWith(prefix));
}

async function walkDirectory(root, directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(root, fullPath)) {
        files.push(...(await walkDirectory(root, fullPath)));
      }
      continue;
    }
    if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name)) && !shouldSkipFile(root, fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function countLines(content) {
  if (content.length === 0) {
    return 0;
  }
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      lines += 1;
    }
  }
  return content.endsWith("\n") ? lines - 1 : lines;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const files = await walkDirectory(config.root, config.root);
  const results = [];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");
    const lines = countLines(content);
    if (lines >= config.threshold) {
      results.push({
        path: toRelativePath(config.root, filePath),
        lines,
      });
    }
  }

  results.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));

  if (results.length === 0) {
    console.log(`check-large-files: OK, no files at or above ${config.threshold} lines.`);
    return;
  }

  console.log(`check-large-files: ${results.length} file(s) at or above ${config.threshold} lines.`);
  for (const item of results.slice(0, config.limit)) {
    console.log(`${String(item.lines).padStart(5, " ")}  ${item.path}`);
  }

  if (config.mode === "fail") {
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  console.error(`check-large-files: failed\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
