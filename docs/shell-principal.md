# Shell Principal Consumer

Candidate only; independent coordinator review is required before merge/release.
Related regression: ndhy-app-web/nucleagent-core-web#17.

The existing authenticated frame channel accepts the additive protocol-1
`principal: { id: string } | null` field. Canonical IDs match
`^[1-9][0-9]{0,15}$` and must be positive JavaScript safe integers. The producer
may derive this field only from current authenticated `/user-info.id`, never a
display name, arbitrary storage value or unverified JWT claim.

Existing exact parent origin, source window, protocol version, app and handshake
instance checks run before payload processing; existing monotone session-version
and rejected-version checks remain. This patch does not widen accepted messages.
Unknown or old producers do not establish a protected session.

Two generations have different jobs:

- `requestGeneration` advances on accepted credential/version or business changes.
  Old HTTP signals are aborted; late Axios results are rejected.
- `businessBoundaryGeneration` advances on unknown identity, logout, principal or
  normalized grant changes, or current-credential rejection. `authenticatedView`
  and `AdminAgents` both use this destructive boundary to discard protected
  records, drafts and image nodes.
- Proven same principal and normalized grants preserve component identity across
  renewal. Every actual renewal still emits `SESSION_CHANGE_EVENT`. Legacy events
  without explicit boundary metadata remain destructive.

Cancellation is not evidence that a server write stopped. The separate PR16
bindings coordinator keeps its module-level unknown-write barrier, keyed by
server principal plus conversation. Renewal still triggers its sync recovery;
same-revision snapshots cannot clear unknown outcomes, and newer authoritative
fences recover. The candidate does not merge or modify that backend/protocol.
`tests/integration/principalFence.test.ts` runs explicitly against an owned
PR16+candidate tree via `FENCE_ROOT`; it is not included in the mainline unit total.

| Shell | Core | Behavior |
| --- | --- | --- |
| Old | Old | Existing draft-loss regression |
| New | Old | Additive principal ignored |
| New, proven ID | New | Same boundary preserves; security boundaries destroy |
| Old, missing or malformed ID | New | Fail closed, protected state removed |

Upgrade shell first, Core second; rollback Core first. The coordinator must
confirm numeric ID scope in the configured auth realm and independently review
identity/display lifecycle changes. Subsequent release work starts with real DEV
natural renewal and zero business writes before any later environment.

## Reproduction

Install each repository with its lockfile. The browser fixture imports the real
producer from sibling `../shell` (or `SHELL_ROOT`) and real Core components.
Run `node tests/browser/session-renewal/server.mjs`, then run
`flock -w 30 /tmp/cdp-9229.lock node tests/browser/session-renewal/red.mjs`.
The runner uses an existing CDP browser, an owned isolated page, synthetic data,
and blocked external traffic. It preserves pre-existing pages. No real login,
record or permission mutation is needed.

Run `node tests/mutations/shellPrincipal.mjs` exclusively, not concurrently with
other source-reading tests. It restores every source in `finally`, verifies the
unmutated suite before and after, and counts only assertion-killed mutations.
