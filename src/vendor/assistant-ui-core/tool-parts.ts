/**
 * Build-time stand-in (vite.config.ts plugin, scoped per importer) for three @assistant-ui/core 0.3.35 / assistant-stream
 * 0.3.57 tool-part paths the island never reaches:
 * - `runtime/utils/tool-interactions.js`: conversion reads `unstable_interactions` (never set on island parts, so always
 *   undefined); the part runtime creates one only in `unstable_recordInteraction`.
 * - assistant-stream `ToolResponse`: used only by the part runtime's `addToolResult`.
 * - `generativeUI/GenerativeUI.js`: rendered only for `generative-ui` parts with a `components.generativeUI` allowlist.
 * The island's tool parts come from Core with results attached; it calls no tool-result API and has no generative UI.
 * MUYU-365 exp109: frees island bytes under the 180 KiB budget.
 * shortcut: drop the plugin before the island records interactions, adds tool results or renders generative UI
 * (tests/auiSessionStubs.test.ts pins this).
 */
const unreachable = (): never => { throw new Error("Tool interactions, tool results and generative UI are not bundled in the chat island"); };
/** Same as the original for the only value the island can pass (undefined); anything else is unreachable. */
export function readToolInteractionLog(value: unknown): undefined {
  if (value !== undefined) unreachable();
  return undefined;
}
export const createToolInteraction = unreachable;
export const ToolResponse = { toResponse: unreachable };
export const GenerativeUIRender = unreachable;
