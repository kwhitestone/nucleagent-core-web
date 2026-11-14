# Local test performance baseline

2026-11-15, Node 24.14.0 on WSL Linux, Node test runner default file concurrency.
Times are single observed runs, not a performance improvement claim. Both unit runs
overlapped a local build. Dependencies are unchanged.

| Revision | Suite / command | Tests | Pass / skip / fail | Total |
|---|---|---:|---|---:|
| 6cbdfb9 | `npm run test:unit` | 889 | 863 / 26 / 0 | 26.876 s |
| Scoped chat strategy | `npm run test:unit` | 896 | 870 / 26 / 0 | 15.439 s |
| Scoped chat strategy | `node --test tests/chatStrategy.test.ts tests/chatReactUi.test.ts tests/conversationStreamRecovery.test.ts` | 45 | 45 / 0 / 0 | 2.801 s |
| Scoped chat strategy | `node --test tests/integration/chatStrategySettings.test.ts` | 2 | 2 / 0 / 0 | 2.416 s |

The new pure strategy cases take milliseconds, with no network, database, process
per case, sleeps or paid calls. The integration suite shares one Vite/JSDOM fixture.
Node attributes its approximately 1.55 s setup to the first test; the late-response
case takes 4.3 ms. It runs separately from the default unit glob.

Run the unit command for commits and the separate integration command for this
change before merge/release; Node parallelizes test files. Build with `npm run build`.
This records the affected suites, not execution of every existing browser harness.

2026-11-15 continuation, same WSL host and Node runner concurrency:

| Revision | Suite / command | Tests | Pass / skip / fail | Total |
|---|---|---:|---|---:|
| Nonblocking strategy and production compression | `npm run test:unit` | 897 | 871 / 26 / 0 | 14.036 s |
| Nonblocking strategy and startup JSON | `node --test tests/runtimeConfig.test.ts tests/integration/chatStrategySettings.test.ts` | 31 | 31 / 0 / 0 | 2.367 s |
| Built configuration server | `NGINX_BINARY=<nginx> node --test tests/integration/chatStrategyServer.test.mjs` | 1 | 1 / 0 / 0 | 0.332 s |

Unit count 896 → 897; inherited total 15.439 → 14.036 s. These single runs
overlap builds and are not a speedup claim. The three slowest attributed unit
durations are the existing drawer revocation fixture (6.104 s), React composer
fixture (5.589 s), and source engine rows fixture (5.053 s); shared setup is charged
to the first case. The new startup case is below one second.
Settings integration grows from two to four cases; its shared Vite/JSDOM setup
remains in the separate integration suite (1.648 s attributed to the first case).
With configuration unresolved, the send-ready fixture completes in 1.460 ms;
with preloaded configuration, 0.737 ms and one cached fetch. These are local
component readiness measurements, not end-to-end model latency.
