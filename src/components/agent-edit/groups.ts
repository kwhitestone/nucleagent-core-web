export const groups = ["basic", "persona", "model", "skills", "visibility", "history", "advanced"] as const;
export type Group = typeof groups[number];
export const groupLabels = {
  basic: "basic", persona: "persona", model: "groupModel", skills: "groupSkills",
  visibility: "visibility", history: "history", advanced: "advanced",
} as const;
export const ownerGroups = groups.filter(group => ["basic", "persona", "model", "skills"].includes(group));
