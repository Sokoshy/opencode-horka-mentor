import { parseStatusField } from "./paths";

export interface TopicRecord {
  slug: string;
  file?: string;
  level: string;
  last_assessed: string;
  next_review: string;
  interval_step?: string;
}

/**
 * Parse dev-profile.md for language + proactive flag only.
 * Reads `**Language**:` and `**Proactive mode**:` (never the inverted pattern).
 * Language fallback "en", proactive default false.
 */
export function parseProfile(markdown: string): { language: string; proactiveEnabled: boolean } {
  const rawLang = parseStatusField(markdown, "Language");
  const language = rawLang && rawLang.trim().length > 0 ? rawLang.trim().toLowerCase() : "en";
  const rawProactive = parseStatusField(markdown, "Proactive mode");
  const proactiveEnabled = typeof rawProactive === "string" && /enabled/i.test(rawProactive);
  return { language, proactiveEnabled };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
}

/**
 * Project raw topic files to due TopicRecords, sorted by next_review asc.
 * Keeps only topics with a valid next_review <= today. Ignores invalid dates.
 */
export function parseDueTopics(
  files: { slug: string; content: string }[],
  today: string,
): TopicRecord[] {
  const due: TopicRecord[] = [];
  for (const f of files) {
    const next_review = parseStatusField(f.content, "Next review") ?? "";
    if (!isValidDate(next_review)) continue;
    if (next_review > today) continue;
    due.push({
      slug: f.slug,
      level: parseStatusField(f.content, "Level") ?? "unknown",
      last_assessed: parseStatusField(f.content, "Last assessed") ?? "",
      next_review,
      interval_step: parseStatusField(f.content, "Interval step") ?? "",
    });
  }
  due.sort((a, b) => a.next_review.localeCompare(b.next_review));
  return due;
}
