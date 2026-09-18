# opencode-horka-mentor

Teaching AI mentor for junior developers — **port à parité 100% du plugin Claude Code `horka-mentor` vers OpenCode 2** (`@opencode/plugin@^2.0.7`, runtime bun). 2 skills complets (5+6 étapes), 3 références, 4 commandes de config, 2 modes learn/build, mode directif sécurité, proactif avec throttle, spaced repetition complet, cross-stack translation, regression detection, 10+7 règles absolues, templates mémoire.

> Source : `joey-barbier/ClaudeCode-Plugin/plugins/horka-mentor` → Cible : OpenCode 2. Distribution **GitHub** (`opencode2 plugin add github:Sokoshy/opencode-horka-mentor`), pas de publish npm.

---

## Installation

### Depuis GitHub (recommandé)

```sh
opencode2 plugin add github:Sokoshy/opencode-horka-mentor
opencode2 plugin list        # doit afficher horka-mentor
opencode2 service restart
```

### Dev local (bun)

```sh
git clone <repo> && cd opencode-horka-mentor
bun install
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
- **`session.hook("compaction")` natif (API v2)** : injecte l'état pédagogique réel (topics/levels via FS, mode + dernier prompt via `state:<sessionID>`) dans `event.system` pour qu'il survive au résumé ; `event.result` n'est pas setté (le modèle résume).

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
bun run typecheck   # tsc --noEmit
bun test
opencode2 service status
opencode2 plugin list
```

Compatibilité : `@opencode/plugin@^2.0.7` (testé sur OpenCode v2.0.7 via `opencode2`, runtime bun). Tester le package installé, pas seulement le lien workspace.

---

*Parité complète avec le plugin source — chaque feature est portée (2 skills 5+6 étapes, 3 références, proactif, spaced repetition, cross-stack, regression, 10+7 règles).*
