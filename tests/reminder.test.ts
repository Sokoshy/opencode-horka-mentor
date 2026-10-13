import { test } from "node:test";
import assert from "node:assert/strict";
import { formatReminder, reminderLanguage } from "../src/lib/reminder.ts";
import type { TopicRecord } from "../src/lib/memory.ts";

const rec = (slug: string): TopicRecord =>
  ({ slug, level: "learning", last_assessed: "2026-10-10", next_review: "2026-10-10" });

test("reminderLanguage: fr/en/es/de, fallback en", () => {
  assert.equal(reminderLanguage("fr"), "fr");
  assert.equal(reminderLanguage("FR"), "fr");
  assert.equal(reminderLanguage("es"), "es");
  assert.equal(reminderLanguage("de"), "de");
  assert.equal(reminderLanguage("jp"), "en");
  assert.equal(reminderLanguage(""), "en");
});

test("formatReminder: liste les topics dus", () => {
  const s = formatReminder("fr", [rec("async-await"), rec("jwt")]);
  assert.ok(s.includes("async-await") && s.includes("jwt"));
});

test("formatReminder: max 5 + more", () => {
  const due = ["a", "b", "c", "d", "e", "f", "g"].map(rec);
  const s = formatReminder("en", due);
  for (const slug of ["a", "b", "c", "d", "e"]) assert.ok(s.includes(slug));
  assert.ok(!s.includes("g"));
  assert.ok(/2 more/.test(s));
});

test("formatReminder: vide -> chaîne vide", () => {
  assert.equal(formatReminder("fr", []), "");
});
