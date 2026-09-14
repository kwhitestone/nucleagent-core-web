export type LatestRequestTicket = Readonly<{
  isCurrent: () => boolean;
}>;

/**
 * Generation guard for async UI loads. Invalidating on logout/unmount prevents
 * a late authenticated response from repopulating state after credentials were
 * cleared, without requiring transport-specific cancellation support.
 */
export function createLatestRequestGate() {
  let generation = 0;
  return {
    begin(): LatestRequestTicket {
      const requestGeneration = ++generation;
      return Object.freeze({
        isCurrent: () => requestGeneration === generation,
      });
    },
    invalidate(): void {
      generation += 1;
    },
  };
}
