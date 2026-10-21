import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * Packed tarball size limit (bytes). Measured packed size was 35,224 bytes on 2026-10-21;
 * limit is ~2× headroom (~75 KiB).
 */
export const MAX_PACKED_BYTES = 75_000;

/**
 * @param {string} relativePath path inside the package (no `package/` prefix)
 * @returns {boolean}
 */
export function isAllowedPackagePath(relativePath) {
  const normalized = posix.normalize(relativePath.replace(/\\/g, "/"));
  if (normalized.startsWith("../") || normalized.includes("/../")) {
    return false;
  }
  if (normalized === "package.json") return true;
  if (normalized === "LICENSE") return true;
  if (normalized === "README.md") return true;
  if (normalized.startsWith("LICENSES/")) return true;
  if (normalized.startsWith("templates/") && normalized.length > "templates/".length) {
    return true;
  }
  if (normalized.startsWith("dist/")) {
    if (!normalized.endsWith(".js")) return false;
    if (normalized.endsWith(".d.ts") || normalized.endsWith(".map")) return false;
    return true;
  }
  return false;
}

/**
 * @param {Buffer} gzBuffer
 * @returns {string[]}
 */
export function listTarGzEntries(gzBuffer) {
  const tar = gunzipSync(gzBuffer);
  const entries = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      break;
    }
    let name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/u, "");
    if (prefix) {
      name = `${prefix}/${name}`;
    }
    const sizeOct = header
      .subarray(124, 136)
      .toString("utf8")
      .replace(/\0.*$/u, "")
      .trim();
    const size = Number.parseInt(sizeOct, 8) || 0;
    const typeflag = header[156];
    if (typeflag === 0 || typeflag === 0x30) {
      entries.push(name);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/**
 * @param {import("node:fs").PathLike} archivePath
 * @returns {Promise<string[]>}
 */
export async function listPackageTarballPaths(archivePath) {
  const gz = readFileSync(archivePath);
  return listTarGzEntries(gz);
}

function stripPackagePrefix(tarPath) {
  const normalized = tarPath.replace(/\\/g, "/");
  if (normalized.startsWith("package/")) {
    return normalized.slice("package/".length);
  }
  return normalized;
}

/**
 * @param {string[]} tarballPaths raw paths from the archive
 * @param {string[]} requiredTemplateRelPaths e.g. `templates/foo.md`
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function inspectTarballFileList(tarballPaths, requiredTemplateRelPaths) {
  const relPaths = tarballPaths.map(stripPackagePrefix);
  for (const rel of relPaths) {
    if (!isAllowedPackagePath(rel)) {
      return { ok: false, message: `tarball contains disallowed path: ${rel}` };
    }
  }
  if (!relPaths.includes("dist/cli.js")) {
    return { ok: false, message: "tarball missing required file: dist/cli.js" };
  }
  for (const templatePath of requiredTemplateRelPaths) {
    if (!relPaths.includes(templatePath)) {
      return {
        ok: false,
        message: `tarball missing required template: ${templatePath}`,
      };
    }
  }
  return { ok: true };
}

function npmExecPath() {
  const npm = process.env.npm_execpath;
  if (!npm) {
    throw new Error("package:check must be run via npm (npm_execpath is unset)");
  }
  return npm;
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string; env?: Record<string, string> }} [options]
 */
function runNpm(args, options) {
  try {
    return execFileSync(process.execPath, [npmExecPath(), ...args], {
      encoding: "utf8",
      stdio: options?.stdio ?? "pipe",
      cwd: options?.cwd ?? packageRoot,
      env: { ...process.env, HUSKY: "0", ...options?.env },
    });
  } catch (err) {
    const e = err;
    const stderr = e.stderr?.toString?.() ?? e.stderr ?? "";
    const stdout = e.stdout?.toString?.() ?? e.stdout ?? "";
    const message = stderr || stdout || e.message;
    const wrapped = new Error(message);
    wrapped.cause = err;
    throw wrapped;
  }
}

function listTemplateRelPaths() {
  const templatesDir = join(packageRoot, "templates");
  const out = [];
  for (const name of readdirSync(templatesDir)) {
    const full = join(templatesDir, name);
    if (statSync(full).isFile()) {
      out.push(`templates/${name}`);
    }
  }
  return out.sort();
}

/**
 * @param {string} installRoot
 * @param {string[]} args
 * @param {string} [cwd]
 */
function runNodriftBinStatus(installRoot, args, cwd = installRoot) {
  const prefix = resolve(installRoot);
  const result = spawnSync(
    process.execPath,
    [
      npmExecPath(),
      "exec",
      "--prefix",
      prefix,
      "--no-install",
      "nodrift",
      "--",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1", HUSKY: "0" },
    },
  );
  const binPath = join(prefix, "node_modules", ".bin", "nodrift");
  if (!existsSync(binPath) && !existsSync(`${binPath}.cmd`)) {
    return {
      status: 1,
      stdout: result.stdout,
      stderr: `nodrift bin shim missing under ${prefix}/node_modules/.bin`,
    };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function failStep(stepName, detail) {
  return { ok: false, message: `${stepName} failed: ${detail}` };
}

/**
 * @param {string} archivePath absolute path to .tgz
 * @param {string} expectedVersion from package.json
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function smokeTestInstalledPackage(archivePath, expectedVersion) {
  const installRoot = mkdtempSync(join(tmpdir(), "nodrift-install-"));
  let dryRunDir;
  let initDir;
  try {
    writeFileSync(
      join(installRoot, "package.json"),
      JSON.stringify({ name: "nodrift-smoke", private: true }),
    );
    try {
      runNpm(["install", archivePath, "--no-audit", "--no-fund", "--ignore-scripts"], {
        cwd: installRoot,
      });
    } catch (err) {
      return failStep("npm install", err.message);
    }

    const versionRun = runNodriftBinStatus(installRoot, ["--version"]);
    if (versionRun.status !== 0) {
      return failStep("nodrift --version", versionRun.stderr || versionRun.stdout);
    }
    const versionOut = versionRun.stdout.trim();
    if (versionOut !== expectedVersion) {
      return failStep(
        "nodrift --version",
        `expected ${expectedVersion}, got ${versionOut}`,
      );
    }

    const help = runNodriftBinStatus(installRoot, ["--help"]);
    if (help.status !== 0) {
      return failStep("nodrift --help", help.stderr || help.stdout);
    }

    dryRunDir = mkdtempSync(join(tmpdir(), "nodrift-dry-"));
    const dry = runNodriftBinStatus(installRoot, ["init", "--dry-run"], dryRunDir);
    if (dry.status !== 0) {
      return failStep("nodrift init --dry-run", dry.stderr || dry.stdout);
    }
    if (!dry.stdout.includes("would create")) {
      return failStep("nodrift init --dry-run", "output missing `would create` lines");
    }
    if (!dry.stdout.includes("docs/runbooks/breach-response.md")) {
      return failStep(
        "nodrift init --dry-run",
        "did not list docs/runbooks/breach-response.md",
      );
    }

    initDir = mkdtempSync(join(tmpdir(), "nodrift-init-"));
    const init = runNodriftBinStatus(installRoot, ["init"], initDir);
    if (init.status !== 0) {
      return failStep("nodrift init", init.stderr || init.stdout);
    }
    const check = runNodriftBinStatus(installRoot, ["check"], initDir);
    if (check.status !== 0) {
      return failStep("nodrift check", check.stderr || check.stdout);
    }

    return { ok: true };
  } finally {
    if (dryRunDir) {
      rmSync(dryRunDir, { recursive: true, force: true });
    }
    if (initDir) {
      rmSync(initDir, { recursive: true, force: true });
    }
    rmSync(installRoot, { recursive: true, force: true });
  }
}

async function runPackageCheck() {
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const packDir = mkdtempSync(join(tmpdir(), "nodrift-pack-"));
  let exitCode = 0;
  let archivePath;

  try {
    try {
      runNpm(["pack", "--pack-destination", packDir], { cwd: packageRoot });
    } catch (err) {
      console.error(`package:check: npm pack failed: ${err.message}`);
      exitCode = 1;
      return;
    }

    const archives = readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
    if (archives.length !== 1) {
      console.error(`package:check: expected one .tgz, got ${archives.join(", ")}`);
      exitCode = 1;
      return;
    }
    archivePath = join(packDir, archives[0]);
    const size = statSync(archivePath).size;
    if (size > MAX_PACKED_BYTES) {
      console.error(
        `package:check: tarball size ${size} exceeds budget ${MAX_PACKED_BYTES}`,
      );
      exitCode = 1;
      return;
    }

    let tarballPaths;
    try {
      tarballPaths = await listPackageTarballPaths(archivePath);
    } catch (err) {
      console.error(`package:check: read tarball failed: ${err.message}`);
      exitCode = 1;
      return;
    }

    const inspect = inspectTarballFileList(tarballPaths, listTemplateRelPaths());
    if (!inspect.ok) {
      console.error(`package:check: ${inspect.message}`);
      exitCode = 1;
      return;
    }

    const smoke = await smokeTestInstalledPackage(archivePath, pkg.version);
    if (!smoke.ok) {
      console.error(`package:check: ${smoke.message}`);
      exitCode = 1;
    }
  } catch (err) {
    console.error(`package:check: ${err.message}`);
    exitCode = 1;
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runPackageCheck().catch((err) => {
    console.error(`package:check: ${err.message}`);
    process.exitCode = 1;
  });
}
