/**
 * MUYU-365 exp101 (5): the user (2026-11-21) — no profile entry until its design is confirmed. While false the
 * Controls 「模型预设」 is not rendered, a stored profileId is neither sent nor used to narrow effort, and the
 * stored preference (Core /model-preferences) is kept as is. Restore by setting it to true.
 */
export const PROFILE_UI_ENABLED = false;
