#!/usr/bin/env node
// Tiered large-file governance: scan source files, apply policy.json rules, output report + optional baseline.
// Modes: report (no exit), warn (exit 0, print only), fail (exit 1 when over fail threshold and not in baseline).
// Scope: warn (apply warnThreshold) or fail (apply failThreshold).
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
  ".idea",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
]);

const EXCLUDED_PREFIXES = [
  "src-tauri/binaries/",
  "src-tauri/gen/",
  "src-tauri/target/",
];

const EXCLUDED_FILES = new Set(["package-lock.json"]);

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function parseArgs(argv) {
  const config = {
    root: process.cwd(),
    threshold: null, // legacy single-threshold mode if set
    policyFile: null,
    baselineFile: null,
    baselineOutput: null,
    markdownOutput: null,
    scope: "fail", // "warn" | "fail"
    mode: "warn", // "report" | "warn" | "fail"
    limit: 50,
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
    if (token === "--policy-file") {
      config.policyFile = path.resolve(readOptionValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--baseline-file") {
      config.baselineFile = path.resolve(readOptionValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--baseline-output") {
      config.baselineOutput = path.resolve(readOptionValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--markdown-output") {
      config.markdownOutput = path.resolve(readOptionValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--scope") {
      const scope = readOptionValue(argv, index, token);
      if (!["warn", "fail"].includes(scope)) {
        throw new Error(`Invalid scope: ${scope}`);
      }
      config.scope = scope;
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

function shouldSkipDirectory(directoryPath) {
  return EXCLUDED_DIRS.has(path.basename(directoryPath));
}

function shouldSkipFile(root, filePath) {
  const relative = toRelativePath(root, filePath);
  if (EXCLUDED_FILES.has(relative)) return true;
  return EXCLUDED_PREFIXES.some((prefix) => relative.startsWith(prefix));
}

async function walkDirectory(root, directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(fullPath)) {
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
  if (content.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") lines += 1;
  }
  return content.endsWith("\n") ? lines - 1 : lines;
}

function matchesPolicy(relativePath, match) {
  if (!match) return false;
  if (Array.isArray(match.exactPaths) && match.exactPaths.includes(relativePath)) return true;
  if (Array.isArray(match.prefixes) && match.prefixes.some((p) => relativePath.startsWith(p))) return true;
  if (Array.isArray(match.suffixes) && match.suffixes.some((s) => relativePath.endsWith(s))) return true;
  return false;
}

function pickPolicy(relativePath, policies, defaultPolicy) {
  for (const policy of policies) {
    if (matchesPolicy(relativePath, policy.match)) return policy;
  }
  return defaultPolicy;
}

async function loadJsonIfExists(file) {
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function formatRow({ path: filePath, lines, policyId, priority, threshold }) {
  return `${String(lines).padStart(5, " ")}  [${priority}] ${policyId.padEnd(22)} ${filePath} (gate ${threshold})`;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));

  // Legacy single-threshold mode (preserves backward compatibility with existing scripts)
  if (!config.policyFile) {
    if (config.threshold === null) {
      config.threshold = 1000;
    }
    const files = await walkDirectory(config.root, config.root);
    const results = [];
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf8");
      const lines = countLines(content);
      if (lines >= config.threshold) {
        results.push({ path: toRelativePath(config.root, filePath), lines });
      }
    }
    results.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
    if (results.length === 0) {
      console.log(`check-large-files: OK, no files >= ${config.threshold} lines.`);
      return;
    }
    console.log(`check-large-files: ${results.length} file(s) >= ${config.threshold} lines.`);
    for (const item of results.slice(0, config.limit)) {
      console.log(`${String(item.lines).padStart(5, " ")}  ${item.path}`);
    }
    if (config.mode === "fail") process.exit(1);
    return;
  }

  // Policy mode
  const policy = await loadJsonIfExists(config.policyFile);
  if (!policy) throw new Error(`Cannot load policy file: ${config.policyFile}`);
  const policies = policy.policies ?? [];
  const defaultPolicy = policy.defaultPolicy ?? {
    id: "default-source",
    priority: "P1",
    warnThreshold: 1000,
    failThreshold: 1800,
  };

  const baseline = await loadJsonIfExists(config.baselineFile);
  const baselineSet = new Set();
  if (baseline && Array.isArray(baseline.entries)) {
    for (const entry of baseline.entries) baselineSet.add(entry.path);
  }

  const files = await walkDirectory(config.root, config.root);
  const matched = [];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");
    const lines = countLines(content);
    const relativePath = toRelativePath(config.root, filePath);
    const picked = pickPolicy(relativePath, policies, defaultPolicy);
    const threshold = config.scope === "fail" ? picked.failThreshold : picked.warnThreshold;
    if (lines >= threshold) {
      matched.push({
        path: relativePath,
        lines,
        policyId: picked.id,
        priority: picked.priority,
        threshold,
        warnThreshold: picked.warnThreshold,
        failThreshold: picked.failThreshold,
      });
    }
  }

  matched.sort(
    (a, b) =>
      ["P0", "P1", "P2"].indexOf(a.priority) - ["P0", "P1", "P2"].indexOf(b.priority) ||
      b.lines - a.lines ||
      a.path.localeCompare(b.path),
  );

  const violators = matched.filter((item) => !baselineSet.has(item.path));
  const baselineHits = matched.filter((item) => baselineSet.has(item.path));

  // Output text report
  if (matched.length === 0) {
    console.log(
      `check-large-files: OK — no files exceed ${config.scope} thresholds (policy v=${policy.version ?? "?"}).`,
    );
  } else {
    console.log(
      `check-large-files: ${matched.length} file(s) over ${config.scope} threshold (policy v=${policy.version ?? "?"}; baseline=${config.baselineFile ? "yes" : "no"}).`,
    );
    if (violators.length > 0) {
      console.log(`\n  New / regressed (NOT in baseline) — ${violators.length}:`);
      for (const item of violators.slice(0, config.limit)) {
        console.log("  " + formatRow(item));
      }
    }
    if (baselineHits.length > 0) {
      console.log(`\n  Baseline (allowed legacy) — ${baselineHits.length}:`);
      for (const item of baselineHits.slice(0, config.limit)) {
        console.log("  " + formatRow(item));
      }
    }
  }

  // Optional baseline output
  if (config.baselineOutput) {
    const payload = {
      generatedAt: new Date().toISOString().slice(0, 10),
      scope: config.scope,
      policyVersion: policy.version ?? null,
      entries: matched.map((item) => ({
        path: item.path,
        lines: item.lines,
        policyId: item.policyId,
        priority: item.priority,
        warnThreshold: item.warnThreshold,
        failThreshold: item.failThreshold,
      })),
    };
    await fs.mkdir(path.dirname(config.baselineOutput), { recursive: true });
    await fs.writeFile(config.baselineOutput, JSON.stringify(payload, null, 2) + "\n", "utf8");
    console.log(`\ncheck-large-files: baseline written to ${toRelativePath(config.root, config.baselineOutput)}`);
  }

  if (config.markdownOutput) {
    const lines = [
      `# Large file watchlist`,
      ``,
      `_Generated ${new Date().toISOString().slice(0, 10)} — scope: ${config.scope}, policy v=${policy.version ?? "?"}_`,
      ``,
      `| Lines | Priority | Policy | Path | Gate |`,
      `| ---: | --- | --- | --- | ---: |`,
      ...matched.map(
        (item) =>
          `| ${item.lines} | ${item.priority} | \`${item.policyId}\` | \`${item.path}\` | ${item.threshold} |`,
      ),
    ];
    await fs.mkdir(path.dirname(config.markdownOutput), { recursive: true });
    await fs.writeFile(config.markdownOutput, lines.join("\n") + "\n", "utf8");
    console.log(`check-large-files: markdown written to ${toRelativePath(config.root, config.markdownOutput)}`);
  }

  if (config.mode === "fail" && violators.length > 0) {
    console.error(
      `\ncheck-large-files: FAIL — ${violators.length} new violation(s) over ${config.scope} threshold. Refactor, or update baseline if accepted.`,
    );
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  console.error(`check-large-files: failed\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
