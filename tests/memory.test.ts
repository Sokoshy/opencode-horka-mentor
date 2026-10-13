import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProfile, parseDueTopics } from "../src/lib/memory.ts";

// ------------------------------------------------------------ parseProfile

test("parseProfile: fr + enabled", () => {
  const md = "- **Language**: fr\n- **Proactive mode**: enabled\n";
  assert.deepEqual(parseProfile(md), { language: "fr", proactiveEnabled: true });
});

test("parseProfile: en + disabled", () => {
  const md = "- **Language**: en\n- **Proactive mode**: disabled\n";
  assert.deepEqual(parseProfile(md), { language: "en", proactiveEnabled: false });
});

test("parseProfile: fallback en + proactive false quand absent", () => {
  assert.deepEqual(parseProfile("# vide\n"), { language: "en", proactiveEnabled: false });
});

test("parseProfile: ne matche pas le pattern inversé", () => {
  // "Language: **fr**" n'est pas le format "- **Language**: fr" -> fallback
  const md = "- Language: **fr**\n- Proactive mode: **enabled**\n";
  assert.deepEqual(parseProfile(md), { language: "en", proactiveEnabled: false });
});

// ------------------------------------------------------------ parseDueTopics

const topic = (slug: string, next: string, level = "learning") =>
  ({ slug, content: `- **Level**: ${level}\n- **Next review**: ${next}\n` });

test("parseDueTopics: dû aujourd'hui + en retard, trié asc", () => {
  const due = parseDueTopics(
    [topic("b", "2026-10-13"), topic("a", "2026-10-10"), topic("future", "2026-10-20")],
    "2026-10-13",
  );
  assert.deepEqual(due.map((t) => t.slug), ["a", "b"]);
});

test("parseDueTopics: ignore dates invalides", () => {
  const due = parseDueTopics(
    [topic("ok", "2026-10-12"), topic("bad", "demain"), topic("empty", "")],
    "2026-10-13",
  );
  assert.deepEqual(due.map((t) => t.slug), ["ok"]);
});
