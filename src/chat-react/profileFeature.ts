/**
 * MUYU-365 exp101 (5): the user (2026-11-21) — no profile entry until its design is confirmed. While false the
 * Controls 「模型预设」 is not rendered, a stored profileId is neither sent nor used to narrow effort, and the
 * stored preference (Core /model-preferences) is kept as is. Restore by setting it to true.
 * exp104: the user confirmed the design (D1A–D8A, 2026-11-21 01a1fd03); D8A reopens it with this code switch.
 */
export const PROFILE_UI_ENABLED = true;
