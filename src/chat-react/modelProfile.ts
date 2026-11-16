import { EFFORT_LEVELS, type EffortChoice, type effortView } from "./requestEffort.ts";

/** `efforts`: the profile's server whitelist for modelParams.reasoningEffort, as /model-profiles returned it. */
export interface ProfileSelection { scope: string; profileId: string; efforts?: string[] }

/**
 * MUYU-406 §2.1: with a profile selected in this scope, a level stays on only if the evidence view and the profile
 * whitelist both list it. A missing (older Core) or empty whitelist offers no level; the default item stays.
 */
export function profileEffortView(view: ReturnType<typeof effortView>, selection: ProfileSelection | null, scope: string) {
  if (!selection?.profileId || selection.scope !== scope) return view;
  return { ...view, off: EFFORT_LEVELS.filter((level) => view.off.includes(level) || !selection.efforts?.includes(level)) };
}

/**
 * This turn's one field set (Core rejects both together): the selected profile, with the Controls effort as its
 * explicit modelParams, or the legacy effort alone. A selection made for another conversation/backend/model is ignored.
 */
export function profileRequest(selection: ProfileSelection | null, scope: string, effort: EffortChoice) {
  if (!selection?.profileId || selection.scope !== scope) return effort;
  return { profileId: selection.profileId, ...(effort ? { modelParams: { reasoningEffort: effort } } : {}) };
}
