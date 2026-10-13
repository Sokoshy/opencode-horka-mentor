import type { TopicRecord } from "./memory";

export type ReminderLang = "fr" | "en" | "es" | "de";

/** Normalize a profile language to a supported reminder language (fallback "en"). */
export function reminderLanguage(language: string): ReminderLang {
  const l = (language ?? "").trim().toLowerCase().slice(0, 2);
  if (l === "fr" || l === "en" || l === "es" || l === "de") return l;
  return "en";
}

const PREFIX: Record<ReminderLang, string> = {
  fr: "Rappel mentor",
  en: "Mentor reminder",
  es: "Recordatorio del mentor",
  de: "Mentor-Erinnerung",
};

const DUE_WORD: Record<ReminderLang, string> = {
  fr: "sujet(s) à réviser",
  en: "topic(s) due for review",
  es: "tema(s) para repasar",
  de: "Thema/Themen fällig",
};

const MORE_WORD: Record<ReminderLang, string> = {
  fr: "et",
  en: "and",
  es: "y",
  de: "und",
};

/**
 * Format a startup quiz reminder (max 5 topics + "… and N more").
 * Returns "" when there is nothing due (caller skips injection).
 */
export function formatReminder(language: string, due: TopicRecord[]): string {
  if (!due || due.length === 0) return "";
  const lang = reminderLanguage(language);
  const shown = due.slice(0, 5).map((t) => t.slug);
  const extra = due.length - shown.length;
  const more = extra > 0 ? ` … ${MORE_WORD[lang]} ${extra} more` : "";
  return `[horka-mentor] ${PREFIX[lang]} : ${due.length} ${DUE_WORD[lang]} — ${shown.join(", ")}${more}.`;
}
