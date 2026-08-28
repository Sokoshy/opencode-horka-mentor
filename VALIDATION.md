# VALIDATION — Matrice T6 (parité)

Checklist de validation finale du plan (PLAN.md, Phase 6). **Exit : 15/15 tests passent, parité déclarée.**

Deux catégories :

- **Tests unitaires** (helpers purs) — automatisés, lancés via :

  ```sh
  node --test tests/
  ```

  (Node 26.8.1 : type-stripping TS actif par défaut — pas besoin de `--experimental-strip-types`. Fonctionne aussi avec le flag sur Node ≥ 22.6 : `node --test --experimental-strip-types tests/`.)

- **Tests fonctionnels T6.1–T6.3** — tests **manuels en session** à exécuter selon les tickets PLAN.md (mentoring réel, quiz réel, install réelle). Actuellement **non cochés**.

## Tests unitaires — helpers purs (`tests/helpers.test.ts`)

- [x] `expandPath('~')` → `homedir()` (11/11 pass — `node --test tests/`)
- [x] `expandPath('~/foo/bar')` → `homedir()/foo/bar`
- [x] `expandPath` chemin absolu inchangé
- [x] `expandPath` chemin relatif / entrée vide / `~foo` inchangés
- [x] `parseStatusField` champ trouvé → valeur trimée
- [x] `parseStatusField` champ absent → `undefined`
- [x] `parseStatusField` whitespace supplémentaire trimé
- [x] `parseStatusField` contenu multiline — ligne correspondante isolée
- [x] `parseStatusField` pas de match sur préfixe partiel (`Level` ≠ `LevelUp` — comportement réel du regex vérifié et asserté)

## T6.1 — Tests fonctionnels mentor (8 tests)

- [ ] 1. Cold start 4 questions → `dev-profile.md` conforme template
- [ ] 2. BUILD 1 question max → code `// Why:` par blocs, maj `unknown→learning`
- [ ] 3. LEARN 2–3 questions → analogie+Context7 minimal→complexe+exercice
- [ ] 4. Prérequis backstep 2 niveaux + bridge 3e niveau
- [ ] 5. Pushback `je connais` → re-ancre predict
- [ ] 6. `--no-context7` → warning + pseudocode seul
- [ ] 7. DIRECTIF `auth JWT` (batch 4 lookups) → vulnérable→secure+quiz, `unknown→understood` si solid
- [ ] 8. `proactif on/off`, `profil`, `topics`, `skip`→`needs-revisit`, cross-stack, regression

## T6.2 — Tests fonctionnels quiz (7 tests)

- [ ] 1. Gate souple sans Context7 (warning, que `explain`)
- [ ] 2. Spaced `next_review<=today` → 3 plus en retard
- [ ] 3. Ciblé `mentor-quiz async` (trouvé/pas trouvé)
- [ ] 4. `all` tous topics
- [ ] 5. Évaluation `solid/shaky/missed` → levels + `next_review` (`J+1→J+3→J+7→J+14→J+30`, `shaky` garde, `missed` reset, 3 missed→`needs-reteach` J+3)
- [ ] 6. `interval_step` 1–6 tracké
- [ ] 7. Bilan `BILAN QUIZ` + `à revoir avec /mentor`

## T6.3 — Tests système

- [ ] Install Git : `opencode2 plugin add github:<user>/opencode-horka-mentor` dans un projet vierge
- [ ] `aube pack` → install depuis le tarball (test secondaire)
- [ ] `opencode2 plugin list` OK
- [ ] `touch .opencode/plugins/…` reload OK
- [ ] `opencode2 service restart` OK
- [ ] Appel réel d'un tool Context7 depuis une session OK
- [ ] Tool progress appelable par l'agent (via log d'exécution ou mini-session de test)
