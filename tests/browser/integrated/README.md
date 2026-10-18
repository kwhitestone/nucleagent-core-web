# Local Combined Acceptance

Tests and synthetic fixtures only. No product state machine is copied.
This suite is not a release gate and does not contact a deployed platform.

## Inputs

`inputs.json` pins the reviewed main branches and candidates. Apply the Core
`editor_integrated_test.go` test commit to the selected Core candidate, and this
directory's commit to the selected combined Core-Web candidate. Keep the old
Shell control at `a0a0ae1816b9d52c4c8c86f566ccb3a5149b7384`; choose the repaired
Shell through `SHELL_ROOT`. Do not cherry-pick the combined product history merely
to obtain these test files.

Prerequisites: Node 24, installed Core-Web lockfile dependencies, Go as declared
by Core, `flock`, and an authorized existing CDP browser reachable on loopback.
Core's relative replacements require sibling prism-fusion, nucleagent-auth,
nucleagent-shared, nucleagent-storage and nucleagent-storage-ndcs sources pinned
by its workspace.lock. No dependency upgrades are required.

## Run

From the Core-Web test worktree:

```bash
CORE_WEB_ROOT="$PWD" \
CORE_ROOT="/absolute/path/to/core" \
SHELL_ROOT="/absolute/path/to/repaired-shell" \
RED_SHELL_ROOT="/absolute/path/to/old-shell" \
CDP_ORIGIN="http://127.0.0.1:9229" \
PORT_BASE=5531 \
OUTPUT_DIR="/absolute/path/to/new-evidence-directory" \
node tests/browser/integrated/run-local.mjs
```

Use a fresh output directory and three free consecutive ports. The runner starts
only its own Gin/Huma fixture and Vite servers and stops them on completion.
Both CDP9229 lock names are held for each browser run. It creates a background
isolated context; it never activates, navigates, reads content from or closes
existing tabs. No real credentials are loaded or transferred. Browser network
requests are limited to the two fixture origins and a fulfilled synthetic image.
Do not supply real content or authentication to these fixtures.

Backend only, without browser:

```bash
cd /absolute/path/to/core/app/src/server
GIN_MODE=release go test -p 2 ./addons/conversation/router \
  -run '^TestIntegratedEditorSSEAndBindings$' -count=1 -timeout=90s -v
```

## Verdict

- Backend must pass owner isolation, add/clear, a held concurrent stale PUT
  rejected after `/bindings/sync`, next-turn RuntimeTools, three live SSE events
  on one connection, and family-revocation EOF.
- Old Shell must exit 1 specifically at `TOKEN_CAPTURE`. A server error, timeout
  or missing browser is not accepted as a red control.
- Repaired Shell must pass all 13 scenarios with no runtime/assertion errors:
  desktop/mobile, owner/admin, both principal directions, renewal draft/DOM/
  focus/selection, shared sidebar, avatar boundary, recovery and late reads.
- Chat must pass all four independently recorded scenarios: both viewports with
  Home draft/skill preservation, actual binding add/clear, next-turn projection,
  in-flight save/renewal and stream continuity; held saves across logout/account
  switch must not restore the retired editor. A failed checkpoint remains red;
  later scenarios still execute. The disabled-save retention assertion is strict.
- Every owned context must close, every pre-existing page ID must remain present,
  and no unapproved external request may be attempted.

Overall exit 0 requires `summary.json.safety=PASS_WITH_EXPECTED_OLD_RED`.
Any candidate failure returns nonzero and `safety=FAIL`, even if other cases pass.
`releaseAcceptance` always remains `NOT_RUN`. Inputs include actual git SHAs and
test-source SHA256 hashes; per-suite JSON and logs retain executed results.
The expected old assertion failure is never converted into a weakened assertion.

## Boundaries

Authentication and catalogs are synthetic. HTTP binding handlers, revisions,
SSE broker/projection, RuntimeTools, Shell store/lifecycle/API/producer, Core
bridge, owner/admin/Home/Conversation/TaskConversation components are real.
Transport redirects reserved `.test` SSE to the local service without weakening
the production runtime-config parser.

The database is isolated in-memory SQLite using existing model schemas, not
MySQL or a multi-instance deployment. RuntimeTools is invoked at a simulated
executing boundary, not by an actual executor/model turn. Browser stream probes
are persisted synthetic system-error messages, so the real UI remains editable:
streaming answers disable edits and settled answers intentionally cause snapshot
reconciliation. Neither is a valid probe for idle-state edit continuity.
Held PUT transport deliberately survives cancellation; server commit is never
inferred from abort. Owner avatar selection uses an in-memory synthetic File,
not a native file-dialog or approved storage upload test. Admin slot has no file
input. No storage endpoint or new permission/table is introduced.

Rendered assertions use native pointer/text input and DOM checks in owned
frames. They are not screenshot-based visual certification, natural real-token
renewal, deployed auth-family validation or production release acceptance.
No merge, release, existing-session modification or shared browser restart is
performed. Stage DONE means test delivery only.
