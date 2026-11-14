# Optional React ordinary-chat strategy

The React island alone reads the optional same-origin `/chat-strategy.json`. Missing,
invalid, redirected or unavailable configuration leaves the existing default unchanged.
The request omits credentials and times out after two seconds. Serve the file through
the environment's normal static configuration deployment; no backend setting API is
used. This repository does not ship an enabled configuration.

Configuration is restricted to `scope: "test-react-ordinary"` and an exact `origin`
match. Its `backend` must match the chosen execution backend. The candidate is applied
only to a new React ordinary conversation when the current typed chat catalog contains
the exact provider/model and the backend permits it. It is sent explicitly in the
existing create request. Existing conversations and explicit user choices, including
the server-default option, are preserved. Vue, chatUi routing, complex task settings,
thinking parameters and global defaults are unaffected. All model options remain.

An illustrative configuration (replace evidence with actual measurements):

```json
{
  "scope": "test-react-ordinary",
  "origin": "https://test.example.com",
  "backend": "configured-backend",
  "candidate": { "providerId": 1, "model": "measured-model" },
  "measurements": [{
    "providerId": 1,
    "model": "measured-model",
    "n": 5,
    "medianMs": 1900,
    "maxMs": 3100,
    "date": "2026-11-15",
    "versions": "Core measured-version / Executor measured-version",
    "quality": "Short prompts and fixed-image facts only",
    "thinking": null,
    "vision": null
  }]
}
```

The candidate requires at least five samples and text p50 ≤2000ms. A label displays
sample count, p50, max, date, versions and quality scope; it never promises every
request meets the threshold or that the candidate is best across the catalog.
Missing measurements mean unknown in this batch, not absence of historical samples.
Keep different measurement versions in distinct configuration revisions; do not pool
them. Refresh evidence before deployment when backend versions or routing change.

Thinking is independent of latency: `null` means unknown. A non-null value requires
`{"supported": true, "source": "official or catalog evidence reference"}` (or false).
Vision evidence requires `n`, `medianMs` and `source`; successful fixed-image tests do
not enable a capability. Image upload guidance uses the current typed catalog's
`vision_in`. A measured candidate is suggested for manual switching only when that
capability is also enabled. No silent switch or catalog write occurs. Chinese guidance
includes measured vision latency and warns when the two-second threshold is unmet.

Enable and roll back `vision_in` independently through the formal data workflow,
recording before/after reads and rollback payloads. Removing this JSON disables the
new default for subsequent new chats after reload; already selected conversations
keep their explicit settings. Configuration deployment is separate from code release.

Attachment reconciliation can temporarily invalidate download authority while a
snapshot loads. React describes this as pending verification, not proven failure;
downloads remain unavailable until authoritative verification returns.

Validation: `node --test tests/chatStrategy.test.ts tests/chatReactUi.test.ts`,
`npm run test:unit`, `npm run build`. The separate local integration suite is
`node --test tests/integration/chatStrategySettings.test.ts` (about 2.5 seconds,
including a shared Vite/JSDOM fixture; no network). Compare default and React bundle closures with
`node scripts/muyu365-bundle-size.mjs dist <baseline-dist>` using the same dependency
installation. These local tests do not replace deployment E2E or fresh measurements.
