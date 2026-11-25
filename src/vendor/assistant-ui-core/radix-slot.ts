/**
 * Build-time stand-in for @radix-ui/react-slot 1.5.0 (vite.config.ts plugin, scoped to radix-ui's barrel and
 * @radix-ui/react-primitive). A Slot renders only when an aui primitive gets `asChild` or a `render` element; the island
 * passes neither, so primitives render their plain element. react-primitive still creates one Slot per node at module
 * load, so createSlot returns an inert component that throws only if rendered.
 * MUYU-365 exp109: frees island bytes under the 180 KiB budget.
 * shortcut: drop the plugin before the island passes asChild/render to an aui primitive (tests/auiSessionStubs.test.ts pins this).
 */
export function createSlot(ownerName: string) {
  const SlotStandIn = (): never => { throw new Error(`${ownerName} not bundled`); };
  return SlotStandIn;
}
export const Slot = createSlot("Slot");
export { Slot as Root };
export function createSlottable(ownerName: string) { return createSlot(`${ownerName}.Slottable`); }
export const Slottable = createSlottable("Slottable");
