import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Creates a new detached verification worktree; never touches an integration owner's tree.
const root = fileURLToPath(new URL("../..", import.meta.url));
const [mode, destination] = process.argv.slice(2);
assert.ok(["original", "approved"].includes(mode) && destination,
  "Usage: node tests/integration/preparePrincipalFence.mjs original|approved NEW_OWNED_PATH");
const target = resolve(destination);
assert.ok(!existsSync(target), "Destination must not already exist");
const base = "77f4d2a516ae7625abb6950f5224b75e2926c777";
const revision = mode === "original"
  ? "66e2f4427ded1d6f3afd72bf7f7c9b1b3bd06930"
  : "51900c1e8303ea17ffe211718f885b868c63a36c";
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" });
git(["worktree", "add", "--detach", target, revision]);
const paths = git(["diff", "--name-only", "-z", base, "--", "src"]).split("\0").filter(Boolean);
const temp = mkdtempSync(resolve(tmpdir(), "cross-tab-fence-"));
try {
  if (mode === "original") {
    for (const path of new Set([...paths,
      "src/addons/platform-api/session/embeddedSessionPolicy.ts",
      "src/addons/platform-api/api/http.ts", "src/utils/token.ts",
    ])) cpSync(resolve(root, path), resolve(target, path));
  } else {
    for (const path of paths) {
      for (const [file, sha] of [["base", base], ["approved", revision]]) {
        writeFileSync(resolve(temp, file), git(["show", `${sha}:${path}`]));
      }
      const merged = spawnSync("git", ["merge-file", "-p", resolve(temp, "approved"),
        resolve(temp, "base"), resolve(root, path)], { encoding: "utf8" });
      assert.equal(merged.status, 0, `Three-way source conflict: ${path}`);
      writeFileSync(resolve(target, path), merged.stdout);
    }
  }
  symlinkSync(resolve(root, "node_modules"), resolve(target, "node_modules"));
  console.log(JSON.stringify({ mode, revision, target, sourcePaths: paths.length }));
} finally {
  rmSync(temp, { recursive: true });
}
