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
