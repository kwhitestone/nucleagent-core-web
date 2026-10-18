# Session Renewal Regression

Integration/browser suite. Synthetic data only; attaches to an existing CDP
browser and creates an owned isolated context. Does not launch Chrome or
inspect other page content. Non-fixture requests are blocked before sending.
The actual authenticatedView, embeddedSession, shell bridge, AgentList,
AdminAgents, owner wizard and administrator drawer run without stubs.
Only runtime configuration loading and the axios transport use synthetic data.

The original PR17 checkpoint is RED on the old consumer. This candidate imports
the real shell auth producer from sibling `../shell` (override with `SHELL_ROOT`)
and adds its verified principal binding. Do not make this green by comparing
token claims, ignoring session events, removing security keys, or accepting
permission equality alone.

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
Original renewal/security cases issue zero business writes. One additional
owner busy test explicitly permits a synthetic adapter-only PATCH, holds it
across renewal and discards its late result. It never reaches a server. Synthetic
PNG responses are fulfilled in CDP; owner picked images are memory-only Files.

Expected candidate result: four retention passes, 18 original security checks
and 25 extended checks, including malformed/absent principal, cross-origin,
source/protocol/instance/app/stale messages, grant changes and busy/error states.
Image decode, retained node and boundary-removal assertions cover both consumers.
The runner exits nonzero when retention fails. Safety-negative assertion
failure or fixture failure exits early, and is not a valid full red result.
Read the JSON receipt to distinguish these outcomes and verify browser cleanup.
The test belongs outside the fast Node unit glob; production build and unit
results do not imply that this browser suite passes.

Mutation and fence integration commands are documented in
`docs/shell-principal.md`. Live DEV natural-renewal verification with freshly
confirmed resource ownership remains a separate zero-write release gate.
This candidate must be independently reviewed; no merge or release is permitted
by the implementation task.
