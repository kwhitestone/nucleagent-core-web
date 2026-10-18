# Chat bindings renewal regression

This candidate fixes the desktop/mobile regression covered by the unchanged
`integrated/` suite. It is not a release approval.

## Inputs and compatibility

- Web master: `77f4d2a516ae7625abb6950f5224b75e2926c777`.
- Session PR16 product: `66e2f4427ded1d6f3afd72bf7f7c9b1b3bd06930`.
- Delivered web tests: `a4ed694254752f87bcfc3759ec37b359b8c8ad16`.
- Core test candidate: `96fc8ae53ced958548085e36dbc282d78a583626`
  atop product `c6768811778d6e536c129f06279ff0adb6c98905`.
- Shell: `d9b615dc94a20b5256ea464bd0c638774d088245`.
- Old shell negative control: `a0a0ae1816b9d52c4c8c86f566ccb3a5149b7384`.

The combined pre-fix web commit is
`6a8da6db5f37a247982cd02c5872bc8358659b2f`; its `src/` matches the
delivered test candidate exactly. Original assertions reproduce chat 2 pass /
2 red; after the fix they give 4 pass and shell 13 pass. The old shell token
assertion must stay red.

The seven product files are the platform runtime contract, embedded session,
HTTP interceptor, bindings API, both bindings composables, and TaskConversation.
No backend or shell product change, dependency pin change, or protocol rewrite
is required. Apply the final fix commit only after PR16's product prerequisites
are present. Do not replace the release line's independently reviewed candidate
with this full branch without a separate narrow review.

## Boundary contract

`AxiosRequestConfig.sessionBoundary?: "business"` is opt-in only for bindings
PUT and the fence-establishing sync POST. The default request signal still
retires on every accepted credential renewal. The business signal retires on
principal/grants change, unknown identity, logout, or current-credential 401.
Custom HTTP runtime implementations must honor the same boundary semantics.

Preservation requires authenticated=true and an explicitly non-destructive
event from the verified principal/grants logic. Missing/legacy metadata stays
destructive. A safe renewal keeps the mounted editable snapshot, picks, draft,
pending write and write barrier. Catalog GETs can restart without clearing
selection; an authoritative chat retains its SSE subscription. An initial chat
snapshot still retries after renewal cancels its credential-scoped GET.

An aborted HTTP request is not proof of server noncommit. The existing 15-second
deadline does not restart at renewal. Failed/unknown writes remain send-blocking
until an authoritative newer fence, including after logout and relogin. Local
request gates and transport invalidation reject late cross-scope responses.

## Reproduce

Use the independent roots and CDP safety prerequisites in `integrated/README.md`.
Keep the original runner and its assertions unchanged.

```sh
npm run test:unit
npm run build
node --test tests/renewalBindings.test.ts tests/conversationSnapshotLoading.test.ts
FENCE_ROOT="$PWD" node --test tests/integration/principalFence.test.ts

CORE_WEB_ROOT=/owned/web CORE_ROOT=/owned/core SHELL_ROOT=/owned/shell \
RED_SHELL_ROOT=/owned/shell-red CDP_ORIGIN=http://127.0.0.1:9229 \
PORT_BASE=5631 OUTPUT_DIR=/owned/evidence/exact-sha \
node tests/browser/integrated/run-local.mjs
```

Mutation scripts edit source temporarily. Run only in a disposable owned
worktree with the candidate and its own dependency copy, never a shared tree:

```sh
RENEWAL_MUTATION_OWNED_TREE="$PWD" RESULT_DIR=/owned/evidence/renewal-mutations \
node tests/mutations/renewalBindings.mjs
RESULT_PATH=/owned/evidence/shell-mutations.json \
node tests/mutations/shellPrincipal.mjs
```

Renewal mutations record every attempted mutation, including a surviving
defense-in-depth PUT gate mutation. It is not counted as effective coverage:
the deadline/abort layer still rejects late completion. The other 12 must be
assertion-killed; syntax/module failures do not count. Restored control must pass.

The original unit baseline has six missing-principal fixture failures. With
only the existing skillPicker fixture corrected, old product is 689 pass /
0 fail / 26 skip. The fix and 15 new cases give 704 pass / 0 fail / 26 skip.
Both original and candidate type/build pass.

## Evidence limits

The browser uses actual parent/child components, local Gin/Huma handlers,
bindings persistence/fences, RuntimeTools projection and actual local SSE.
Authentication, catalog and model boundaries are synthetic. This does not
verify real platform authentication/renewal, production SSE, model calls,
deployment identity, or online behavior. Separate independent narrow review
and release-line integration approval are still required.
