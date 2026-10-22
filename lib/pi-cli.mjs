import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PACKAGE_NAME = "@earendil-works/pi-coding-agent";

// Pi's bin is a JS file we run with process.execPath. Resolving the package
// entry and walking up to its package.json is how we find it without knowing
// the dependency's internal layout. import.meta.resolve, not createRequire:
// the package's exports map has no "require" condition.
export function resolvePiCli() {
  const resolved = fileURLToPath(import.meta.resolve(PACKAGE_NAME));

  let dir = path.dirname(resolved);
  for (;;) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(manifest, "utf8"));
      } catch {
        pkg = null;
      }
      if (pkg?.name === PACKAGE_NAME) {
        const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pi;
        if (!bin) throw new Error(`${PACKAGE_NAME} has no "pi" bin entry`);
        const cli = path.resolve(dir, bin);
        if (!existsSync(cli)) throw new Error(`${PACKAGE_NAME} bin is missing on disk: ${cli}`);
        return cli;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find ${PACKAGE_NAME}/package.json above ${resolved}`);
    }
    dir = parent;
  }
}
