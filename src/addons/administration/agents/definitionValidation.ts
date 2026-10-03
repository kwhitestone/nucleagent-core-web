// IM identity requires a model: see nucleagent-acceptance-baseline.md §7 —
// a definition with an IM identity (authAgentUserId) but no provider/model
// makes IM dispatch fail in Core with im_invalid_provider_model, and the IM
// user sees nothing. Mirrors the server-side check in the one shared admin
// save path (addons/admin/router/agents.go: saveAgentDefinition).
export function definitionIMRequiresModel(authAgentUserId: string, model: string): boolean {
  return authAgentUserId.trim() !== "" && model.trim() === "";
}
