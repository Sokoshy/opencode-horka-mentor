import { createHash } from "node:crypto";

/** Persistent proactive throttle state (storage key `proactive:<sessionID>`). */
export interface ProactiveState {
  count: number;
  seen: string[];
  cooldown: boolean;
  lastOutcome?: "intervened" | "skipped" | "ignored";
  updatedAt: number;
}

export function emptyProactiveState(): ProactiveState {
  return { count: 0, seen: [], cooldown: false, updatedAt: Date.now() };
}

/** True if the raw prompt is a slash command (`/mentor`, `/quiz`, ...). */
export function isSlashCommand(raw: string): boolean {
  return raw.trimStart().startsWith("/");
}

/** True if the prompt already carries explicit skills (command invocation). */
export function hasExplicitSkills(prompt: { skills?: unknown[] }): boolean {
  return Array.isArray(prompt?.skills) && prompt.skills.length > 0;
}

/** Stable 16-char hex hash for dedup (same input -> same hash). */
export function normalizePromptHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Whether the prompt hook should even consider a proactive injection.
 * Skips empty prompts, slash commands, and prompts with skills attached.
 */
export function shouldConsider(raw: string, prompt: { skills?: unknown[] }): boolean {
  if (!raw || raw.trim().length === 0) return false;
  if (isSlashCommand(raw)) return false;
  if (hasExplicitSkills(prompt)) return false;
  return true;
}
