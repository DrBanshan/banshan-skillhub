import type { SkillEvent } from "./types";

export function createSkillEvent(
  type: SkillEvent["type"],
  skillId: string | undefined,
  details: Record<string, unknown>,
  at = new Date().toISOString()
): SkillEvent {
  return {
    id: `${at}-${Math.random().toString(36).slice(2, 10)}`,
    skillId,
    type,
    at,
    details
  };
}
