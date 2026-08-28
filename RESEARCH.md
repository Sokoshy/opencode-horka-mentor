# Recherche : Adapter horka-mentor (Claude Code) → Opencode 2

> Date : 2026-08-28
> Source : https://github.com/joey-barbier/ClaudeCode-Plugin/tree/main/plugins/horka-mentor
> Cible : Opencode 2 (beta, `opencode2` binaire, `@opencode-ai/plugin@beta`)

---

## 1. Plugin source — horka-mentor (Claude Code)

### 1.1 Inventaire (7 fichiers, plugin 100% Skills)

Source primaire : `GET /repos/joey-barbier/ClaudeCode-Plugin/contents/plugins/horka-mentor` + arbre git récursif `80662be` + `raw.githubusercontent.com` — tous 200.

```
plugins/horka-mentor/
├── .claude-plugin/plugin.json
├── README.md
└── skills/
    ├── horka-mentor/
    │   ├── SKILL.md              (16 742 B)
    │   └── references/
    │       ├── pedagogy.md       (9 142 B)
    │       ├── memory-templates.md (3 599 B)
    │       └── level-up-rules.md (2 347 B)
    └── horka-mentor-quiz/
        └── SKILL.md              (8 976 B)
```

- Aucun `hooks/`, `agents/`, `commands/`, `scripts/` — vérifié via API + arbre. Contrairement à ses voisins `horka-review` (hook `PreToolUse` + `scripts/review-guard.sh`) ou `horka-dev-workflow`, le mentor est purement déclaratif.
- Dépendance dure : **serveur MCP Context7** (`mcp__plugin_context7_context7__resolve-library-id`). Sans lui le mentor refuse de démarrer.

Source : `plugins/horka-mentor/.claude-plugin/plugin.json` (raw) :
```json
{
  "name": "horka-mentor",
  "version": "1.0.0",
  "description": "Teaching AI mentor for junior developers...",
  "author": {"name": "Orka"},
  "keywords": ["mentor","teaching","junior","learning","pedagogy","quiz","onboarding","skills","progression","context7"],
  "skills": "./skills/"
}
```

### 1.2 Ce que fait le plugin

**Philosophie** (README) : Claude Code est trop puissant — les juniors obtiennent du code sans apprendre. Le mentor *enseigne pendant qu'on code* au lieu de coder à leur place.

| Fonction | Détail |
|---|---|
| Détection | Analyse profil + requête pour isoler les concepts nouveaux |
| Évaluation | Questions ouvertes uniquement (prédire output, spot the bug, expliquer) — jamais oui/non (anti-gaming) |
| Enseignement | Analogies + doc officielle Context7 + exercices **avant** de coder |
| Construction pas-à-pas | Explique les décisions, vérifie la compréhension à chaque bloc |
| Suivi | `~/.claude/mentor/` avec niveaux `unknown → learning → understood → confident` par topic |
| Quiz | Spaced repetition `J+1 → J+3 → J+7 → J+14 → J+30 → tous les 30j` |
| Adaptation | Langue, vitesse d'apprentissage, stacks antérieures (traduction cross-stack), mode directif pour sécurité |

### 1.3 Skill `horka-mentor` (principal)

Frontmatter : `name: horka-mentor`, `allowed-tools: ["Read","Write","Edit","Glob"]`, invoqué par `mentor`, `mentor learn`, `mentor build`, ou auto-déclenchement proactif.

**Workflow en 5 étapes** (source : `skills/horka-mentor/SKILL.md`) :

0. **Context7 Gate (MANDATORY)** — appelle `mcp__plugin_context7_context7__resolve-library-id` avec `query:"test"`. Si absent → bloque avec message `MENTOR BLOCKED — Context7 required` + lien `https://github.com/upstash/context7`. Bypass `--no-context7` → warning + limité au pseudocode/concepts génériques, jamais d'API framework.

1. **Cold Start** — check `~/.claude/mentor/dev-profile.md`. Si absent → détecte la langue, pose 4 questions (prénom, langue, expérience, stack actuelle), crée le profil depuis `references/memory-templates.md` (domaines `not-assessed`, préférence `build`, proactif `enabled`). Si existe → charge et continue dans la langue sauvegardée.

2. **Mode Selection**
   - Explicite : `/mentor learn` → learn, `/mentor build` ou `mentor` → build (défaut), flag `--no-context7` combinable.
   - Proactif (si `proactive_mode: enabled`) : intercepte les requêtes de code directes, consulte `dev-profile.md` + `topics/`, vérifie liste `INTERVENE` de `pedagogy.md`, vérifie pas `confident (<30j)`, affiche `[MENTOR] … question ouverte (skip|/mentor proactif off)`. Throttle : max 2/session, cooldown après `skip`, jamais sur concepts triviaux.
   - Config : `/mentor proactif on/off`, `/mentor profil`, `/mentor topics`.

3. **Concept Analysis** — identifie les concepts, consulte `topics/`, classe (`confident<30j`→skip, `understood`→light check en learn, `learning`→intervient, `unknown`→full). Vérifie les prérequis via la dependency map de `pedagogy.md`, backstep max 2 niveaux (bridge 1 phrase au-delà, crée `unknown`+`bridge-given`, pas `learning`). Budget : 1 question/concept en BUILD (max 2 si backstep), séparé. Pushback (`je connais`) → re-ancre en predict/spot-bug, laisse la réponse parler.

4. **Teaching (adaptatif au mode)**
   - **BUILD** : 1 question max → code incrémental avec commentaires WHY → checkpoints adaptatifs (pour `fast` : questions implicites) → `unknown→learning` ou `learning→understood` si solide → planifie `quiz-log.md` J+1.
   - **LEARN** : 2–3 questions, analogie+explication+exemple Context7 (minimal→complexe)+exercice, guide le dev (`quelle est la prochaine étape ?`), indices après 2 tours bloqués.
   - **Security-Critical OVERRIDE (DIRECTIF)** : auth/crypto/validation/XSS etc. → enseigne d'abord, montre vulnérable→secure via Context7 (batch lookups upfront pour sujets composés comme JWT), quiz `pourquoi dangereux ?`, puis build. En LEARN remplace étapes 1-2, en BUILD remplace la question initiale. Permet `unknown→understood` direct si quiz solide.

5. **Memory Management** — maj `topics/<slug>.md`, `quiz-log.md` (`next_review` J+1), `dev-profile.md`. Règles de level-up depuis `level-up-rules.md`. Source de vérité = fichiers topic, `quiz-log` = index.

**10 règles absolues** : jamais oui/non, jamais d'API framework sans Context7, jamais condescendant, max 1 question en build, toujours maj mémoire, toujours vérifier la doc, toujours respecter skip (`needs-revisit`), profil privé, commentaires code en anglais, topics font foi.

### 1.4 Skill `horka-mentor-quiz` (révision)

Frontmatter : `name: horka-mentor-quiz`, invoqué par `mentor quiz`, `quiz`, `revision`… Ne s'utilise pas si `topics/` vide.

Workflow en 6 étapes (source : `skills/horka-mentor-quiz/SKILL.md`) :

0. Context7 Gate **souple** — si absent → continue avec warning, limité à `explain` + APIs natives.
1. Prerequisites — vérifie `dev-profile.md` sinon `Lance /mentor d'abord`, scanne `topics/` sinon message vide.
2. Mode — `/mentor-quiz` (sans arg) → spaced repetition (filtre `next_review <= today`, 3 plus en retard) ; `/mentor-quiz <topic>` → ciblé ; `/mentor-quiz all` → tous.
3. Question Generation — type adapté au level (`learning→predict/spot`, `understood→explain`, `confident→edge case`), évite répétition via Teaching History, Context7 pour le code. Format `QUIZ — [Concept] ([level])` + question ouverte + `Prends ton temps`.
4. Évaluation — `solid` (correct+pourquoi) → `Correct.` ; `shaky` (partiel) → `Presque.` ; `missed` (faux) → `Pas tout à fait.` + propose `/mentor`.
5. Memory Update (mandatory) — maj topic (Assessment History + level selon table `solid→up`, `missed→down`, `shaky→stay`), `last_assessed`, recalcule `next_review` (`solid→avance palier`, `shaky→garde`, `missed→reset J+1`, après 3 `missed` consécutifs → `needs-reteach`, intervalle J+3, `interval_step` 1–6 tracking), maj `quiz-log.md` et profil si besoin.
6. Bilan — `BILAN QUIZ — [date]` par topic avec `next review`, liste `à revoir avec /mentor` si missed.

### 1.5 References

- **`pedagogy.md`** — 5 méthodes d'assessment (Predict Output préférée, Spot Bug, Explain, MCQ dernier recours, Practical Implementation la plus forte), seuil INTERVENE (concurrency, auth, DB tx, security, patterns, networking… ) vs COMMENT INLINE (méthodes array, CSS…) vs NEVER (naming, style…), 3 niveaux de profondeur (Inline / Brief / Full), critères d'intervention (ALL) / non-intervention (ANY), section Security-Critical (DIRECTIVE, batch Context7), adaptation vitesse, dependency map (17 entrées : WebSockets→HTTP+async, async→Promises→callbacks…), gestion Dunning-Kruger, cross-stack translation (ex: `Express middleware = SwiftUI ViewModifier`), limite 3–4 fondations/session LEARN.
- **`memory-templates.md`** — stockage global `~/.claude/mentor/` : `dev-profile.md` (Identité + Domains `speed: fast|moderate|slow|not-assessed` + Notes), `topics/<slug>.md` (Status Level/First seen/Last assessed/Next review/Interval step/Assessment count/Consecutive miss + Context + Teaching History + Assessment History), `quiz-log.md` (Upcoming Reviews table + History), diagramme arborescence.
- **`level-up-rules.md`** — table `unknown→learning` (enseigné+partiel), `unknown→understood` (DIRECTIVE solid), `learning→understood` (solid), `understood→confident` (spaced solid ou practical), `confident→understood` (missed), `understood→learning` (2 shaky consécutifs), cas inline/skip/3 missed→`needs-reteach`/bridge.

### 1.6 Mémoire & progression

- Localisation : `~/.claude/mentor/` (global, cross-projets, privé).
- Fichiers : `dev-profile.md`, `quiz-log.md`, `topics/*.md`.
- Niveaux par topic (pas global) : `unknown → learning → understood → confident`.

---

## 2. Système de plugins Opencode 2

Sources primaires : `https://opencode.ai/v2/docs/build/plugins`, `https://opencode.ai/v2/docs/plugins`, `https://opencode.ai/v2/docs/build/plugins/cli`, `https://opencode.ai/v2/docs/build/plugins/effect`, `https://opencode.ai/config.json` — tous 200. Vérifié manuellement.

### 2.1 Pas de `plugin.json` — tout est `package.json` + `Plugin.define()`

Opencode 2 n'utilise **pas** de manifest `plugin.json`/`marketplace.json`. La distribution est **npm** (ou spec Git) + chemins locaux.

```jsonc // package.json minimal — source : /v2/docs/build/plugins
{
  "name": "opencode-horka-mentor",
  "version": "1.0.0",
  "type": "module",            // REQUIS : ESM
  "exports": {
    ".": "./src/index.ts"       // .ts direct, Bun transpile
  },
  "dependencies": {
    "@opencode-ai/plugin": "beta"
  }
}
```

### 2.2 Découverte & chargement

**Auto-discovery** (sans config) — source : `/v2/docs/plugins` :

```
.opencode/
└── plugins/
    ├── horka-mentor.ts          // auto-chargé
    └── horka-mentor/            // package immédiat aussi auto-chargé
~/.config/opencode/plugins/      // même layout global
```

Attention : un dossier `plugins/` à côté d'un `opencode.jsonc` à la racine **n'est pas** auto-découvert — doit être sous `.opencode/` ou déclaré explicitement.

**Explicite dans `opencode.jsonc`** (fusion low→high : `~/.config/opencode/opencode.jsonc` → `./opencode.jsonc` → `./.opencode/opencode.jsonc`, append pas replace) :

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-horka-mentor",
    "opencode-horka-mentor@1.2.0",
    "./plugins/horka-mentor.ts",
    { "package": "opencode-horka-mentor", "options": { "proactive": true } }
  ]
}
```

Filtrage : préfixe `-` pour désactiver, `*` wildcard, `.*` préfixe, la dernière entrée gagne.

Installation globale : `opencode2 plugin add opencode-horka-mentor@1.2.0` / `opencode2 plugin list` / `opencode2 plugin remove …` — accepte `npm`, `github:`, `git+ssh://`, `::path:`.

### 2.3 Squelette `Plugin.define()`

Source : `/v2/docs/build/plugins` — Promise (courant), Effect, et TUI.

```ts
// src/index.ts — Promise
import { Plugin } from "@opencode-ai/plugin"

export default Plugin.define({
  id: "horka-mentor",
  async setup(ctx) {
    console.log(`loaded in ${ctx.app.version} at ${ctx.location.directory}`)
    await ctx.storage.set("loaded", true)
    const opts = ctx.options // depuis opencode.jsonc {options:{}}
    return () => console.log("unloaded")
  },
})
```

```ts
// Effect — source : /v2/docs/build/plugins/effect
import { Plugin } from "@opencode-ai/plugin/effect"
import { Effect } from "effect"
export default Plugin.define({
  id: "horka-mentor",
  effect: (ctx) => Effect.gen(function*(){
    yield* ctx.storage.set("loaded", true)
    yield* Effect.addFinalizer(()=> Effect.logInfo("unloaded"))
  })
})
```

`ctx` = client serveur + extras plugin : `ctx.app`, `ctx.location`, `ctx.options`, `ctx.storage`, `ctx.catalog`, `ctx.agent`, `ctx.command`, `ctx.skill`, `ctx.mcp`, `ctx.reference`, `ctx.session`, `ctx.permission`, `ctx.shell`, `ctx.tool`, `ctx.event`, `ctx.generate`, etc. — tous documentés dans `/v2/docs/build/plugins#API`.

### 2.4 Transforms (pattern central)

Source : `/v2/docs/build/plugins#Transforms` — mutations synchrones rejouées dans l'ordre des plugins.

```ts
// Exemple : enregistrer des skills
await ctx.skill.transform((draft) => {
  draft.add({
    id: "horka-mentor",
    name: "Horka Mentor",
    description: "Teaching AI mentor — modes learn/build, suivi par topic, quiz spaced repetition. Invoque par /horka-mentor ou 'mentor'.",
    location: "/workspace/.opencode/plugins/horka-mentor/skills/horka-mentor.md",
    content: "...contenu du SKILL.md...",
    autoinvoke: false,
  })
  draft.add({
    id: "horka-mentor-quiz",
    name: "Horka Mentor Quiz",
    description: "Quiz spaced repetition sur les topics couverts. Invoque par /horka-mentor-quiz.",
    location: "...",
    content: "...",
  })
})

// Agents, commands, tools, mcp, references, catalog, vcs, websearch — même pattern
await ctx.command.transform((draft) => {
  draft.add({ name: "mentor", description: "…", execute: async ({sessionID, prompt, delivery}) => {
    await ctx.session.prompt({ sessionID, text: `…`, delivery })
  }})
})
await ctx.tool.transform((draft) => {
  draft.add({ name: "mentor_progress", description: "…", input: {type:"object",…}, execute: async (input, toolCtx) => ({content: "…"}) })
})
await ctx.mcp.transform((draft) => {
  draft.set("context7", { type: "remote", url: "https://mcp.context7.com/mcp" })
})
```

`reload()` rejoue les transforms après changement d'état externe. `registration.dispose()` retire un transform.

Signatures complètes — source : `/v2/docs/build/plugins#API` :

```ts
interface SkillDraft   { list(): SkillInfo[]; add(s: SkillInfo): void; update(id, fn): void; remove(id): void }
interface CommandDraft { add(d: CommandDefinition): void }
interface ToolDraft    { list(); get(id); add(t: ToolInfo): void; update(id, fn): void; remove(id): void }
interface MCPDraft     { list(); get(name); set(name, config): void; update(name, fn): void; remove(name): void }
```

### 2.5 Hooks (interception d'opérations live)

Source : `/v2/docs/build/plugins#Hooks` — exécutés dans l'ordre des plugins, le suivant voit les modifs du précédent.

```ts
// Session : prompt (avant admission inbox), context (avant dispatch modèle), model.request, http.request/response
await ctx.session.hook("prompt", (e) => {
  e.prompt.text = e.prompt.text.replaceAll("…", "…")
  e.prompt.files?.push({ uri: "file:///…" })
})
await ctx.session.hook("context", (e) => {
  e.system.push({ text: "Tu es un mentor pédagogique…" })
  e.generation.temperature = 0.2
})

// Permission : allow/ask (deny est final, n'appelle pas le hook)
await ctx.permission.hook("evaluate", async (e) => {
  if (e.action === "write") { e.effect = "ask"; e.message = "Validation mentor requise" }
})

// Shell & Tools
await ctx.shell.hook("create.before", (e) => { e.env.MENTOR_ACTIVE = "1" })
await ctx.tool.hook("execute.before", (e) => { if (e.tool === "write") console.log(e.input) })
await ctx.tool.hook("execute.after", (e) => { if (e.status === "completed") … })
```

### 2.6 Storage (JSON durable, scopé par plugin)

Source : `/v2/docs/build/plugins#Storage`

```ts
await ctx.storage.set("settings", { strict: true })
const v = await ctx.storage.get("settings")
await ctx.storage.remove("settings")
const page = await ctx.storage.scan({ prefix: "topics/", limit: 100 })
```

Clés préfixées, pagination par curseur. Alternative au filesystem `~/.claude/mentor/` pour Opencode — voir §3.4.

### 2.7 CLI (TUI) plugins

Source : `/v2/docs/build/plugins/cli` — séparés, via `import { Plugin } from "@opencode-ai/plugin/tui"`, Solid + OpenTUI. Non nécessaire pour horka-mentor (pas d'UI).

### 2.8 État actuel du workspace cible

- `/home/sokoslay/Documents/Projects/Opencode/Plugins/mentor` : **vide** (0 entrées, créé 2026-08-28).
- Parent `Plugins/` : ne contient que `mentor`.
- Config globale `~/.config/opencode/opencode.json` : `{"$schema":"https://opencode.ai/config.json","theme":"system","autoupdate":false}` — pas de `plugins` configurés.
- `~/.config/opencode/plugins/` : n'existe pas encore.

---

## 3. Plan d'adaptation — mapping Claude Code → Opencode 2

### 3.1 Correspondance des concepts

| Claude Code | Opencode 2 | Notes |
|---|---|---|
| `.claude-plugin/plugin.json` | `package.json` (`name`, `version`, `type:module`, `exports`, `dependencies: @opencode-ai/plugin@beta`) | Pas de marketplace Opencode — npm/Git |
| `skills/` (markdown) | `ctx.skill.transform()` **ou** fichiers `~/.config/opencode/skills/` / `.opencode/skills/` | Recommandé : plugin enregistre les skills via transform pour un package auto-contenu |
| `agents/` | `ctx.agent.transform()` ou `~/.config/opencode/agents/` | Non utilisé par horka-mentor (pas d'agents) |
| `hooks/hooks.json` (PreToolUse…) | `ctx.session.hook()`, `ctx.permission.hook()`, `ctx.tool.hook()` | Horka-mentor n'a pas de hooks natifs — l'interception proactive devient un `session.hook("prompt")` |
| `commands/` | `ctx.command.transform()` ou `~/.config/opencode/commands/` | Les `/mentor …` deviennent des commands Opencode |
| Serveur MCP Context7 (`mcp__plugin_context7_…`) | `ctx.mcp.transform()` (déclare `context7` remote) + `ctx.tool` exposant `context7_resolve` / `ctx.websearch` | Opencode gère MCP côté serveur ; le skill vérifie la dispo via `ctx.mcp.list()` ou tente l'outil |
| `~/.claude/mentor/` (filesystem) | `ctx.storage` (recommandé) **ou** `~/.config/opencode/mentor/` filesystem (migration simple) | `ctx.storage` est portable et scopé par plugin ; filesystem garde la compatibilité Claude Code |
| `allowed-tools: [Read,Write,Edit,Glob]` | `ctx.tool` + `ctx.session.hook("context")` pour injecter instructions système | Les skills Opencode n'ont pas de `allowed-tools` frontmatter — c'est le plugin qui expose les outils |

### 3.2 Architecture recommandée pour `opencode-horka-mentor`

```
opencode-horka-mentor/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # Plugin.define() — enregistre skills/commands/tools/mcp + hook proactif
│   ├── skills/
│   │   ├── horka-mentor.md      # SKILL.md adapté (chemins Opencode, Context7 via MCP Opencode)
│   │   └── horka-mentor-quiz.md
│   ├── references/
│   │   ├── pedagogy.md          # copié tel quel (logique pédagogique inchangée)
│   │   ├── memory-templates.md  # adapté : chemins storage vs filesystem
│   │   └── level-up-rules.md    # inchangé
│   └── storage/
│       ├── profile.ts           # CRUD dev-profile via ctx.storage (ou fs)
│       ├── topics.ts            # CRUD topics/<slug>.md
│       └── quiz-log.ts
├── .opencode/
│   └── plugins/
│       └── horka-mentor.ts      # alternative dev local (même code que src/index.ts)
└── README.md
```

**Option locale rapide** (sans npm) : un seul fichier `.opencode/plugins/horka-mentor.ts` avec `Plugin.define()` suffit pour tester en dev — Opencode le charge automatiquement.

### 3.3 Détail de `src/index.ts`

```ts
import { Plugin } from "@opencode-ai/plugin"
import mentorSkill from "./skills/horka-mentor.md" with { type: "text" }
import quizSkill from "./skills/horka-mentor-quiz.md" with { type: "text" }

export default Plugin.define({
  id: "horka-mentor",
  async setup(ctx) {
    // 1. Skills — les deux skills du plugin source
    await ctx.skill.transform((draft) => {
      draft.add({
        id: "horka-mentor",
        name: "Horka Mentor",
        description: "Teaching AI mentor for junior devs. Modes learn/build, proactive detection, spaced repetition. Invoke: mentor, mentor learn, mentor build.",
        location: `${ctx.location.directory}/src/skills/horka-mentor.md`,
        content: mentorSkill,
      })
      draft.add({
        id: "horka-mentor-quiz",
        name: "Horka Mentor Quiz",
        description: "Quiz spaced repetition on covered topics. Invoke: mentor quiz, quiz, revision.",
        location: `${ctx.location.directory}/src/skills/horka-mentor-quiz.md`,
        content: quizSkill,
      })
    })

    // 2. Commands — alias slash pour compatibilité /mentor
    await ctx.command.transform((draft) => {
      for (const name of ["mentor", "mentor-quiz"]) {
        draft.add({
          name,
          description: name === "mentor" ? "Mentor pédagogique (learn/build/profil/topics)" : "Quiz spaced repetition",
          execute: async ({ sessionID, prompt, delivery }) => {
            await ctx.session.prompt({ sessionID, prompt, delivery })
          },
        })
      }
    })

    // 3. MCP Context7 — déclare le serveur pour que ctx.mcp.list() le voie
    //    Laisse l'utilisateur surcharger via opencode.jsonc ; ne force pas si déjà présent
    await ctx.mcp.transform((draft) => {
      if (!draft.get("context7")) {
        draft.set("context7", { type: "remote", url: "https://mcp.context7.com/mcp" } as any)
      }
    })

    // 4. Hook proactif — remplace l'interception "prompt-level" du SKILL.md
    //    Le SKILL.md décrit déjà la logique proactive ; ce hook la rend automatique côté serveur
    await ctx.session.hook("prompt", async (event) => {
      // Optionnel : si ctx.options.proactive === false, ne rien faire
      // Sinon, injecter un rappel système si le prompt implique un concept INTERVENE non maîtrisé
      // Léger : ne bloque pas, ajoute un préfixe système via event.prompt.text ou via context hook
      // Le SKILL.md reste la source de vérité pédagogique — le hook ne fait que déclencher
    })

    // 5. (Optionnel) Tool de progression pour que l'agent puisse lire/écrire le storage
    await ctx.tool.transform((draft) => {
      draft.add({
        name: "mentor_progress",
        description: "Lit/écrit la progression mentor (profil, topics, quiz-log).",
        input: { type: "object", properties: { action: { type: "string", enum: ["get_profile","list_topics","get_topic"] }, topic: { type: "string" } }, required: ["action"] },
        options: { namespace: "horka" },
        execute: async (input: any) => {
          const action = input.action as string
          if (action === "get_profile") return { content: JSON.stringify(await ctx.storage.get("dev-profile") ?? null) }
          if (action === "list_topics") {
            const page = await ctx.storage.scan({ prefix: "topics/" })
            return { content: JSON.stringify(page.entries) }
          }
          if (action === "get_topic") return { content: JSON.stringify(await ctx.storage.get(`topics/${input.topic}`) ?? null) }
          return { content: "unknown action" }
        },
      })
    })
  },
})
```

### 3.4 Stockage — deux options

| Option | Avantage | Inconvénient |
|---|---|---|
| **A. `ctx.storage`** (recommandé Opencode) | Scopé par plugin, JSON durable, `scan()` avec préfixe, pas de chemin hardcodé, portable | Incompatible direct avec `~/.claude/mentor/` existant ; migration nécessaire |
| **B. Filesystem `~/.config/opencode/mentor/` ou `~/.claude/mentor/`** | Migration zéro — les SKILL.md gardent leurs chemins `~/.claude/mentor/` ; partage avec Claude Code | Chemins hardcodés, pas portable, nécessite `Read/Write` tools |

**Recommandation** : **B pour v1** (adapter les SKILL.md en changeant juste `~/.claude/mentor/` → `~/.config/opencode/mentor/` ou garder `~/.claude/` pour compat), **A en v2** avec un outil `horka_mentor_progress` qui abstrait le backend. Le plus simple pour démarrer : garder les SKILL.md quasi inchangés et ne changer que le chemin mémoire.

### 3.5 Adaptations des SKILL.md

Changements minimaux requis (diff) :

- **Step 0 Context7 Gate** : `mcp__plugin_context7_context7__resolve-library-id` → vérifier `ctx.mcp.list()` côté plugin, mais côté skill garder l'appel outil `context7_resolve-library-id` (Opencode expose les outils MCP sous le même nom). Ajouter note : `Vérifie via horka_mentor_progress ou mcp_context7_resolve-library-id`.
- **Chemins mémoire** : `~/.claude/mentor/` → `~/.config/opencode/mentor/` (ou `ctx.storage` si option A). Mettre à jour `memory-templates.md` en conséquence.
- **Frontmatter skills** : Opencode utilise `ctx.skill.transform({id, name, description, location, content})` — pas de `allowed-tools` dans le markdown. Retirer ou ignorer ce champ (Opencode ne le lit pas).
- **Invocation** : `/mentor` et `/mentor-quiz` deviennent `ctx.command` + skills. Garder les mêmes triggers textuels (`mentor`, `mentor learn`, `quiz`).
- **Proactive** : compléter par `ctx.session.hook("prompt")` côté plugin (optionnel v1, le skill seul suffit comme en Claude Code).

Tout le reste (pédagogie, spaced repetition, levels, 10 règles, dependency map) est **transportable tel quel** — c'est de la logique prompt, pas du code.

### 3.6 `package.json` cible

```json
{
  "name": "opencode-horka-mentor",
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@opencode-ai/plugin": "beta" },
  "devDependencies": { "typescript": "^5.9.0", "bun-types": "latest" }
}
```

Alternative sans build : pas de `package.json` — un seul fichier `.opencode/plugins/horka-mentor.ts` avec `import { Plugin } from "@opencode-ai/plugin"` suffit.

### 3.7 Installation & test

```sh
# Dev local (sans npm)
mkdir -p .opencode/plugins
cp src/index.ts .opencode/plugins/horka-mentor.ts
# Opencode le charge automatiquement au prochain démarrage
touch .opencode/plugins/horka-mentor.ts  # force reload
opencode2 service restart                  # si besoin

# Package npm (distribution)
bun add @opencode-ai/plugin@beta
bun run build  # si tsc
npm publish    # ou bun publish
opencode2 plugin add opencode-horka-mentor
opencode2 plugin list
```

Config `opencode.jsonc` :
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "opencode-horka-mentor", "options": { "proactive": true, "memoryPath": "~/.claude/mentor" } }
  ]
}
```

### 3.8 Risques & points d'attention

- **API beta** — `@opencode-ai/plugin@beta` peut casser entre versions. Épingler la version compatible et tester le package installé (`bun pm pack` + `bun add ./tgz`), pas seulement le lien workspace. Source : `/v2/docs/build/plugins#Publish`.
- **Context7 MCP** — Opencode gère MCP côté serveur via `ctx.mcp.transform()`. Vérifier que l'URL `https://mcp.context7.com/mcp` est correcte (celle de Claude Code est `upstash/context7`). Tester `ctx.mcp.list()` après transform.
- **Skills `autoinvoke`** — horka-mentor a un mode proactif auto-trigger. En Opencode, `autoinvoke: true` dans `SkillInfo` peut le reproduire, mais un `session.hook("prompt")` est plus fiable pour intercepter avant admission.
- **Aucun hook natif à porter** — le plugin source n'a pas de hooks, donc rien à migrer côté `permission`/`tool`/`shell`. Le seul hook à ajouter est le proactif.
- **Langue & chemins** — les SKILL.md sont en français avec templates anglais pour le code. Conserver tel quel.

### 3.9 Checklist de migration

- [ ] Créer `package.json` + `src/index.ts` (`Plugin.define({id:"horka-mentor"})`)
- [ ] Copier `skills/horka-mentor/SKILL.md` → `src/skills/horka-mentor.md` (+ adapter chemins mémoire + Context7)
- [ ] Copier `skills/horka-mentor-quiz/SKILL.md` → `src/skills/horka-mentor-quiz.md`
- [ ] Copier `references/` (3 fichiers) → `src/references/` (adapter `memory-templates.md` si `ctx.storage`)
- [ ] Enregistrer skills via `ctx.skill.transform()`, commands via `ctx.command.transform()`, MCP via `ctx.mcp.transform()`
- [ ] (Optionnel) Ajouter `session.hook("prompt")` proactif + `tool` `horka_mentor_progress`
- [ ] Tester en local `.opencode/plugins/horka-mentor.ts` puis en package `opencode2 plugin add`
- [ ] Mettre à jour `README.md` avec instructions Opencode

---

## 4. Sources

| Claim | Source primaire |
|---|---|
| Structure horka-mentor (7 fichiers, pure skills) | `GET /repos/joey-barbier/ClaudeCode-Plugin/contents/plugins/horka-mentor` + arbre git récursif + `raw/.../plugin.json` (200) |
| `plugin.json` + marketplace | `raw/.../plugins/horka-mentor/.claude-plugin/plugin.json`, `raw/.../.claude-plugin/marketplace.json` |
| Workflow 5 étapes + 10 règles + Context7 Gate | `raw/.../skills/horka-mentor/SKILL.md` |
| Workflow quiz 6 étapes + spaced repetition | `raw/.../skills/horka-mentor-quiz/SKILL.md` |
| Pédagogie / INTERVENE / dependency map / cross-stack | `raw/.../skills/horka-mentor/references/pedagogy.md` |
| Templates mémoire `~/.claude/mentor/` | `raw/.../references/memory-templates.md` |
| Règles level-up `unknown→confident` | `raw/.../references/level-up-rules.md` |
| Pas de `plugin.json` en Opencode 2, `package.json` + `Plugin.define()` | `https://opencode.ai/v2/docs/build/plugins` |
| Auto-discovery `.opencode/plugins/` + `~/.config/opencode/plugins/` | `https://opencode.ai/v2/docs/plugins` |
| `ctx.skill/command/tool/mcp/storage` transforms + `hook` + `reload` | `https://opencode.ai/v2/docs/build/plugins#Transforms`, `#API`, `#Hooks`, `#Storage` |
| `opencode2 plugin add/list/remove`, specs Git `::path:` | `https://opencode.ai/v2/docs/plugins` |
| Workspace vide, pas de convention existante | `read /home/sokoslay/Documents/Projects/Opencode/Plugins/mentor` (0 entrées) + `ls ~/.config/opencode/` |

---

*Fichier généré par la skill `research` — chaque claim est tracé à sa source primaire. Pour la suite : implémenter `src/index.ts` selon §3.3 et copier les skills/references selon §3.9.*
