import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSlashCommand,
  hasExplicitSkills,
  normalizePromptHash,
  shouldConsider,
} from "../src/lib/proactive-policy.ts";

test("isSlashCommand: /mentor true, texte false", () => {
  assert.equal(isSlashCommand("/mentor"), true);
  assert.equal(isSlashCommand("  /quiz"), true);
  assert.equal(isSlashCommand("mentor"), false);
  assert.equal(isSlashCommand("explique moi /mentor"), false);
});

test("hasExplicitSkills: true seulement si skills non vide", () => {
  assert.equal(hasExplicitSkills({ skills: [{ id: "x" }] }), true);
  assert.equal(hasExplicitSkills({ skills: [] }), false);
  assert.equal(hasExplicitSkills({}), false);
});

test("shouldConsider: vide/slash/skills -> false, sinon true", () => {
  assert.equal(shouldConsider("", {}), false);
  assert.equal(shouldConsider("   ", {}), false);
  assert.equal(shouldConsider("/mentor", {}), false);
  assert.equal(shouldConsider("explique async", { skills: [{ id: "x" }] }), false);
  assert.equal(shouldConsider("explique async", {}), true);
});

test("normalizePromptHash: stable et 16 hex", () => {
  const a = normalizePromptHash("hello");
  const b = normalizePromptHash("hello");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.notEqual(a, normalizePromptHash("other"));
});
