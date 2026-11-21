/**
 * Build-time stand-in for @assistant-ui/core 0.3.35 `model-context/interactable-composer-metadata.js` (vite.config.ts alias).
 * The island's only importer is the thread runtime's `enrichAppendMetadata`, which gates `unstable_composerMetadata`.
 * That metadata only comes from model-context providers / interactables, and the island registers none, so `meta` is
 * always undefined and there are never `interactables`. Without interactables the original just copies the other keys.
 * MUYU-365 exp107: frees island bytes under the 180 KiB budget.
 * shortcut: drop the alias before the island registers a model-context provider (tests/auiSessionStubs.test.ts pins this).
 */
export function gateInteractableComposerMetadata(meta: Record<string, unknown> | undefined, _messages: readonly unknown[]): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const { interactables, ...rest } = meta;
  if (interactables !== undefined) throw new Error("Interactables are not bundled in the chat island");
  return Object.keys(rest).length ? rest : undefined;
}
