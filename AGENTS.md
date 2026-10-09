## Public Maintenance Rules

<!-- Absolute path on purpose: a ../nucleagent-docs link resolves against the checkout dir, so from a worktree (wt/<name>) it points at a nonexistent wt/nucleagent-docs. -->
Before editing, read the [canonical maintenance rules](/home/workspace/nucleagent-workspace/nucleagent-docs/docs/nucleagent/09-workspace-frontend-maintenance.md)
and this repository's existing rules. Report the paths actually read.
The canonical guide owns product/adapter boundaries, credential prohibitions,
working-tree and commit/history scans, deployment regression, and explicit Agent handoff.
If the guide is unavailable or conflicts with this file, report the issue before editing;
do not duplicate the guide or infer that an active Agent has received new instructions.

测试性能：遵守工作区根 `/home/workspace/nucleagent-workspace/AGENTS.md` 的《测试性能规则》。

## Dual-Remote Sync

<!-- Absolute path on purpose, same reason as the maintenance-rules link. -->
- The `ndhy-app-web` (org) and `kwhitestone` remotes of this repository must stay identical: trunk, tags and `backup/*` branches. Identify them by URL, not remote name (`git remote -v`); a repository with a single remote pushes only to that one.
- Every push or merge to one remote's trunk must push the same SHA to the other in the same step (fast-forward; history rewrites only via backup branch + `--force-with-lease=<branch>:<old-sha>`; never bare `--force`, `--all` or `--mirror`; never drop commits).
- Closing reports paste `git ls-remote <remote> refs/heads/<trunk>` for both remotes; the work is done only when the SHAs match.
- Ignore the org CI (`verify` fails with 403 in `actions/checkout`); it never blocks a merge or a report. Use `gh pr merge --admin --rebase` when review is required.
- Full rules: [12-dual-remote-sync.md](/home/workspace/nucleagent-workspace/nucleagent-docs/docs/nucleagent/12-dual-remote-sync.md).
