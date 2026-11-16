import type { EffortChoice } from "./requestEffort";

export interface ProfileSelection { scope: string; profileId: string }

/**
 * This turn's one field set (Core rejects both together): the selected profile, with the Controls effort as its
 * explicit modelParams, or the legacy effort alone. A selection made for another conversation/backend/model is ignored.
 */
export function profileRequest(selection: ProfileSelection | null, scope: string, effort: EffortChoice) {
  if (!selection?.profileId || selection.scope !== scope) return effort;
  return { profileId: selection.profileId, ...(effort ? { modelParams: { reasoningEffort: effort } } : {}) };
}
