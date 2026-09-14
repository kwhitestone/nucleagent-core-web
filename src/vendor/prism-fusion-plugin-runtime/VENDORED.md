# Vendored: `@prism-fusion/plugin-runtime`

This directory is a **verbatim copy** of the Prism Fusion frontend plugin
runtime. It is vendored rather than consumed as a package because this
repository uses a standalone build context with no access to the workspace-relative
`file:../../../../prism-fusion/src/web/src/plugin` path the source tree used.

## Provenance

| | |
|---|---|
| Upstream repository | `kwhitestone/prism-fusion` |
| Upstream path | `src/web/src/plugin` |
| Upstream commit | `45d6fc57545443e4055cf20b393720a597c1a854` |
| Package name | `@prism-fusion/plugin-runtime` |
| Package version | `2.1.0` |
| Vendored on | 2026-09-14 |

## What is and is not vendored

Vendored files (10):

```
headless.ts        host-routes.ts     navigation.ts      package.json
registry.ts        remote-channel.ts  remote-registry.ts remote.ts
runtime.ts         types.ts
```

Deliberately **not** vendored:

- `*.test.ts` — upstream's own tests, which exercise the package inside the
  upstream harness. They are not part of this application's build or test
  surface.
- `loader.ts` and `index.ts` — upstream's *host-application* entry point. These
  two import `@/router/index` and `@/utils/request`, which resolve against the
  Prism Fusion host app's `src/`, not against this repository's. They are
  unreachable here: the package's `exports` map only exposes `headless.ts`,
  `remote.ts` and `types.ts`, and this application imports exactly two
  specifiers — `@prism-fusion/plugin-runtime` and
  `@prism-fusion/plugin-runtime/remote`. Neither reaches `loader.ts`. Vendoring
  them would only break `vue-tsc` on imports that can never resolve.

The remaining 10 files are an unmodified copy; the internal `./x.js` import
graph among them is self-contained.

## How it is wired in

The import specifiers are unchanged from upstream — application code still
writes `@prism-fusion/plugin-runtime` and `@prism-fusion/plugin-runtime/remote`.
Resolution is redirected to this directory in two places, which must be kept
in sync:

- `tsconfig.json` → `compilerOptions.paths`
- `vite.config.ts` → `resolve.alias`

The `peerDependencies` declared in the vendored `package.json`
(`vue ^3.5.0`, `vue-router ^4.6.0`) are satisfied by this repository's own
`dependencies`, and `resolve.dedupe` keeps a single copy of each at runtime.

## Updating

Do not hand-edit files in this directory. To take a newer upstream revision:

1. Copy the production `.ts` files from `src/web/src/plugin` at the new commit.
2. Delete any `*.test.ts` that came along.
3. Update the **Upstream commit** and **Vendored on** rows above.
4. Rebuild and run this repository's test suite.

Local modifications: **none**. This is an unmodified copy.
