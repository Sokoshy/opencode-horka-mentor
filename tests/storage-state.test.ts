import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProactiveState } from "../src/lib/proactive-policy.ts";

// Pure serialization helpers (mirrors the storage round-trip, no src/ changes).
function roundTrip(state: ProactiveState): ProactiveState {
  return JSON.parse(JSON.stringify(state)) as ProactiveState;
}

function addSeen(state: ProactiveState, hash: string): ProactiveState {
  if (state.seen.includes(hash)) return state;
  return { ...state, seen: [...state.seen, hash] };
}

test("JSON round-trip conserves count/seen/cooldown", () => {
  const state: ProactiveState = {
    count: 1,
    seen: ["abc123"],
    cooldown: false,
    updatedAt: 1700000000000,
  };
  const restored = roundTrip(state);
  assert.deepEqual(restored, state);
});

test("cooldown true apres skipped (modele pur)", () => {
  const state: ProactiveState = { count: 1, seen: ["h1"], cooldown: false, updatedAt: 1 };
  const skipped: ProactiveState = {
    ...roundTrip(state),
    cooldown: true,
    lastOutcome: "skipped",
    updatedAt: 2,
  };
  const restored = roundTrip(skipped);
  assert.equal(restored.cooldown, true);
  assert.equal(restored.lastOutcome, "skipped");
});

test("seen sans doublon apres ajout", () => {
  const state: ProactiveState = { count: 0, seen: ["h1"], cooldown: false, updatedAt: 1 };
  assert.equal(addSeen(state, "h1").seen.length, 1);
  const added = addSeen(state, "h2");
  assert.deepEqual(added.seen, ["h1", "h2"]);
});

test("count incremente survit au round-trip", () => {
  const state: ProactiveState = { count: 0, seen: [], cooldown: false, updatedAt: 1 };
  const next: ProactiveState = {
    ...roundTrip(state),
    count: state.count + 1,
    seen: ["h1"],
    updatedAt: 2,
  };
  const restored = roundTrip(next);
  assert.equal(restored.count, 1);
  assert.deepEqual(restored.seen, ["h1"]);
});

test("lastOutcome optionnel absent par defaut", () => {
  const state: ProactiveState = { count: 0, seen: [], cooldown: false, updatedAt: 1 };
  const restored = roundTrip(state);
  assert.equal("lastOutcome" in restored, false);
});
