import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
assert.equal(process.env.RENEWAL_MUTATION_OWNED_TREE, root.replace(/\/$/, ""),
  "Run only in an explicitly owned disposable worktree");
const out = resolve(process.env.RESULT_DIR ?? `${root}/../../evidence/renewal-mutations`);
mkdirSync(out, { recursive: true });
const session = "src/addons/platform-api/session/embeddedSession.ts";
const bindings = "src/addons/conversation/composables/useSessionBindings.ts";
const selection = "src/addons/conversation/composables/useBindingSelection.ts";
const api = "src/addons/conversation/api/sessionBindings.ts";
const view = "src/addons/conversation/task-conversation/vue/TaskConversation.vue";
const mutants = [
  ["renewal-clears-bindings", bindings, "if (authenticated && !isBusinessBoundaryChange(event)) return;", "if (false) return;"],
  ["renewal-clears-selection", selection,
    'if ((event as CustomEvent).detail?.authenticated === true && !isBusinessBoundaryChange(event)) {',
    "if (false) {"],
  ["put-credential-scoped", api,
    'selection, { signal, sessionBoundary: "business" }', "selection, { signal }"],
  ["sync-credential-scoped", api,
    '{}, { signal, sessionBoundary: "business" }', "{}, { signal }"],
  ["http-ignores-business-scope", "src/addons/platform-api/api/http.ts",
    "sessionRequestSignal(config.sessionBoundary)", "sessionRequestSignal()"],
  ["renewal-retires-business", session,
    "if (businessBoundaryChanged) retireBusinessRequests();", "retireBusinessRequests();"],
  ["boundary-keeps-business-http", session, "businessScope.abort();", "void businessScope;"],
  ["permission-change-retained", session,
    "nextPrincipal !== principalId || authorizationChanged", "nextPrincipal !== principalId || false"],
  ["unknown-principal-retained", session, "if (!nextPrincipal) token = null;", "if (false) token = null;"],
  ["write-not-fenced", bindings, "bindingWriteStarted(scope, saved.value);", "void scope;"],
  ["late-put-restores-state", bindings,
    'revision: saved.value.revision }, request.signal);\n      if (ticket.isCurrent()) restore(data);',
    'revision: saved.value.revision }, request.signal);\n      restore(data);'],
  ["ready-stream-reinitialized", view,
    "if (authenticated && !isBusinessBoundaryChange(event) && controller.authoritativeReady.value) return;",
    "if (false) return;"],
  ["pending-history-never-retried", view,
    "if (authenticated && !isBusinessBoundaryChange(event) && controller.authoritativeReady.value) return;",
    "if (authenticated && !isBusinessBoundaryChange(event)) return;"],
];
const originals = new Map(mutants.map(([, file]) => [file, readFileSync(resolve(root, file), "utf8")]));
const run = () => spawnSync(process.execPath, ["--test", "--test-timeout=10000",
  "tests/renewalBindings.test.ts", "tests/conversationSnapshotLoading.test.ts", "tests/shellPrincipal.test.ts"],
{ cwd: root, encoding: "utf8", timeout: 30000 });
const control = run();
writeFileSync(resolve(out, "control.log"), control.stdout + control.stderr);
assert.equal(control.status, 0, "Unmutated tests must pass");
const results = [];
try {
  for (const [name, file, from, to] of mutants) {
    const source = originals.get(file);
    assert.equal(source.split(from).length, 2, `Unique mutation site: ${name}`);
    writeFileSync(resolve(root, file), source.replace(from, to));
    const result = run();
    writeFileSync(resolve(root, file), source);
    const text = result.stdout + result.stderr;
    const killed = result.status !== 0 && /AssertionError/.test(text) &&
      !/SyntaxError|TransformError|ERR_MODULE_NOT_FOUND/.test(text);
    results.push({ name, killed, exitCode: result.status, assertionFailure: killed });
    writeFileSync(resolve(out, `${name}.log`), text);
    console.log(`${name}: ${killed ? "ASSERTION_KILLED" : "INVALID_OR_SURVIVED"}`);
  }
} finally {
  for (const [file, source] of originals) writeFileSync(resolve(root, file), source);
  writeFileSync(resolve(out, "results.json"), JSON.stringify(results, null, 2) + "\n");
}
// The PUT gate is defense in depth: bounded cancellation can still reject its late response.
const required = results.filter(result => result.name !== "late-put-restores-state");
assert.ok(required.every(result => result.killed), "Every nonredundant mutant must fail an assertion");
assert.ok(results.filter(result => result.killed).length >= 8, "Only assertion-killed mutants count");
assert.equal(run().status, 0, "Restored source must pass");
