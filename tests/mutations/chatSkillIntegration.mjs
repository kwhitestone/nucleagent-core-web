import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
assert.equal(process.env.CHAT_SKILL_MUTATION_OWNED_TREE, root, "Explicit owned worktree required");
const out = resolve(process.env.RESULT_DIR ?? `${root}/../../evidence/chat-skill-mutations`);
mkdirSync(out, { recursive: true });
const selection = "src/addons/conversation/composables/useBindingSelection.ts";
const bindings = "src/addons/conversation/composables/useSessionBindings.ts";
const mutants = [
  ["home-drops-bindings", "src/addons/conversation/views/Home.vue", "...payload, ...createBindings.value,", "...payload,"],
  ["covered-tool-not-projected", "src/addons/conversation/api/toolCatalog.ts",
    "toolIds.filter((id) => !coveredBySkills(tools.find((t) => t.id === id), skillIds))", "[...toolIds]"],
  ["create-clear-is-explicit", selection, "skillIds.value.length ? [...skillIds.value] : undefined", "[...skillIds.value]"],
  ["save-keeps-covered-tool", bindings, "toolIds: [...pickedTools.value]", "toolIds: [...toolIds.value]"],
  ["save-drops-skills", bindings, "skillIds: [...skillIds.value], toolIds:", "skillIds: [], toolIds:"],
  ["busy-save-guard-removed", bindings, "uncertain.value || disabled() || saving.value", "uncertain.value || saving.value"],
  ["discard-does-not-restore", bindings, "if (saved.value && !saving.value && !loading.value) restore(saved.value);", "void saved;"],
  ["unknown-equal-revision-accepted", "src/addons/conversation/composables/bindingWriteCoordinator.ts",
    "(previous.unknown && data.revision === previous.revision)", "false"],
  ["pending-send-unblocked", "src/addons/conversation/views/Conversation.vue", "send: !bindingsPending &&", "send:"],
  ["save-clear-keeps-tools", bindings, "toolIds: [...pickedTools.value]", "toolIds: pickedTools.value.length ? [...pickedTools.value] : [...saved.value.toolIds]"],
];
const originals = new Map(mutants.map(([, file]) => [file, readFileSync(resolve(root, file), "utf8")]));
const run = () => spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--test-timeout=15000",
  "tests/skillPicker.test.ts"], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
const record = (name, result) => {
  const text = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(resolve(out, `${name}.log`), text);
  return text;
};
const before = run();
record("control-before", before);
assert.equal(before.status, 0, "Unmutated mounted-component control must pass");
const results = [];
try {
  for (const [name, file, from, to] of mutants) {
    const source = originals.get(file);
    assert.equal(source.split(from).length, 2, `Unique mutation site: ${name}`);
    writeFileSync(resolve(root, file), source.replace(from, to));
    const result = run();
    writeFileSync(resolve(root, file), source);
    const text = record(name, result);
    const killed = result.status === 1 && /AssertionError/.test(text) &&
      !/SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|testTimeoutFailure/.test(text);
    results.push({ name, file, killed, exitCode: result.status,
      assertions: [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]) });
    console.log(`${name}: ${killed ? "ASSERTION_KILLED" : "INVALID_OR_SURVIVED"}`);
  }
} finally {
  for (const [file, source] of originals) writeFileSync(resolve(root, file), source);
  writeFileSync(resolve(out, "results.json"), JSON.stringify(results, null, 2) + "\n");
}
const after = run();
record("control-after", after);
assert.equal(after.status, 0, "Restored source must pass");
assert.ok(results.every(result => result.killed), "Every listed mutation must fail a behavioral assertion");
assert.ok(results.length >= 8);
