/** Composer buttons: idle → send (aui disables it while empty); running → stop, plus queue once there is text. */
export type ComposerAction = "send" | "queue" | "stop";

export const composerActions = (running: boolean, empty: boolean): ComposerAction[] =>
  running ? (empty ? ["stop"] : ["queue", "stop"]) : ["send"];

/** Roving focus in the model menu: index to focus for a key, or null when the key is not a move. */
export function moveFocus(count: number, current: number, key: string): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown": return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp": return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
