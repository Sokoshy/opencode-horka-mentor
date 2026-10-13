# Changelog

## 1.1.0 (compléments) — 2026-10-13

- Extraction `src/lib/topics.ts` : lecture des topics (`readTopics`, statuts parsés, unsorted).
- `tests/storage-state.test.ts` : sérialisation de l'état proactif (round-trip JSON, cooldown `skipped`).
- `scripts/check-reference-sync.sh` : détection de dérive des 3 références vs source canonique (optionnel, cf PLAN §11).
- PLAN : correction chemin `.opencode/opencode.jsonc` → `opencode.jsonc` (racine, §9-M0).

## 1.1.0 — 2026-10-13

- Chargement corrigé : auto-discovery `.opencode/plugins/horka-mentor.ts` seule source ; `opencode.jsonc` ne pointe plus vers un fichier.
- Proactif à état persistant (`proactive:<sessionID>` : count/seen/cooldown) ; nouvelle action tool `record_proactive` (`skipped` → cooldown).
- Reminder quiz unique via premier hook `context` (`reminderDone:<sessionID>`), parité Pi sans hook startup.
- Extraction libs pures testables : `memory.ts`, `proactive-policy.ts`, `reminder.ts` (+ 14 tests).
- `src/index.ts` réduit (564 → 269 lignes, wiring + hooks, zéro keyword pédagogique en TS).
- Commande `/mentor-status` (mémoire, Context7, proactif, topics dus).
- Policy Context7 documentée (dur par défaut, `--no-context7` = pseudocode, quiz gate souple, pas de fetch web auto).
