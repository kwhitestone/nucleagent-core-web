#!/bin/bash
# MT3-coreweb mutation check: each mutant must turn tests/generation.test.ts red; the file is restored after each.
# Usage: scripts/mt3-web-mutations.sh   (from the repo root; needs node_modules)
set -u
cd "$(dirname "$0")/.."
G=src/addons/conversation/composables/generation.ts
M=src/addons/conversation/api/media.ts
P=src/addons/conversation/components/modelPickerOptions.ts
killed=0; total=0
mutate() { # id file python-old python-new
  local id=$1 file=$2
  total=$((total+1))
  if ! python3 - "$file" "$3" "$4" <<'PY'
import sys
f, a, b = sys.argv[1:4]
s = open(f).read()
if s.count(a) != 1: sys.exit(f"anchor not unique/found: {a!r}")
open(f, "w").write(s.replace(a, b))
PY
  then echo "MUTANT $id ANCHOR-MISSING"; return; fi
  if timeout 150 node --test tests/generation.test.ts > /tmp/mt3-web-mut-$id.log 2>&1; then
    echo "MUTANT $id SURVIVED"
  else
    killed=$((killed+1)); echo "MUTANT $id killed ($(grep -m1 -E '^✖' /tmp/mt3-web-mut-$id.log | cut -c1-90))"
  fi
  git checkout -q -- "$file"
}
mutate V1-card-every-image   $G 'if (card.id === "generateImage") return "image";' 'return "image";'
mutate V1b-card-ids-swapped  $G 'if (card.id === "generateImage") return "image";' 'if (card.id === "generateImage") return "video";'
mutate V2-unknown-as-failed  $G 'return { label: t("generate.status.unknown"), pending: false, preview: false, download: false, regenerate: false };' 'return { label: t("generate.status.failed", { reason: "" }), pending: false, preview: false, download: false, regenerate: true };'
mutate V3-failed-download    $G 'return { label: t("generate.status.failed", { reason }), pending: false, preview: false, download: false, regenerate: true };' 'return { label: t("generate.status.failed", { reason }), pending: false, preview: false, download: true, regenerate: true };'
mutate V4-en-key-missing     src/i18n/en.ts '      gateway_unavailable: "The model gateway is unavailable — please try again later",' ''
mutate V5-double-submit      $G '      if (state.busy) return null;' ''
mutate V5b-button-not-disabled src/addons/conversation/views/Generate.vue 'data-testid="gen-submit" :disabled="!canSubmit || submitter.state.busy"' 'data-testid="gen-submit"'
mutate V6-hidden-still-polls $G '  if (hidden) return null;' ''
mutate V7-poll-after-leave   $G '    stop() { stopped = true; clear(); },' '    stop() { clear(); },'
mutate V7b-no-stop-on-unmount src/addons/conversation/views/Generate.vue 'onBeforeUnmount(() => {
  poller.stop();' 'onBeforeUnmount(() => {'
mutate V8-download-url-cached $M 'export async function freshDownloadUrl(id: number): Promise<string> {
  const task = await getGeneration(id);' 'const cache = new Map<number, GenerationTask>();
export async function freshDownloadUrl(id: number): Promise<string> {
  const task = cache.get(id) ?? await getGeneration(id); cache.set(id, task);'
mutate V9-others-visible     $G '  return server.map((s) => byId.get(s.id) ?? s);' '  return [...server.map((s) => byId.get(s.id) ?? s), ...polled.filter((p) => !server.some((s) => s.id === p.id))];'
mutate V10-mixed-types       $G '  return models.filter((m) => m.kind === kind).map((m) => `${m.providerId}:${m.model}`);' '  return models.map((m) => `${m.providerId}:${m.model}`);'
mutate V10b-picker-not-narrowed $P '  if (!only) return groups;' '  return groups;'
mutate V11-429-hint-missing  $G '  if (error instanceof ApiError && error.code !== "model_type_mismatch" && (ERROR_CODES as readonly string[]).includes(error.code)) {' '  if (error instanceof ApiError && error.code !== "model_type_mismatch" && error.code !== "media_busy" && (ERROR_CODES as readonly string[]).includes(error.code)) {'
mutate V12-home-no-route     src/addons/conversation/views/Home.vue '    void router.push({ name: "generate", params: { kind } });
    return;' ''
mutate V13-composer-shown    $G '  return conv?.mode !== "media";' '  return true;'
echo "MUTATIONS $killed/$total killed"
git status --short src | grep . && echo "WARN worktree not clean" || true
[ "$killed" -eq "$total" ]
