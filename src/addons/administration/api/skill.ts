import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { Skill } from "./types";

const BASE = "/api/v1/addons/skill";

/**
 * GET /skill — list available skills.
 */
export async function listSkills(): Promise<Skill[]> {
  const response = await getPlatformRuntime().http.get<Skill[]>(BASE);
  return response.data;
}
