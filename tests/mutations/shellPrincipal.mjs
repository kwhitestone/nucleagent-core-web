import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const session = "src/addons/platform-api/session/embeddedSession.ts";
const policy = "src/addons/platform-api/session/embeddedSessionPolicy.ts";
const grants = "src/addons/platform-api/session/embeddedAuthorization.ts";
const mutants = [
  ["unknown-retains-token", session, "if (!nextPrincipal) token = null;", "if (false) token = null;"],
  ["principal-ignored", session, "nextPrincipal !== principalId || authorizationChanged", "false || authorizationChanged"],
  ["grants-ignored", session, "nextPrincipal !== principalId || authorizationChanged", "nextPrincipal !== principalId || false"],
  ["renewal-remounts", session, "const businessBoundaryChanged = !nextPrincipal", "const businessBoundaryChanged = true || !nextPrincipal"],
  ["requests-not-aborted", session, "requestScope.abort();", "void requestScope;"],
  ["request-generation-stuck", session, "requestGeneration++;", "requestGeneration += 0;"],
  ["boundary-generation-stuck", session, "if (businessBoundaryChanged) retireBusinessRequests();", "if (false) retireBusinessRequests();"],
  ["unknown-event-nondestructive", session, "emitSessionChange(Boolean(token), businessBoundaryChanged);", "emitSessionChange(Boolean(token), false);"],
  ["401-retains-token", session, 'if (reason === "rejected") {\n    clearAccessToken();', 'if (reason === "rejected") {\n    void 0;'],
  ["stale-version-accepted", policy, "if (incomingVersion < currentVersion) return false;", "if (false) return false;"],
  ["rejected-version-replay", policy, "if (hasToken && incomingVersion === rejectedVersion) return false;", "if (false) return false;"],
  ["zero-principal", session, "/^[1-9][0-9]{0,15}$/", "/^[0-9][0-9]{0,15}$/"],
  ["unsafe-integer-principal", session, "Number.isSafeInteger(Number(id)) ? id : null", "true ? id : null"],
  ["permission-order-sensitive", grants, ".sort();", ";"],
  ["permission-whitespace-sensitive", grants, "value.trim()))", "value))"],
];
const original = new Map(mutants.map(([, path]) => [path, readFileSync(`${root}/${path}`, "utf8")]));
const run = () => spawnSync(process.execPath, ["--test", "tests/shellPrincipal.test.ts"],
  { cwd: root, encoding: "utf8", timeout: 30000 });
assert.equal(run().status, 0, "Unmutated principal tests must pass");
const results = [];
try {
  for (const [name, path, from, to] of mutants) {
    const source = original.get(path);
    assert.equal(source.split(from).length, 2, `Unique mutation site: ${name}`);
    writeFileSync(`${root}/${path}`, source.replace(from, to));
    const result = run();
    writeFileSync(`${root}/${path}`, source);
    const killed = result.status !== 0 && /AssertionError/.test(result.stdout + result.stderr);
    results.push({ name, killed, assertionFailure: killed });
    console.log(`${name}: ${killed ? "KILLED" : "INVALID/SURVIVED"}`);
  }
} finally {
  for (const [path, source] of original) writeFileSync(`${root}/${path}`, source);
}
writeFileSync(process.env.RESULT_PATH ?? `${root}/../principal-mutations.json`, JSON.stringify(results, null, 2) + "\n");
assert.ok(results.every(result => result.killed), "Every mutant must be killed by assertions, not infrastructure failures");
assert.equal(run().status, 0, "Restored source must pass");
