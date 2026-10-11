export const definitionDetail = {
  definition: { id: 3, name: "HR", slug: "hr", revision: "2", isActive: false, config: {} },
  capabilities: { read: true, write: true, writeIdentity: true, delete: true, restore: true, readSkills: true, writeSkillBindings: true, readTools: true, writeTools: true },
  fieldPolicy: { editablePaths: ["/name", "/config/avatar", "/isActive"], readOnlyPaths: [], protectedPaths: [], unknownPaths: [], reasons: {} },
  skillBindings: [], skills: [], tools: [],
  effective: { revision: "opaque", definitionRevision: "2" },
  identity: { uid: 5, status: "ready", projectionRevision: "2" },
};
