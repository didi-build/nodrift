import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function packageRootFromModule(moduleUrl: string): string {
  const here = dirname(fileURLToPath(moduleUrl));
  return join(here, "..", "..");
}

export function readPackageTemplate(moduleUrl: string, relativePath: string): string {
  const path = join(packageRootFromModule(moduleUrl), "templates", relativePath);
  const text = readFileSync(path, "utf8");
  return text.replace(/\r\n/g, "\n");
}

export function kitVersionFromModule(moduleUrl: string): string {
  const packagePath = join(packageRootFromModule(moduleUrl), "package.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string };
  return pkg.version;
}
