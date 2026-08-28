# opencode-horka-mentor

Teaching AI mentor for junior developers — **port à parité 100% du plugin Claude Code `horka-mentor` vers Opencode 2** (`@opencode-ai/plugin@beta`). 2 skills complets (5+6 étapes), 3 références, 4 commandes de config, 2 modes learn/build, mode directif sécurité, proactif avec throttle, spaced repetition complet, cross-stack translation, regression detection, 10+7 règles absolues, templates mémoire.

> Source : `joey-barbier/ClaudeCode-Plugin/plugins/horka-mentor` → Cible : Opencode 2. Distribution **GitHub** (`opencode2 plugin add github:Sokoshy/opencode-horka-mentor`), pas de publish npm. Basé sur `RESEARCH.md` + `PLAN.md`.

---

## Installation

### Depuis GitHub (recommandé)

```sh
opencode2 plugin add github:Sokoshy/opencode-horka-mentor
opencode2 plugin list        # doit afficher horka-mentor
opencode2 service restart
```

### Dev local (sans npm)

```sh
git clone <repo> && cd opencode-horka-mentor
npm install
# Le plugin est auto-découvert via .opencode/plugins/horka-mentor.ts (re-export de src/index.ts)
opencode2 service restart
touch .opencode/plugins/horka-mentor.ts   # force reload si besoin
```

Le `package.json` expose `".": "./src/index.ts"` (`type: module`) pour `opencode2 plugin add`.

---

## Configuration (`opencode.jsonc`)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-horka-mentor", // ou "github:Sokoshy/opencode-horka-mentor" / chemin local
      "options": {
        "memoryPath": "~/.config/opencode/mentor",   // défaut — global, cross-projets
        "proactive": true,                            // défaut true
        "context7": "https://mcp.context7.com/mcp",   // false pour désactiver le MCP
        "context7ApiKey": "{env:CONTEXT7_API_KEY}",   // optionnel — Bearer header, sinon rate limits réduits
        "compatClaudePath": false                     // true → fallback lecture ~/.claude/mentor/ si fichier manquant
      }
    }
  ]
}
```

- `memoryPath` : dossier où sont stockés `dev-profile.md`, `quiz-log.md`, `topics/*.md`. Expand `~`. Les skills reçoivent le chemin résolu via `{{memoryPath}}`.
- `compatClaudePath` : si `true`, le plugin et les skills lisent d'abord `memoryPath`, puis `~/.claude/mentor/` en fallback (migration Claude Code). Hydratation `{{memoryPathFallback}}`.
- `context7` / `context7ApiKey` : voir la section Context7 ci-dessous (comportement, clé API, non-surcharge d'une config existante).

---

## Commandes

Toutes les commandes sont enregistrées via `ctx.command.transform()` et déclenchent les skills via `ctx.session.prompt({skills:[{id}]})`.

| Commande | Description | Skill |
|---|---|---|
| `/mentor` ou `mentor` | Mode **build** par défaut — code ensemble avec explications | horka-mentor |
| `/mentor learn` | Mode **learn** — exploration Socratic complète (2–3 questions, analogie, exemple Context7, exercice) | horka-mentor |
| `/mentor build` | Alias explicite du mode build | horka-mentor |
| `/mentor --no-context7` | Bypass Context7 — warning + pseudocode/concepts génériques uniquement | horka-mentor |
| `mentor learn --no-context7` etc. | Flags combinables | horka-mentor |
| `/mentor proactif on` / `off` | Active/désactive le mode proactif (`proactive_mode` dans `dev-profile.md`) | horka-mentor |
| `/mentor profil` | Affiche le profil actuel (`dev-profile.md`) | horka-mentor |
| `/mentor topics` | Liste les topics couverts avec niveaux | horka-mentor |
| `/mentor-quiz` | Spaced repetition — 3 topics les plus en retard (`next_review <= today`) | horka-mentor-quiz |
| `/mentor-quiz <topic>` | Quiz ciblé (même si pas dû) | horka-mentor-quiz |
| `/mentor-quiz all` | Revue complète de tous les topics | horka-mentor-quiz |
| `/quiz` | Alias de `/mentor-quiz` | horka-mentor-quiz |
| `/revision` | Alias de `/mentor-quiz` | horka-mentor-quiz |

Le skill principal a `autoinvoke: true` — le modèle peut l'invoquer spontanément hors `/mentor` (proactif).

---

## Mémoire

```
~/.config/opencode/mentor/          # ou ~/.claude/mentor/ si compat
├── dev-profile.md
├── quiz-log.md
└── topics/
    ├── async-await.md
    ├── jwt-authentication.md
    └── ...
```

- **Source de vérité** : `topics/<slug>.md` (Status 7 champs + Context + Teaching/Assessment History). `quiz-log.md` = index de convenance.
- **Niveaux** : `unknown → learning → understood → confident` (voir `src/references/level-up-rules.md`).
- **Spaced repetition** : échelle J+1→J+30 (`interval_step` 1–6) — voir le skill `src/skills/horka-mentor-quiz.md` et `src/references/level-up-rules.md`.
- **Tool** `horka_mentor_progress` (namespace `horka` → nom effectif `horka_mentor_progress`) expose :
  - `get_profile` → `dev-profile.md`
  - `list_topics` → scan `topics/` + parse Status
  - `get_topic` → `topics/<slug>.md`
  - `get_quiz_log` → `quiz-log.md`
  - `check_proactive` → résumé profil + topics pour jugement INTERVENE (le jugement reste au modèle, pas de keywords TS)
- Filesystem = source de vérité unique ; `ctx.storage` est utilisé en **miroir write-only (cache)** — en cas de divergence, FS gagne.

Templates : `src/references/memory-templates.md` (adapté chemins Opencode).

---

## Context7

- Déclaré automatiquement via `ctx.mcp.transform()` : `{type:"remote", url:"https://mcp.context7.com/mcp"}` (+ `headers.Authorization` si clé). `context7: false` dans les options désactive la déclaration.
- Ne surcharge pas une config `context7` existante (préserve son auth).
- Skills : **Step 0 Gate MANDATORY** (`horka-mentor` bloque sans Context7 avec `MENTOR BLOCKED`, sauf `--no-context7` → warning + pseudocode ; `horka-mentor-quiz` gate souple → warning `[Context7 indisponible]` et limite à `explain` + APIs natives).
- Tools exposés : `context7_resolve-library-id` / `context7_query-docs` (alias `mcp_context7_…` selon version Opencode — les skills tentent les candidats, et le hook `context` injecte les noms exacts détectés dans `event.tools`). Test rapide : appeler `context7_resolve-library-id` avec `query:"test"` — doit répondre (même sans résultats).
- Clé API optionnelle : ajoutée en header `Authorization: Bearer …` (sinon serveur fonctionnel mais rate-limité). Obtenir une clé gratuite : https://context7.com/dashboard → `CONTEXT7_API_KEY`.

---

## Hooks

- **`session.hook("prompt")` proactif minimaliste** : injection d'un préfixe système léger si la requête implique un concept non couvert — throttle 2/session, idempotence retry-safe via `sessionID+hash(prompt)` + `ctx.storage` (`proactive:<sessionID>`), cooldown après `skip`. Le jugement INTERVENE est délégué au modèle (skill `autoinvoke` + tool `check_proactive`), pas de détection keywords TS.
- **`session.hook("context")` avec dédup** : si session mentor active (`active:<sessionID>`), injecte un rappel système `[horka-mentor] …` une seule fois (dédup par marqueur), y compris détection dynamique des noms d'outils Context7 présents dans `event.tools`.
- **`experimental.session.compacting` (best-effort)** : tente d'enregistrer le hook de compaction pour préserver l'état pédagogique (topics/levels/mode/question) dans `output.context` ; si non supporté sur cette version beta, le `context` hook + l'état FS assurent la continuité (non bloquant).

---

## Références

- `src/references/pedagogy.md` — copie 1:1 du source (9 142 B) : 5 méthodes assessment, INTERVENE/COMMENT INLINE/NEVER, 3 profondeurs, critères ALL/ANY, Security-Critical DIRECTIVE+batch, adaptation fast/slow/disengaged, dependency map 17 entrées, Dunning-Kruger, cross-stack, session length.
- `src/references/level-up-rules.md` — 1:1 (2 347 B) : table 6 transitions + cas inline/skip/3 missed/needs-reteach/bridge.
- `src/references/memory-templates.md` — adapté chemins Opencode + note `memoryPath`/`compatClaudePath`.

Les skills lisent ces fichiers via `{{referencesDir}}/…` (hydraté en chemin absolu à l'enregistrement).

---

## Troubleshooting Context7

Le comportement et les correctifs (`MENTOR BLOCKED`, bypass `--no-context7`, gate souple du quiz, test d'un appel réel) sont décrits dans la section Context7 ci-dessus. Après install ou changement de config : `opencode2 service restart`.

---

## Développement

```sh
npm run typecheck   # npx tsc --noEmit
opencode2 service status
opencode2 plugin list
```

Compatibilité : `@opencode-ai/plugin@beta` (actuel : `0.0.0-beta-18414`). Tester le package installé, pas seulement le lien workspace (API beta).

---

*Parité complète — chaque feature de `RESEARCH.md` §1.3–1.5 est portée (mapping exhaustif `PLAN.md` §1).*
