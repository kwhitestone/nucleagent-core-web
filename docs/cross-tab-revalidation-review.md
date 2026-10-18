# Cross-Tab Revalidation: Narrow Review Package

Status: REQUESTED, NOT independently reviewed or approved. No release authority.
Namespace: gca6bf37f. Related merged shell PR24 / core-web PR18; approved chat
integration remains in its separate PR16 and owned tree.

## Proposed Trust Boundary

See `cross-tab-trust.drawio`. The shell still owns credentials and its auth
cookie lock. Native storage is a notification, not identity evidence.
`syncSessionFromStorage` captures token/version, withdraws user/verified ID/
permissions, and calls the existing explicit-token user-info API. Both memory
and current storage must still match before accepting the server identity.
Original F1 snapshot assertions are unchanged. No subject inferred from a JWT,
display name, old principal, or equal permission list.

The existing framework channel still checks source window, configured origin,
app ID, instance ID and message type. No wildcard origins or new sender trust.
The optional `revalidation.previousVersion` is a **retention hint, not auth**.
It is accepted only from the already-verified parent, from this document's
verified prior version, with a newer version, no token/principal/grants, and
no existing suspension. Duplicates must match the original transition and do
not extend its deadline. Malformed or unknown auth events destroy state.

Pending clears the public token, principal and grants, aborts old request
scope, prevents Axios writes/sends from reaching the adapter, clears shared
history/sidebar projection, and emits unauthenticated/non-business-boundary.
Only `/agents` and the outer `/admin/agents` layout opt into retaining their
existing Vue tree. Other routes retain destructive fail-closed behavior.
The opted-in DOM is teleported to an unconnected, private DOM element, not
covered by a cosmetic overlay. It cannot be queried in the document, focused,
clicked or submitted by the user. Retained state is not serialized.

Identical final version, valid principal ID and canonical effective grants
resume the original editor and restore focus/selection after render. Requests
retired on entry remain retired. Saves are not replayed or reported successful.
Native modal dialogs are captured only inside the opted-in component root;
on authorized reattachment their modal top-layer state is restored before focus.
No dialog from another view is selected, and no close/save action is dispatched.
Any different account (even equal grants), changed grants, logout, failed proof,
401 or timeout destroys the retained tree. Navigating away while pending also
discards it. No new account can inherit the retained editor.

Shell proof deadline: 10 seconds, with caller settlement and transport abort.
Consumer watchdog: 12 seconds if the shell disappears or final message is lost.
Late success cannot reuse an expired proof; consumer watchdog also rejects
same-version credential replay. The visible status explains pause/recovery.
Reload the shell or sign in again to recover access; discarded drafts do not
return. No automatic proof retry restores a discarded editor.

## Compatibility

| Producer | Consumer | Result |
| --- | --- | --- |
| Released shell d9b615dc | Released web77f4d2a5 | Safe destructive unknown boundary; known cross-tab draft loss |
| New shell | Released web77f4d2a5 | Pending has null token/principal and empty grants; old consumer destroys editor |
| Released shell | New web | Missing explicit pending hint stays destructive; cannot retain unknown identity |
| New shell | New web | Bounded detached editor; exact same proof resumes; all other outcomes destroy |
| New shell | Old/unknown remote app | Null credential during pending; app must retain its existing auth gate; no draft guarantee |
| Wrong source/origin/instance | Either web | Existing channel rejects before session parser |
| New web + approved PR16 | Owned three-way verification only | Same-tab approved write fence and cross-tab unknown-write fence checked separately |

The original shell `isCurrentCredential` unseen-storage mismatch remains
destructive: if an old shell auth response detects a new storage credential
**before** the native storage handler runs, its old proof is invalidated
immediately and the later storage event cannot retain that editor. This is a
deliberately unchanged fail-closed F1 path, not a promise of draft preservation
for every possible pre-event auth-response ordering. Review this limitation
before declaring the live blocker resolved.

## Independent Reviewer Checklist

1. Reproduce baseline red through peer store -> native storage -> held
   user-info -> real cross-origin frame -> mounted owner/admin, not a surrogate
   state machine. Inspect desktop/390 native focus and node identity evidence.
2. Check detached DOM lifecycle, route changes, nested Teleports/global
   dialogs, browser background throttling and any newly added editor child.
   Only audited routes may opt in; do not extend the allowlist casually.
3. Confirm current-token server proof binding and all original F1 mutants.
   Attack stale success/error, storage ABA, same claims/different account,
   version jumps, duplicate and malformed pending messages.
4. Confirm request abort and blocked writes before adapter, including a
   synthetic busy save with unknown outcome. Old HTTP responses must not
   restore state; abort does not prove the server did not write.
5. Review separate original PR16 and approved PR16 fence runs. Three-way
   composition preserves the approved business-request scope. Non-opt-in chat
   routes unmount while pending; their caller abort and coordinator barrier
   remain necessary. Do not extend retained routes to chat without separately
   reviewing business-scope cancellation and SSE.
6. Check both deployed versions and all active frame consumers. A stale tab or
   stale CDN bundle can stay safe but still lose drafts. No local green or
   this document constitutes approval.

## Reproduction

Use sibling checkouts named `shell`, `core-web`, `prism-fusion` under an owned
workspace. Framework baseline is `894bd823028076d6b43e4edd08a3823e8820149f`.
The task report records exact immutable candidate heads and evidence hashes.
Dependencies must already be installed from the repository lockfiles.

From workspace root, with the task-owned CDP9229 browser already available:

```sh
flock -n /tmp/cdp-9229.lock flock -n /home/wsl/nucleagent-work/locks/cdp-9229.lock \
  env FULL=1 node core-web/tests/browser/session-renewal/cross-tab-run.mjs
```

The runner uses ports5301/5303/5304, creates only an isolated context, blocks
external network, and closes only that context. Original tabs are checked
after disposal. It stops its own servers on success or failure. Do not run
mutation scripts concurrently with browser/build tests on the same worktree.
Only synthetic data and synthetic adapter writes are used; no live model,
definition or permission mutation is part of this task.
The timer-driven cases seed a clearly synthetic expiring credential and wait
for the real shell refresh scheduler. The fixture asserts that the peer, not
the receiving editor, initiated renewal. This is not live DEV acceptance.
Browser-specific learning is kept in this task-owned package: after detaching
and reattaching a native dialog, test `:modal`, not merely `[open]` or visibility.
The shared localhost notes cover unrelated tasks and were not modified.

For the separate write-fence compatibility check, fetch the existing PR16
history first, then from core-web run the following with fresh owned paths:

```sh
node tests/integration/preparePrincipalFence.mjs original ../review-original-fence
node tests/integration/preparePrincipalFence.mjs approved ../review-approved-fence
FENCE_ROOT="$PWD/../review-original-fence" node --test tests/integration/principalFence.test.ts
FENCE_ROOT="$PWD/../review-approved-fence" node --test ../review-approved-fence/tests/integration/principalFence.test.ts
FENCE_ROOT="$PWD/../review-approved-fence" node --test --test-name-pattern="cross-tab pending" tests/integration/principalFence.test.ts
```

The first composition keeps original PR16's composable/coordinator with the
released platform guards; the second three-way merges candidate source against
released77f4d2a5 and approved51900c1. A conflict stops the script. Neither tree
is a release candidate. Remove only these owned worktrees after review.

## DEV Gate and Recovery

Do not execute these steps until a separate narrow security reviewer approves
the exact candidate/composition, a release owner accepts the limitation above,
and the shared release slot is explicitly acquired.

1. Re-read both live DEV image IDs, deployment SHAs, remote heads and runtime
   origin configuration. Record them without credentials. Expected starting
   point is shell `spr1018d1`/d9b615dc and web `cpr1018d1`/77f4d2a5; stop if
   changed and re-plan with the current release owner.
2. Build from the exact reviewed heads, with a fresh unused release label,
   no source rewriting. Verify bundles/runtime config and preserve old images.
3. Deploy **shell first, then core-web** to DEV only, using the existing
   approved release procedure. Between deployments old web fails closed and
   may lose a draft; do not perform acceptance in that mixed window.
4. Reload both task-owned tabs so both have the reviewed bundles. Use approved
   test accounts via in-memory login transfer only. Open original owner/admin
   editors, type synthetic unsaved text, and wait for natural renewal with the
   receiver tab on the other page. Do not force renewal as the final acceptance.
5. Record only booleans/timing/version counters: pending content absent,
   writes/sends blocked, original node/draft/focus restored, old responses
   ignored. Cancel editors. Verify zero business-write requests and unchanged
   record revision through a read-only check; persist no user content/tokens.
6. If any gate fails, stop acceptance. Restore web `cpr1018d1`, then shell
   `spr1018d1` through the approved DEV image rollback procedure, and reload
   both tabs. This returns to the known safe-but-draft-loss baseline, not a
   successful fix. Never bypass principal validation to recover a draft.
7. Release the slot and record exact results. TEST/PRE/PROD remain untouched.
   This task's DONE marker, when issued, does not remove the release blocker.

Exact historical DEV rollback coordinates (re-read before use; these are not
fresh deployment receipts):

| Field | Shell | Core-web |
| --- | --- | --- |
| Version | spr1018d1 | cpr1018d1 |
| Commit | d9b615dc94a20b5256ea464bd0c638774d088245 | 77f4d2a516ae7625abb6950f5224b75e2926c777 |
| App | 6aa27400141459676644205c | 6aa7ec301414596766443faf |
| Environment | 6aa27402141459676644205e | 6aa7ec331414596766443fb1 |
| Cluster | 361e7cdb345d42c79dcbdd54ef7e415f | 2d206fab2bc948bb9c6f0224a5ff3236 |
| Structure | 6ad498f59819ef573cd9535e | 6ad49bd4ed327e2868425323 |
| Image | registry.101.com/6aa27400141459676644205c/nucleagent-web:20261018180126630 | registry.101.com/6aa7ec301414596766443faf/nucleagent-core-web:20261018181341957 |
| SHA256 | d2d7698def018cf772a79eb74933243012511bb95286776e5cc2872476c73922 | 1c62acbe816c0e9b147376fdfdcb10332b287e472a079e8c4c2abb9ba757074a |

Use the existing approved release tool with those exact app/environment/
cluster/structure coordinates, **web then shell**. A rollback receipt is not
completion: bound each rollout wait to 12 minutes, require 60 seconds stable
Running on the expected image, root and healthz HTTP200, and exact live image
byte verification. If it does not settle, stop and hand the receipt to the
release owner; do not repeat a deployment blindly. No rollback is executed by
this candidate-delivery task.
