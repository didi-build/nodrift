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

/**
 * Maps pack/inspect/smoke outcomes to a process exit code (0 pass, 1 fail).
 *
 * @param {{
 *   packedSize: number;
 *   maxPackedBytes: number;
 *   inspect: { ok: boolean; message?: string };
 *   smokeOk?: boolean;
 * }} input
 * @returns {0 | 1}
 */
export function packageCheckExitCode(input) {
  const { packedSize, maxPackedBytes, inspect, smokeOk = true } = input;
  if (packedSize > maxPackedBytes) {
    return 1;
  }
  if (!inspect.ok) {
    return 1;
  }
  if (!smokeOk) {
    return 1;
  }
  return 0;
}

function resolveMaxPackedBytes(overrides) {
  if (overrides?.maxPackedBytes !== undefined) {
    return overrides.maxPackedBytes;
  }
  const fromEnv = process.env.NODRIFT_PACKAGE_CHECK_MAX_BYTES;
  if (fromEnv !== undefined && fromEnv !== "") {
    return Number(fromEnv);
  }
  return MAX_PACKED_BYTES;
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

/**
 * @param {{ maxPackedBytes?: number; skipSmoke?: boolean; ignorePackScripts?: boolean }} [overrides]
 *   ignorePackScripts skips prepack (vitest only; dist comes from globalSetup).
 * @returns {Promise<0 | 1>}
 */
export async function runPackageCheck(overrides = {}) {
  const maxPackedBytes = resolveMaxPackedBytes(overrides);
  const skipSmoke = overrides.skipSmoke === true;
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const packDir = mkdtempSync(join(tmpdir(), "nodrift-pack-"));
  const packArgs = ["pack", "--pack-destination", packDir];
  if (
    overrides.ignorePackScripts === true ||
    process.env.NODRIFT_PACKAGE_CHECK_IGNORE_SCRIPTS === "1"
  ) {
    packArgs.push("--ignore-scripts");
  }

  try {
    try {
      runNpm(packArgs, { cwd: packageRoot });
    } catch (err) {
      console.error(`package:check: npm pack failed: ${err.message}`);
      return 1;
    }

    const archives = readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
    if (archives.length !== 1) {
      console.error(`package:check: expected one .tgz, got ${archives.join(", ")}`);
      return 1;
    }
    const archivePath = join(packDir, archives[0]);
    const packedSize = statSync(archivePath).size;

    let tarballPaths;
    try {
      tarballPaths = await listPackageTarballPaths(archivePath);
    } catch (err) {
      console.error(`package:check: read tarball failed: ${err.message}`);
      return 1;
    }

    const inspect = inspectTarballFileList(tarballPaths, listTemplateRelPaths());
    let smokeResult = { ok: true };
    if (!skipSmoke) {
      smokeResult = await smokeTestInstalledPackage(archivePath, pkg.version);
    }

    const exitCode = packageCheckExitCode({
      packedSize,
      maxPackedBytes,
      inspect,
      smokeOk: smokeResult.ok,
    });
    if (exitCode !== 0) {
      if (packedSize > maxPackedBytes) {
        console.error(
          `package:check: tarball size ${packedSize} exceeds budget ${maxPackedBytes}`,
        );
      } else if (!inspect.ok) {
        console.error(`package:check: ${inspect.message}`);
      } else if (!smokeResult.ok) {
        console.error(`package:check: ${smokeResult.message}`);
      }
    }
    return exitCode;
  } catch (err) {
    console.error(`package:check: ${err.message}`);
    return 1;
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runPackageCheck()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error(`package:check: ${err.message}`);
      process.exit(1);
    });
}
