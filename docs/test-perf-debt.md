# Test performance debt

## React strategy integration fixture (2026-11-15)

- Scope: `tests/integration/chatStrategySettings.test.ts`; separate local integration suite.
- Observed total: 2.416 s. First test including shared Vite/JSDOM/module setup: 1.555 s
  (64.4% of total); late-response test: 0.0043 s (0.2%). Remaining time is runner startup/teardown.
- The fixture is shared once, uses no network and no sleeps. It remains outside the unit glob.
- Plan: profile module transforms if this suite grows; reuse this fixture for additional
  settings cases, and consider extracting the settings hook when a functional change warrants it.
- Owner: chat frontend maintainers. Review by 2026-12-15. Status: isolated integration
  cost recorded; no claim that moving the suite reduces its runtime.
