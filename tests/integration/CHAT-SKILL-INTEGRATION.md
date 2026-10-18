# Chat Skill Integration

This candidate combines current master `9b9c0935` with the existing approved
PR16 head `51900c1e`. It does not replay or replace PR16's earlier composition.
Only integration tests and this receipt guide are new relative to that
automatic merge. No product policy, route allowlist or release tree is changed.

## Local Acceptance

Run from an owned checkout with dependencies installed:

```sh
node --test tests/skillPicker.test.ts tests/sessionBindings.test.ts tests/toolPick.test.ts tests/taskSkillEntry.test.ts tests/renewalBindings.test.ts tests/crossTabRevalidation.test.ts tests/shellPrincipal.test.ts tests/conversationSnapshotLoading.test.ts
FENCE_ROOT="$PWD" node --test tests/integration/principalFence.test.ts
CHAT_SKILL_MUTATION_OWNED_TREE="$PWD" node tests/mutations/chatSkillIntegration.mjs
npm run test:unit
npm run build
```

Do not run other checks while the mutation command temporarily edits sources.
Its ten mutants must each fail behavioral assertions; syntax, import and timeout
failures do not count. Sources restore in `finally`, with passing controls before
and after. Default evidence goes two levels above the checkout; `RESULT_DIR`
can select another owned output directory.

The component gate compiles actual Home, Conversation and selection SFCs with
their real setup/template, Pinia store, HTTP client and authentication wrapper.
A Vue tree renderer replaces the browser DOM. Only the transport and unrelated
model/backend/stream controls are synthetic. This is neither visual browser
acceptance nor proof that a real imported tool ran.

Covered: desktop/mobile create projection, covered-tool exclusion, retained
manual tools, empty-create omission, explicit session clears, discard without
writes, busy drafts, old reads/writes, changed principals, unknown-write
barriers and revision-based recovery.

Ordinary proven-principal renewal retains mounted drafts and pending writes.
Pending cross-tab revalidation still destroys chat views: only the existing
audited editor routes opt into suspension. Chat remount must resynchronize;
an equal revision cannot recover an unknown write. The corrected principal
fence test intentionally distinguishes those two policies.

## Successor Release Gates

- Do not merge or deploy this branch as part of the local gate.
- Preserve Shell `543ac6ef` and the active fixed-SHA DEV release owner's slot.
- Core's bindings revision/sync contract is already merged; the import release
  owner separately owns Core `de3d9690` and its runtime/source-compatibility gates.
- Require exact target-instance Core identity and the existing old-writer
  exclusion/drain evidence before enabling this Web candidate.
- Require successful fixed-pair natural DEV renewal acceptance before TEST.
- Publish the final tested Web SHA, not PR16's old SHA, as the TEST input.
- Real import/catalog availability, persisted next-turn executor projection,
  actual tool-call/result and owned-object cleanup remain release-owner gates.
  Local synthetic payload assertions cannot satisfy them.
