import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const README_TEMPLATE = "README.project.md";
const LICENSE_TEMPLATE = "LICENSE.project";

const positional = process.argv.slice(2);
const slug = positional[0];
const displayName = positional[1];
const purposeArg = positional[2];
const ownerArg = positional[3];

if (!slug || !displayName) {
  console.error(
    'Usage: npm run init-project -- <slug> "<display name>" ["<one-line purpose>"] ["<owner>"]',
  );
  process.exit(1);
}

if (positional.length > 4) {
  console.error("Too many arguments.");
  process.exit(1);
}

if (!statSync(README_TEMPLATE, { throwIfNoEntry: false })?.isFile()) {
  console.error(
    `Missing ${README_TEMPLATE} (already initialized, or not a Launchpad checkout).`,
  );
  process.exit(1);
}

if (!statSync(LICENSE_TEMPLATE, { throwIfNoEntry: false })?.isFile()) {
  console.error(
    `Missing ${LICENSE_TEMPLATE} (already initialized, or not a Launchpad checkout).`,
  );
  process.exit(1);
}

const purpose =
  purposeArg ??
  "Short description of what this project does — edit README and docs/architecture/overview.md.";
const owner = ownerArg ?? "Didi Build";
const year = String(new Date().getUTCFullYear());

const replacements = new Map([
  ["{{PROJECT_SLUG}}", slug],
  ["{{PROJECT_NAME}}", displayName],
  ["{{PROJECT_PURPOSE}}", purpose],
  ["{{PROJECT_YEAR}}", year],
  ["{{PROJECT_OWNER}}", owner],
]);

function listFiles(path) {
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    return [path];
  }
  const out = [];
  for (const name of readdirSync(path)) {
    if (name.startsWith(".")) continue;
    const child = join(path, name);
    const st = statSync(child);
    if (st.isDirectory()) out.push(...listFiles(child));
    else if (st.isFile()) out.push(child);
  }
  return out;
}

const textFiles = [
  README_TEMPLATE,
  LICENSE_TEMPLATE,
  "AGENTS.md",
  "package.json",
  ...listFiles("docs"),
  ...listFiles(".github"),
  ".cursor/rules/launchpad.mdc",
  "CLAUDE.md",
];

for (const file of textFiles) {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
  let text = readFileSync(file, "utf8");
  for (const [from, to] of replacements) {
    text = text.replaceAll(from, to);
  }
  writeFileSync(file, text);
}

const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.name = slug;
pkg.description = purpose;
pkg.license = "UNLICENSED";
delete pkg.launchpadTemplate;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const exampleFiles = ["src/greet.ts", "test/greet.test.ts"];
for (const file of exampleFiles) {
  if (statSync(file, { throwIfNoEntry: false })?.isFile()) {
    unlinkSync(file);
  }
}
mkdirSync("src", { recursive: true });
writeFileSync("src/.gitkeep", "");

renameSync(README_TEMPLATE, "README.md");
renameSync(LICENSE_TEMPLATE, "LICENSE");

console.log(`Initialized project "${displayName}" (${slug}).`);
console.log("Next: npm install && npm run check");
