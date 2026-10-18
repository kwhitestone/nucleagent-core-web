# Session Renewal Red Reproduction

Integration/browser suite. Synthetic data only; attaches to an existing CDP
browser and creates an owned isolated context. Does not launch Chrome or
inspect other page content. Non-fixture requests are blocked before sending.
The actual authenticatedView, embeddedSession, shell bridge, AgentList,
AdminAgents, owner wizard and administrator drawer run without stubs.
Only runtime configuration loading and the axios transport use synthetic data.

This is a **red test checkpoint**, not a production fix. Current trusted shell
auth messages do not carry a principal identity. The scenario authority knows
it is renewing one synthetic account; the child cannot prove that from the
wire fields. Do not make this green by comparing token claims, ignoring
session events, removing security keys, or accepting permission equality alone.

From the repository root, start the fixture once:

```sh
node tests/browser/session-renewal/server.mjs
```

In another terminal, with the authorized existing browser on CDP 9229:

```sh
flock -w 5 /tmp/cdp-9229.lock node tests/browser/session-renewal/red.mjs
```

`PORT`, `FIXTURE_URL`, `CDP_ENDPOINT` and `RESULT_PATH` may select a separate
worker port/browser and result file. Default fixture port is 5198 with
strictPort enabled, never silently reusing another server.

The suite uses real native mouse/keyboard input at 1280 and 390 pixels,
checks selected text, focus and DOM-node identity, rejects stale versions,
and exercises current-credential invalidation plus rejected-version replay.
Separate real-consumer cases cover logout, equal-grant account switch with a
new server denial, permission revocation, and held reads released after logout.
The transport deliberately does not honor abort: late delivery still occurs,
so response rejection cannot be inferred merely from AbortController state.
All business writes are counted and rejected.

Expected current result: four retention failures, zero business writes.
The runner exits nonzero when retention fails. Safety-negative assertion
failure or fixture failure exits early, and is not a valid full red result.
Read the JSON receipt to distinguish these outcomes and verify browser cleanup.
The test belongs outside the fast Node unit glob; production build and unit
results do not imply that this browser suite passes.

Missing acceptance: approved trusted principal producer/binding, green
candidate, at least 12 effective mutants, busy/error renewal cases, and live
DEV natural-renewal verification with freshly confirmed resource ownership.
No merge or release is permitted by this test checkpoint.
