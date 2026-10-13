# opencode-horka-mentor

Mentor pédagogique pour développeurs juniors — port du plugin Claude Code `horka-mentor`
vers Open Code. Runtime bun sur `@opencode/plugin@^2.0.7`.

- 2 skills (5 + 6 étapes), 3 références, 5+ commandes
- 2 modes : `learn` (socratique) et `build` (code ensemble)
- Mode directif pour les sujets sécurité + gate Context7 stricte
- Proactif throttle 2/session, dédup retry-safe, cooldown déterministe
- Spaced repetition J+1 → J+30, cross-stack, détection de régression

> Source : `joey-barbier/ClaudeCode-Plugin/plugins/horka-mentor` → cible Open Code.
> Distribution **GitHub uniquement** (`opencode2 plugin add github:Sokoshy/opencode-horka-mentor`),
> aucun publish NPM requis.

---

## Installation

```sh
opencode2 plugin add github:Sokoshy/opencode-horka-mentor
opencode2 plugin list        # doit afficher horka-mentor
opencode2 service restart
```

### Développement local

```sh
git clone <repo> && cd opencode-horka-mentor
bun install
opencode2 service restart   # auto-découverte via .opencode/plugins/horka-mentor.ts
```

> **Important** : l'auto-découverte suffit. Ne mettez pas `.opencode/plugins/horka-mentor.ts`
> dans `plugins` d'`opencode.jsonc` (sinon « configured plugin path must be a directory »).
> Le `package.json` expose `".": "./src/index.ts"` pour `opencode2 plugin add`.

---

## Configuration (`opencode.jsonc`)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-horka-mentor", // ou "github:Sokoshy/opencode-horka-mentor" / chemin local
      "options": {
        "memoryPath": "~/.config/opencode/mentor",   // défaut global, cross-projets
        "proactive": true,                            // défaut true
        "context7": "https://mcp.context7.com/mcp",   // false pour désactiver le MCP
        "context7ApiKey": "{env:CONTEXT7_API_KEY}",   // optionnel — Bearer header
        "compatClaudePath": false                     // true → fallback lecture ~/.claude/mentor
      }
    }
  ]
}
```

| Option | Rôle |
|---|---|
| `memoryPath` | Dossier mémoire (`dev-profile.md`, `quiz-log.md`, `topics/*.md`). `~` est expansé. Injecté dans les skills via `{{memoryPath}}`. |
| `compatClaudePath` | `true` = lit d'abord `memoryPath`, puis `~/.claude/mentor/` en fallback (migration Claude Code). |
| `context7` / `context7ApiKey` | Déclare le MCP remote Context7 et lui passe la clé Bearer (voir section Context7). |
| `proactive` | Active/désactive l'injection proactif minime. |

`ctx.storage` est un **miroir write-only** — le filesystem reste source de vérité.

---

## Commandes

| Commande | Description |
|---|---|
| `/mentor` | Mode **build** par défaut (code ensemble) |
| `/mentor learn` | Mode **learn** (exploration socratique) |
| `/mentor build` | Alias explicite du mode build |
| `/mentor --no-context7` | Bypass Context7 → warning + pseudocode/concepts uniquement |
| `/mentor proactif on\|off` | Active/désactive le proactif |
| `/mentor profil` | Affiche `dev-profile.md` |
| `/mentor topics` | Liste les topics couverts avec niveaux |
| `/mentor-status` | Diagnostic : mémoire, Context7, proactif, topics dus |
| `/mentor-quiz` / `/quiz` / `/revision` | Spaced repetition (3 topics en retard, ciblé, ou `all`) |

Le skill principal a `autoinvoke: true` — le modèle peut l'invoquer sans commande
(proactif).

---

## Mémoire

```
~/.config/opencode/mentor/        # ou ~/.claude/mentor/ si compat
├── dev-profile.md
├── quiz-log.md
└── topics/
    ├── async-await.md
    └── ...
```

- **Source de vérité** : `topics/<slug>.md` (Status 7 champs + Context + historique).
- **Niveaux** : `unknown → learning → understood → confident`
  (`src/references/level-up-rules.md`).
- **Spaced repetition** : J+1 → J+30 (`interval_step` 1–6).
- **Tool** `horka_mentor_progress` (namespace `horka`) expose : `get_profile`,
  `list_topics`, `get_topic`, `get_quiz_log`, `check_proactive`, `record_proactive`.
- En cas de divergence, le filesystem gagne (storage = cache trace).

Templates dans `src/references/memory-templates.md`.

---

## Context7

- Déclaré automatiquement via `ctx.mcp.transform()` :
  `{type:"remote", url:"https://mcp.context7.com/mcp"}` +
  `Authorization: Bearer …` si clé.
- Ne surcharge pas une config `context7` existante.
- Gate **dur par défaut** : le skill bloque sans Context7 (`MENTOR BLOCKED`), sauf
  `--no-context7` → warning + pseudocode.
- Quiz : gate **souple** → warning `[Context7 indisponible]` → limite à `explain` + APIs natives.
- `context7: false` désactive la déclaration.
- **Le fetch web n'est pas un substitut automatique.**

Test rapide : appeler `context7_resolve-library-id` avec `query:"test"` — le serveur
doit répondre (même sans résultats). Clé gratuite : https://context7.com/dashboard.

---

## Hooks (résumé)

- **`prompt`** (proactif) : throttle 2/session via `ctx.storage` (`proactive:<sessionID>` :
  `count`, `seen`, `cooldown`), dédup par hash du prompt, cooldown après `skip` (via
  `record_proactive`, fallback markdown). Jugement `INTERVENE/NEVER` délégué au modèle.
- **`context`** : injection `[horka-mentor] …` une fois (dédup par marqueur), détection
  dynamique des outils Context7, reminder quiz unique (`reminderDone:<sessionID>`).
- **`compaction`** : injecte topics/levels + `mode` + dernier prompt (`state:<sessionID>`),
  `event.result` laissé au modèle.

---

## Références

- `src/references/pedagogy.md` — 5 méthodes d'évaluation, INTERVENE/COMMENT INLINE/NEVER,
  3 profondeurs, critères ALL/ANY, Security-Critical DIRECTIVE+batch, adaptation
  fast/slow/disengaged, dependency map, Dunning-Kruger, cross-stack, session length.
- `src/references/level-up-rules.md` — table des 6 transitions de niveau.
- `src/references/memory-templates.md` — templates mémoire adaptés aux chemins Opencode.
- Vérification conceptuelle : `scripts/check-reference-sync.sh [canonical_dir]`.

---

## Développement

```sh
bun run typecheck   # tsc --noEmit
bun test            # paths, memory, proactive-policy, reminder, storage-state
opencode2 service status
opencode2 plugin list
```

Compatibilité : `@opencode/plugin@^2.0.7` (testé sur OpenCode v2.0.7, runtime bun).
Tester le package installé, pas uniquement le lien workspace.

---

## Limites connues (v1.1)

- Pas de support multi-utilisateur.
- Pas de dashboard/UI custom.
- Pas de fetch web automatique (gate Context7 dur par défaut).
- Cooldown proactif dépend du modèle appelant `record_proactive` (fallback markdown
  documenté).

*Port du plugin source — 2 skills 5+6 étapes, 3 références, proactif, spaced
repetition, cross-stack, regression, 10+7 règles.*
EOF