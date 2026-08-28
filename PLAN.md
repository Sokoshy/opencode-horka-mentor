# Plan d'implémentation — opencode-horka-mentor (PARITÉ COMPLÈTE)

> Basé sur `RESEARCH.md` (2026-08-28). Source : `joey-barbier/ClaudeCode-Plugin/plugins/horka-mentor` → Cible : Opencode 2 (`@opencode-ai/plugin@beta`).
> **Contrainte** : implémentation de **toutes** les fonctionnalités, aucun report en v2. Chaque feature listée en §1 doit être livrée.

---

## 0. Objectif & périmètre strict

**Objectif** : port à parité 100% du plugin Claude Code `horka-mentor` vers Opencode 2. Le plugin Opencode doit couvrir **toutes** les fonctionnalités du source : 2 skills complets (5+6 étapes), 3 références, 4 commandes de config, 2 modes (learn/build), mode directif sécurité, proactif avec throttle, spaced repetition complet, translation cross-stack, regression detection, 10+7 règles absolues, tous les templates mémoire.

**Distribution** : GitHub (`opencode2 plugin add github:<user>/opencode-horka-mentor`), **pas de publish npm**.

**Rien n'est optionnel.** Les tickets marqués "optionnel" dans le plan précédent deviennent **obligatoires**.

**Décision structurante** : v1 = filesystem `~/.config/opencode/mentor/` (parité directe, diff minimale) + abstraction `ctx.options.memoryPath` pour compat `~/.claude/mentor/`. `ctx.storage` n'est pas utilisé comme backend principal en v1 (trop de divergence avec les templates markdown), mais le tool `horka_mentor_progress` expose `ctx.storage` en **miroir write-only (cache)** : le filesystem est la **source de vérité unique** ; en cas de divergence, fs gagne. Le miroir prépare la v2 sans créer d'ambiguïté.

**Context7** : aucune installation locale requise. Le plugin le déclare comme serveur MCP **remote** (`ctx.mcp.transform()`, URL configurable) — Opencode fait l'appel réseau au runtime. Seule contrainte : valider l'URL et le nommage des outils (spike T2.0).

---

## 1. Mapping exhaustif — chaque fonctionnalité → comment elle est portée

Aucune ligne ne doit être perdue. Si une feature est "logique prompt" elle est portée via le markdown du skill ; si elle est "système" elle est portée via `src/index.ts`.

### 1.1 Plugin & infra

| # | Feature source | Portage Opencode | Fichier | Critère d'acceptation |
|---|---|---|---|---|
| F0 | `plugin.json` (name/version/description/keywords/skills) | `package.json` (name `opencode-horka-mentor`, version `1.0.0`, type `module`, exports `.:src/index.ts`, dep `@opencode-ai/plugin@beta`) + `Plugin.define({id:"horka-mentor"})` | `package.json:1`, `src/index.ts:1` | `opencode2 plugin list` affiche id + version |
| F1 | `skills/` déclarés via `plugin.json: skills: ./skills/` | `ctx.skill.transform()` enregistre 2 skills avec `id/name/description/location/content` | `src/index.ts` | `ctx.skill.list()` retourne 2 skills, invocation `mentor`/`mentor quiz` déclenche |
| F2 | Dépendance Context7 MCP (`mcp__plugin_context7_context7__resolve-library-id`) | `ctx.mcp.transform()` déclare `context7` remote si absent (aucune installation locale — Opencode appelle l'URL réseau au runtime ; clé API optionnelle, utile pour les rate limits). Skills appellent `context7_resolve-library-id` et `context7_query-docs` (nommage confirmé par la doc officielle Context7/Opencode, à vérifier en T2.0) | `src/index.ts`, `src/skills/*.md` | `ctx.mcp.list()` contient `context7` **+ appel réel d'un tool Context7 réussit depuis une session**, skills bloquent/soft-gatent correctement |
| F3 | `allowed-tools: [Read,Write,Edit,Glob]` | Pas de frontmatter équivalent Opencode ; les skills utilisent les tools natifs `read/write/edit/glob` + tool custom `horka_mentor_progress` | `src/index.ts` | Skills peuvent lire/écrire `mentor/` sans erreur permission |

### 1.2 Skill `horka-mentor` — 5 étapes + règles

| # | Feature source | Portage | Critère |
|---|---|---|---|
| M0 | **Step 0 Context7 Gate (MANDATORY)** — bloque si MCP absent, message `MENTOR BLOCKED`, bypass `--no-context7` → warning + pseudocode seul, APIs natives exemptes | Markdown `src/skills/horka-mentor.md` adapté (outil renommé `mcp_context7_…`, chemins `~/.config/opencode/mentor/`), `src/index.ts` déclare MCP avant | Sans Context7 : `/mentor` bloque avec message traduit ; avec `--no-context7` : warning + aucun exemple framework |
| M1 | **Step 1 Cold Start** — check `dev-profile.md`, détection langue, 4 questions (prénom/langue/expérience/stack), template `memory-templates.md`, init `not-assessed`/`build`/`enabled`, reprise demande initiale | Markdown porté + `memory-templates.md` adapté | 1er `/mentor` pose 4 questions dans la bonne langue, crée `dev-profile.md` conforme au template |
| M2a | **Step 2 Mode Selection explicite** — `/mentor learn`→learn, `/mentor build` ou `mentor`→build (défaut), flags combinables `--no-context7` | `ctx.command.transform()` + markdown | Chaque invocation mappe au bon mode, flags combinés testés |
| M2b | **Step 2 Proactif** — intercepte requêtes directes, consulte `dev-profile` + `topics/`, check liste INTERVENE `pedagogy.md`, skip si `confident<30j`, affiche `[MENTOR] … question (skip|/mentor proactif off)`, throttle 2/session, cooldown skip, jamais triviaux, style adapté `learning_preference` | **Markdown + `ctx.session.hook("prompt")` obligatoire** dans `src/index.ts` (le skill seul ne peut intercepter hors `/mentor` en Opencode) + `ctx.session.hook("context")` pour injecter rappel système | Requête directe `écris un middleware JWT` sans `/mentor` déclenche proactif 1 fois, `skip` mute le reste de la session, 3e requête ne déclenche plus |
| M2c | **Step 2 Config** — `/mentor proactif on/off` → `proactive_mode`, `/mentor profil` → affiche profil, `/mentor topics` → liste topics/niveaux | Markdown + `ctx.command` + tool `horka_mentor_progress` | Chaque commande modifie/affiche correctement |
| M3a | **Step 3 Concept Analysis — classification** — `confident<30j`→skip, `understood`→light check learn, `learning`→intervient, `unknown`→full | Markdown | 4 cas testés avec topics pré-remplis |
| M3b | **Step 3 Prérequis** — dependency map `pedagogy.md` (17 entrées), backstep max 2 niveaux, bridge 1 phrase au-delà (`unknown`+`bridge-given`), sélection prioritaire, budget 1 question/concept BUILD (max 2 avec backstep), budgets séparés | Markdown + `pedagogy.md` copié 1:1 | Demande WebSockets avec `http` unknown → question sur HTTP d'abord, puis WebSockets ; 3e niveau → bridge |
| M3c | **Step 3 Pushback** — `je connais` → re-ancre predict/spot-bug, ne capitule pas, laisse réponse parler, maj topic si correct | Markdown | Pushback testé, pas de `tu vois tu ne savais pas` |
| M4a | **Step 4 BUILD** — 1 question max (predict/spot/explain, jamais oui/non), code incrémental WHY, checkpoints adaptatifs (`fast`→implicite), maj `unknown→learning`/`learning→understood`, planifie J+1 | Markdown | BUILD pose 1 question max, code par blocs commentés `// Why:`, maj topic |
| M4b | **Step 4 LEARN** — 2–3 questions depth-adaptative, full (analogie+Context7 minimal→complexe+exercice), dev code guidé `quelle prochaine étape ?`, hints >2 tours bloqués, maj mémoire | Markdown | LEARN pose 2–3 questions, exemple Context7 vérifié, exercice donné |
| M4c | **Step 4 DIRECTIF Sécurité** — override BUILD/LEARN pour auth/crypto/validation/XSS/CSRF/secrets/rate-limit/CORS, explique AVANT, vulnérable→secure (batch Context7 upfront, ex JWT=express+jsonwebtoken+bcrypt+dotenv), quiz `pourquoi dangereux ?`, puis build, `unknown→understood` direct si solid | Markdown + `pedagogy.md` section Security-Critical | Demande `auth JWT` déclenche directif même en BUILD, pas de question initiale, batch lookups visibles |
| M5 | **Step 5 Memory Management** — crée/maj `topics/<slug>.md` (Teaching/Assessment History), maj `quiz-log.md` (Upcoming Reviews J+1), maj `dev-profile.md` (speed/notes), level-up via `level-up-rules.md`, source vérité = topics, `quiz-log` = index | Markdown + `memory-templates.md` + `level-up-rules.md` 1:1 | Après chaque interaction : topic + quiz-log + profil maj, `interval_step` tracké |
| M6 | **Cross-Stack Translation** — `pedagogy.md` + `Prior stacks` → analogies (Express middleware=ViewModifier…) pendant assessment ET explication | Markdown + `pedagogy.md` | Profil avec `Prior stacks: SwiftUI` → analogie SwiftUI donnée |
| M7 | **Regression Detection** — détecte ancien pattern réutilisé (`understood` mais callback vs async) → `Je remarque… volontaire ou on en reparle ?`, log sans forcer | Markdown | Regression testée, log dans topic |
| M8 | **10 Règles absolues** — jamais oui/non, jamais API sans Context7, jamais condescendant, max 1 question BUILD, toujours maj mémoire, toujours vérifier doc, respecter skip (`needs-revisit`), profil privé, commentaires anglais, topics font foi | Markdown | Audit manuel : aucune violation dans les réponses |
| M9 | **Format de réponse** — BUILD (question→plan→bloc `// Why:`→vérif), LEARN (`[Concept] → questions → analogie → code Context7 → exercice`), proactif (`[MENTOR] … (skip|…)`) | Markdown | Formats respectés |

### 1.3 Skill `horka-mentor-quiz` — 6 étapes + règles

| # | Feature | Portage | Critère |
|---|---|---|---|
| Q0 | **Step 0 Context7 Gate souple** — si absent continue avec warning `[Context7 indisponible]`, limité à `explain` + APIs natives | Markdown adapté | Quiz sans Context7 ne bloque pas, que des questions `explain`/native |
| Q1 | **Step 1 Prerequisites** — check `dev-profile.md` sinon `Lance /mentor`, scan `topics/` sinon `Aucun sujet` | Markdown | Messages d'erreur exacts |
| Q2a | **Step 2 Mode spaced** — `/mentor-quiz` → filtre `next_review <= today`, 3 plus en retard | Markdown + tool `horka_mentor_progress` (scan topics) | Avec 5 topics dus, 3 plus urgents sélectionnés |
| Q2b | **Step 2 Ciblé** — `/mentor-quiz <topic>` même si pas dû | Markdown | Quiz ciblé trouvé/pas trouvé |
| Q2c | **Step 2 Full** — `/mentor-quiz all` tous topics | Markdown | Tous topics quizzés |
| Q3 | **Step 3 Question Generation** — type adapté level (`learning→predict/spot`, `understood→explain`, `confident→edge case`), évite répétition via History, Context7, format `QUIZ — [Concept] ([level])` + `Prends ton temps` | Markdown | Type correct par level, pas de répétition |
| Q4 | **Step 4 Évaluation** — `solid`→`Correct.`, `shaky`→`Presque.`, `missed`→`Pas tout à fait.` + propose `/mentor`, jamais de flatterie | Markdown | 3 catégories testées, ton factuel |
| Q5a | **Step 5 Memory — topic** — ajoute Assessment History, maj level (table 9 lignes `solid→up/missed→down/shaky→stay`), `last_assessed` | Markdown + `level-up-rules.md` | Table complète vérifiée |
| Q5b | **Step 5 Memory — quiz-log** — recalcule `next_review` (`solid→avance J+1→J+3→J+7→J+14→J+30→30j`, `shaky→garde`, `missed→reset J+1` sauf 3 missed consécutifs → `needs-reteach` J+3 + recommande `/mentor`, `interval_step` 1–6) | Markdown + `level-up-rules.md` | Échelle complète + cap 3 missed testés |
| Q5c | **Step 5 Memory — profil** — maj `learning speed` si besoin | Markdown | Profil maj si evidence |
| Q6 | **Step 6 Bilan** — `BILAN QUIZ — [date]` par topic `→ level (next review)`, liste `à revoir avec /mentor` si missed | Markdown | Bilan conforme |
| Q7 | **7 Règles absolues quiz** — jamais oui/non, jamais réponse avant, jamais skip maj, jamais répétition, jamais condescendant, toujours proposer `/mentor` si missed, Context7 si dispo | Markdown | Audit |

### 1.4 References

| # | Fichier | Portage | Contenu obligatoire |
|---|---|---|---|
| R1 | `pedagogy.md` (9 142 B) | Copie 1:1 | 5 méthodes assessment, INTERVENE/COMMENT INLINE/NEVER, Depth Inline/Brief/Full, critères ALL/ANY, Security-Critical DIRECTIVE+batch, adaptation fast/slow/disengaged, dependency map 17 entrées, Dunning-Kruger, cross-stack, session length 3–4 fondations |
| R2 | `level-up-rules.md` (2 347 B) | Copie 1:1 | Table 6 transitions + cas inline/skip/3 missed/needs-reteach/bridge, `bridge-given` pas `learning` |
| R3 | `memory-templates.md` (3 599 B) | Adapté chemins | `dev-profile.md` (Identité + Domains speed + Notes), `topics/<slug>.md` (Status 7 champs + Context + 2 Histories), `quiz-log.md` (Schedule + Upcoming Reviews table + History), diagramme |

**Aucune feature n'est reportée.** Tout ce qui est dans les 3 refs doit être utilisable par les skills.

---

## 2. Architecture cible (complète)

```
opencode-horka-mentor/                          # = /home/sokoslay/Documents/Projects/Opencode/Plugins/mentor
├── package.json                                # name, type:module, exports, deps @opencode-ai/plugin@beta
├── tsconfig.json
├── opencode.jsonc                              # dev : plugins: ["./src/index.ts"] + options
├── src/
│   ├── index.ts                                # Plugin.define — OBLIGATOIRE : 5 enregistrements + 3 hooks
│   │                                          # 1. skill.transform (2 skills, horka-mentor autoinvoke:true)
│   │                                          # 2. command.transform (mentor, mentor-quiz, + alias proactif/profil/topics)
│   │                                          # 3. mcp.transform (context7)
│   │                                          # 4. tool.transform (horka_mentor_progress — 5 actions)
│   │                                          # 5. session.hook("prompt") proactif minimaliste (injection + throttle retry-safe)
│   │                                          # 6. session.hook("context") injection système avec dédup
│   │                                          # 7. session.hook("experimental.session.compacting") préservation état pédagogique
│   ├── skills/
│   │   ├── horka-mentor.md                     # SKILL.md complet adapté
│   │   └── horka-mentor-quiz.md                # SKILL.md complet adapté
│   └── references/
│       ├── pedagogy.md
│       ├── level-up-rules.md
│       └── memory-templates.md
├── .opencode/
│   └── plugins/
│       └── horka-mentor.ts                     # dev auto-discovery (copie de src/index.ts)
├── RESEARCH.md
├── PLAN.md
└── README.md
```

**`src/index.ts` — squelette obligatoire (tout est requis)** :

```ts
import { Plugin } from "@opencode-ai/plugin"
import mentorMd from "./skills/horka-mentor.md" with { type: "text" }
import quizMd from "./skills/horka-mentor-quiz.md" with { type: "text" }

export default Plugin.define({
  id: "horka-mentor",
  async setup(ctx) {
    // ⚠️ Nommages/structures à confirmer par le spike T2.0 avant implémentation finale :
    //  - nom exact des tools MCP context7 exposés au modèle (T2.0 ①)
    //  - URL Context7 valide (T2.0 ②)
    //  - propriété `namespace` de ToolInfo (T2.0 ③)
    //  - structure de ctx.options (T2.0 ④)
    const memoryPath = (ctx.options.memoryPath as string) ?? "~/.config/opencode/mentor"
    const memoryPathFallback = (ctx.options.compatClaudePath as boolean) ? "~/.claude/mentor" : undefined
    const proactive = (ctx.options.proactive as boolean) ?? true
    const context7Url = (ctx.options.context7 as string) ?? "https://mcp.context7.com/mcp" // URL tranchée (doc officielle Context7)
    const context7ApiKey = ctx.options.context7ApiKey as string | undefined
    const referencesDir = `${ctx.location.directory}/src/references`

    // Hydratation centralisée des skills (variables remplacées avant enregistrement)
    const hydrateSkill = (md: string) =>
      md.replaceAll("{{memoryPath}}", memoryPath)
        .replaceAll("{{memoryPathFallback}}", memoryPathFallback ?? memoryPath)
        .replaceAll("{{referencesDir}}", referencesDir)

    // 1. Skills — 2 obligatoires
    await ctx.skill.transform((draft) => {
      draft.add({ id: "horka-mentor", name: "Horka Mentor", description: "Teaching AI mentor — learn/build/proactif/spaced repetition. Invoke: mentor, mentor learn, mentor build.", location: `${ctx.location.directory}/src/skills/horka-mentor.md`, content: hydrateSkill(mentorMd) })
      draft.add({ id: "horka-mentor-quiz", name: "Horka Mentor Quiz", description: "Quiz spaced repetition. Invoke: mentor quiz, quiz, revision.", location: `${ctx.location.directory}/src/skills/horka-mentor-quiz.md`, content: hydrateSkill(quizMd) })
    })
    // Note : SkillInfo supporte autoinvoke (draft.update("horka-mentor", s => s.autoinvoke = true))
    // Décision : autoinvoke TRUE sur horka-mentor (le modèle peut l'invoquer spontanément hors /mentor,
    // reproduit le comportement proactif source), false sur le quiz (jamais spontané).

    // 2. Commands — mentor + mentor-quiz + alias quiz/revision (parité triggers source)
    await ctx.command.transform((draft) => {
      const passthrough = (name: string, description: string) =>
        draft.add({ name, description, execute: async ({sessionID, prompt, delivery}) => { await ctx.session.prompt({ sessionID, prompt, delivery }) } })
      passthrough("mentor", "Mentor pédagogique (learn/build/profil/topics/proactif)")
      passthrough("mentor-quiz", "Quiz spaced repetition")
      passthrough("quiz", "Alias mentor-quiz")
      passthrough("revision", "Alias mentor-quiz")
    })

    // 3. MCP — obligatoire (URL validée par T2.0). Ne surcharge pas une config existante
    // (préserve l'auth éventuelle de l'utilisateur). Pas de clé = rate limits réduits.
    await ctx.mcp.transform((draft) => {
      if (!draft.get("context7")) {
        draft.set("context7", {
          type: "remote",
          url: context7Url,
          ...(context7ApiKey && { headers: { Authorization: `Bearer ${context7ApiKey}` } }),
        } as any)
      }
    })

    // 4. Tool — OBLIGATOIRE (toutes les fonctionnalités). fs = source de vérité, storage = miroir write-only
    await ctx.tool.transform((draft) => {
      draft.add({
        name: "mentor_progress", // nom final selon T2.0 ③ (namespace ou pas)
        description: "Gère la progression mentor: get_profile, list_topics, get_topic, get_quiz_log, check_proactive",
        input: { type:"object", properties:{ action:{type:"string", enum:["get_profile","list_topics","get_topic","get_quiz_log","check_proactive"]}, topic:{type:"string"}, prompt:{type:"string"} }, required:["action"] },
        execute: async (input:any) => {
          // implémente les 5 actions via fs (memoryPath = source de vérité), puis miroir ctx.storage (fire-and-forget)
          // get_profile → lit dev-profile.md
          // list_topics → scan topics/ + parse frontmatter Status
          // get_topic → lit topics/<slug>.md
          // get_quiz_log → lit quiz-log.md
          // check_proactive → renvoie les topics + levels + resume du prompt ; le JUGEMENT
          // INTERVENE est fait par le modèle (pedagogy.md), pas par keywords en TS
          return { content: "…" }
        }
      })
    })

    // 5. Hook proactif — OBLIGATOIRE mais MINIMALISTE (jugement INTERVENE délégué au modèle + skill)
    await ctx.session.hook("prompt", async (event) => {
      if (!proactive) return
      // - idempotence retry-safe OBLIGATOIRE : throttle via sessionId+hash(prompt), pas un compteur naïf
      // - injecte un préfixe système léger dans event.prompt.text (pas de détection INTERVENE en TS)
      // - le skill (autoinvoke) + tool check_proactive font le jugement
    })

    // 6. Hook context — OBLIGATOIRE pour injecter rappel système mentor si session mentor active
    // ⚠️ court à CHAQUE appel modèle (tool continuations incluses) → dédup obligatoire
    await ctx.session.hook("context", async (event) => {
      // si session a un topic mentor actif, ET marqueur [horka-mentor] absent de event.system :
      // push system: "Tu es horka-mentor, respecte pedagogy.md…"
    })

    // 7. Hook compaction — OBLIGATOIRE (état pédagogique survit au résumé de compaction)
    await ctx.session.hook("experimental.session.compacting" as any, async (input: any, output: any) => {
      // si session mentor active : output.context.push(topics+levels, mode, dernière question, règles mentor)
    })
  },
})
```

---

## 3. Découpage en phases — TOUT est obligatoire (6 phases, 14 tickets)

### Phase 0 — Scaffolding (0.5h)

| Ticket | Tâche | Livrable | Dépend |
|---|---|---|---|
| **T0.1** | `package.json` + `tsconfig.json` + `src/` + `aube add @opencode-ai/plugin@beta` | `package.json`, `tsconfig.json`, lockfile (Aube réutilise `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock` en place) | — |
| **T0.2** | `Plugin.define` minimal qui charge (`loaded in`) + `.opencode/plugins/horka-mentor.ts` | Plugin charge sans erreur | T0.1 |

**Exit** : `opencode2 service restart` log `loaded in …`.

### Phase 1 — Port des contenus (1.5–2h) — TOUTES les adaptations

| Ticket | Tâche | Détail | Dépend |
|---|---|---|---|
| **T1.1** | `horka-mentor/SKILL.md` → `src/skills/horka-mentor.md` | Copie + adaptations : `~/.claude/mentor/`→`~/.config/opencode/mentor/` (+ note `ctx.options.memoryPath` fallback `~/.claude/mentor`), `mcp__plugin_context7_…`→nom d'outil validé par T2.0 (placeholder `mcp_context7_resolve-library-id` en attendant), `allowed-tools` conservé en commentaire, tous les Steps 0–5 + Formats + 10 règles intacts. **Réécrire les chemins des references en chemins absolus** (l'agent les lit avec le tool `read` après injection du contenu du skill) — variable `{{referencesDir}}` remplacée dans `src/index.ts` avant `draft.add` (ex : `Lis references/pedagogy.md` → `Lis {{referencesDir}}/pedagogy.md` → `/…/src/references/pedagogy.md`). Ne pas substituer `{{memoryPath}}` à ce stade (fait en T3.2) | T0.1 |
| **T1.2** | `horka-mentor-quiz/SKILL.md` → `src/skills/horka-mentor-quiz.md` | Mêmes adaptations (+ `{{referencesDir}}`, nom MCP selon T2.0) + Gate souple, Steps 0–6 + 7 règles intacts | T0.1 |
| **T1.3** | `pedagogy.md` + `level-up-rules.md` | Copies 1:1 strictes — aucune ligne supprimée (17 dépendances, 5 méthodes, 3 profondeurs, etc.) | T0.1 |
| **T1.4** | `memory-templates.md` | Adapté chemins + ajout note `ctx.options.memoryPath` + `interval_step`, sinon 1:1 | T0.1 |

**Exit** : `src/skills/*.md` + `src/references/*.md` présents, diff vs source = uniquement chemins + préfixe MCP.

### Phase 2 — Runtime Opencode (2.5–3.5h) — TOUT obligatoire

| Ticket | Tâche | Détail | Dépend |
|---|---|---|---|
| **T2.0** | **SPIKE vérification API (bloquent T2.2–T2.4)** | Avec un mini-plugin jetable dans `.opencode/plugins/spike.ts` + un `opencode.jsonc` de test : ① déclarer `context7` remote et vérifier le **nom exact** des tools MCP exposés au modèle — la doc officielle Context7 annonce `context7_resolve-library-id` et `context7_query-docs` pour Opencode, à confirmer. ② Smoke test uniquement — l'URL `https://mcp.context7.com/mcp` (remote, streamable HTTP) est **déjà tranchée** par la doc officielle Context7 pour Opencode (sans clé API = rate limits réduits) ; vérifier juste un appel réel réussit depuis une session. ③ Vérifier si `ToolInfo` supporte une propriété `namespace` (sinon le tool s'appellera `mentor_progress` et le plan/skills seront mis à jour en conséquence). ④ Vérifier la structure exacte de `ctx.options` (imbriqué dans l'entrée plugin `{"package":…, "options":{…}}` vs racine). ⑤ Vérifier que `ctx.location.directory` pointe vers le **package installé** (cache plugins Opencode après `opencode2 plugin add github:…`, pas le workspace) et que `location` absolu + `content` hydraté fonctionne dans ce cas. **Livrable : section "Résultats du spike" ajoutée en fin de PLAN.md + nom d'outil MCP définitif.** | T0.2 |
| **T2.1** | `ctx.skill.transform()` | Enregistre 2 skills (id `horka-mentor`/`horka-mentor-quiz`, location absolue, content via `import ... with {type:"text"}` ou `fs.readFile` — **pas de `Bun.file`**, rester sur les APIs Node standard) | T1.1, T1.2 |
| **T2.2** | `ctx.command.transform()` | `mentor` + `mentor-quiz` (passthrough `session.prompt` — **vérifier la signature exacte : la doc montre `ctx.session.prompt({ ...prompt, sessionID, text: …, delivery })`, champ `text:` requis**) **+ alias `quiz` et `revision` → `mentor-quiz`** (parité triggers du skill source : `mentor quiz`, `quiz`, `revision`). `mentor` doit aussi supporter `mentor learn`/`build`/`proactif on/off`/`profil`/`topics`/`--no-context7` via passthrough (le skill parse) | T2.1 |
| **T2.3** | `ctx.mcp.transform()` | Déclare `context7` remote (URL validée par T2.0), configurable `ctx.options.context7`, ne surcharge pas si déjà présent. **Critère étendu : un appel réel d'outil Context7 depuis une session réussit** (pas juste présence dans la liste) | T0.2, T2.0 |
| **T2.4** | `ctx.tool.transform()` **OBLIGATOIRE** | `horka_mentor_progress` avec 5 actions : `get_profile`, `list_topics`, `get_topic`, `get_quiz_log`, `check_proactive` — implémentation fs sur `memoryPath` (source de vérité) + `ctx.storage` en miroir write-only. Input JSON Schema complet. **Nom unifié dès maintenant : `name: "mentor_progress"` + `options: { namespace: "horka" }` → nom effectif `horka_mentor_progress` (doc tools : dots/char non supportés → `_`). Références dans les skills et le plan = `horka_mentor_progress`. Confirmer via spike T2.0 ③** | T2.0, T2.1 |

**Exit** : `skill list` 4 commands (mentor, mentor-quiz, quiz, revision), `mcp list` context7, appel Context7 réel OK, `tool list` contient le tool progress, `/mentor` déclenche skill, `quiz`/`revision` déclenchent le quiz.

### Phase 3 — Options & mémoire (1–2h) — TOUT obligatoire

| Ticket | Tâche | Détail | Dépend |
|---|---|---|---|
| **T3.1** | `ctx.options` complets | `memoryPath` (défaut `~/.config/opencode/mentor`), `proactive` (bool défaut `true`), `context7` (string|false), `context7ApiKey` (string|undefined — si présent, passe `headers: { Authorization: "Bearer <key>" }` au serveur MCP déclaré en T2.3 ; si absent, serveur sans clé = rate limits réduits), `compatClaudePath` (bool, si true lit aussi `~/.claude/mentor/` en fallback). **Structure de config selon résultat T2.0 ④** — attendu : `opencode.jsonc` → `"plugins": [{ "package": "opencode-horka-mentor", "options": { … } }]`. **Note : si l'utilisateur configure déjà `context7` dans son `opencode.jsonc` (avec sa clé via `{env:CONTEXT7_API_KEY}`), le transform T2.3 ne surcharge pas — sa config (et son auth) est préservée** | T2.1, T2.0 |
| **T3.2** | Vérif. chemins dans skills | Les skills utilisent `memoryPath` (variable `{{memoryPath}}` remplacée dans `src/index.ts` avant `draft.add`) **+ `{{memoryPathFallback}}` (si `compatClaudePath:true`, sinon = memoryPath), `{{referencesDir}}` et le nom d'outil MCP validé en T2.0 — substitution centralisée dans une fonction `hydrateSkill(md, {memoryPath, memoryPathFallback, referencesDir, mcpTool})`** | T1.1, T3.1 |

**Exit** : `opencode.jsonc` avec `options:{memoryPath, proactive, context7}` testé, skills lisent le bon dossier.

### Phase 4 — Hooks (1.5–2h) — TOUT obligatoire

Le hook proactif est **minimaliste** : injection système + throttle retry-safe. La détection INTERVENE (jugement sémantique) est déléguée au modèle via le skill (`autoinvoke: true`) et le tool `check_proactive` — pas de détection par keywords en TypeScript.

| Ticket | Tâche | Détail | Dépend |
|---|---|---|---|
| **T4.1** | `session.hook("prompt")` **OBLIGATOIRE — scope minimaliste** | Le hook **n'implémente PAS la détection INTERVENE en TypeScript** (jugement sémantique, fragile en keywords). Il fait : check `proactive` false→return, **idempotence retry-safe obligatoire** (doc : "not an exactly-once side-effect boundary", les retries re-run le hook → throttle basé sur `sessionId + hash(prompt)` ou timestamp, pas un compteur naïf), puis **injecte un préfixe système léger** dans `event.prompt.text` : « Si cette requête implique un concept non couvert par `{{memoryPath}}/topics/`, applique le protocole mentor Step 2 Proactif (listé dans le skill horka-mentor) — throttle 2/session, skip, jamais triviaux. » Le **jugement INTERVENE reste au modèle** (via le skill chargé), assisté du tool `horka_mentor_progress` (`check_proactive`). Throttle 2/session, cooldown après `skip`, jamais `NEVER INTERVENE` — délégués au skill | T3.1, T2.4 |
| **T4.2** | `session.hook("context")` **OBLIGATOIRE — avec déduplication** | Le hook court **à chaque appel modèle** (tool continuations incluses, doc : "run for subsequent calls such as tool-driven continuations") — sans dédup, l'injection système **empile**. Implémentation : si session mentor active (flag `memoryPath/.mentor-active` ou `ctx.storage`), vérifier si le texte mentor est déjà présent dans `event.system` (dédup par marqueur, ex : chercher `[horka-mentor]` dans les parts existantes) avant de `event.system.push({text:"Tu es horka-mentor, respecte pedagogy.md, jamais oui/non, max 1 question BUILD…"})` | T4.1 |
| **T4.3** | Hook compaction **OBLIGATOIRE** | `"experimental.session.compacting"` (présent dans `packages/opencode/src/session/compaction.ts`, signature `input: {sessionID}, output: {context: string[], prompt?: string}`) — si session mentor active, `output.context.push(...)` avec l'état pédagogique à préserver dans le résumé : topics en cours + levels, mode actif (learn/build), dernière question posée, règles mentor clés (jamais oui/non, max 1 question BUILD). **Sans ça, le résumé de compaction perd l'état pédagogique** (le summary est "explicitly not as new instructions" et l'injection `context` du T4.2 est rejouée mais le fil pédagogique est perdu). ~30 lignes. Event `session.compacted` dispo si besoin de re-flag après compaction | T4.2 |

**Exit** : requête directe `implémente auth JWT` déclenche l'injection proactif (le modèle décide d'intervenir via skill autoinvoke + tool `check_proactive`), `skip` mute, `proactif off` désactive, session longue → le résumé de compaction contient l'état mentor (vérifier via event `session.compacted` + lecture checkpoint).

### Phase 5 — Polish & docs (1h) — TOUT obligatoire

| Ticket | Tâche | Détail | Dépend |
|---|---|---|---|
| **T5.1** | `README.md` complet | Install `opencode2 plugin add github:<user>/opencode-horka-mentor`, `opencode.jsonc` exemple complet (tous les `options`), dev local `.opencode/plugins/`, compat Claude Code, liste toutes les commandes (`mentor learn/build/--no-context7/proactif on/off/profil/topics`, `mentor-quiz`, `mentor-quiz <topic>`, `mentor-quiz all`), troubleshooting Context7 | T2.3 |
| **T5.2** | `opencode.jsonc` exemple + `.opencode/plugins/horka-mentor.ts` dev | Fichier exemple pour `opencode2 service restart` rapide | T2.1 |

**Exit** : README couvre 100% des commandes, exemple `opencode.jsonc` testé.

### Phase 6 — Validation parité (2h) — TOUT obligatoire, matrice exhaustive

| Ticket | Tâche | Matrice de tests (tous doivent passer) | Dépend |
|---|---|---|---|
| **T6.1** | Tests fonctionnels **mentor** (8 tests) | 1. Cold start 4 questions → `dev-profile.md` conforme template<br>2. BUILD 1 question max → code `// Why:` par blocs, maj `unknown→learning`<br>3. LEARN 2–3 questions → analogie+Context7 minimal→complexe+exercice<br>4. Prérequis backstep 2 niveaux + bridge 3e niveau<br>5. Pushback `je connais` → re-ancre predict<br>6. `--no-context7` → warning + pseudocode seul<br>7. DIRECTIF `auth JWT` (batch 4 lookups) → vulnérable→secure+quiz, `unknown→understood` si solid<br>8. `proactif on/off`, `profil`, `topics`, `skip`→`needs-revisit`, cross-stack, regression | T4.2, T3.2 |
| **T6.2** | Tests fonctionnels **quiz** (7 tests) | 1. Gate souple sans Context7 (warning, que `explain`)<br>2. Spaced `next_review<=today` → 3 plus en retard<br>3. Ciblé `mentor-quiz async` (trouvé/pas trouvé)<br>4. `all` tous topics<br>5. Évaluation `solid/shaky/missed` → levels + `next_review` (`J+1→J+3→J+7→J+14→J+30`, `shaky` garde, `missed` reset, 3 missed→`needs-reteach` J+3)<br>6. `interval_step` 1–6 tracké<br>7. Bilan `BILAN QUIZ` + `à revoir avec /mentor` | T6.1 |
| **T6.3** | Tests système | **Install Git : `opencode2 plugin add github:<user>/opencode-horka-mentor` dans un projet vierge** (+ `aube pack` → install depuis le tarball comme test secondaire), `opencode2 plugin list` OK, `touch .opencode/plugins/…` reload OK, `opencode2 service restart` OK, appel réel d'un tool Context7 depuis une session OK, tool progress appelable par l'agent (via log d'exécution ou mini-session de test) | T6.2 |

**Exit** : 15/15 tests passent, parité déclarée.

---

## 4. Ordre d'exécution (chemin critique — tout est sur le chemin critique)

```
T0.1 → T0.2 → T1.1 + T1.2 + T1.3 + T1.4 (parallèle) → T2.0 (spike) → T2.1 → T2.2 + T2.3 + T2.4 (parallèle) → T3.1 → T3.2 → T4.1 → T4.2 → T4.3 → T5.1 + T5.2 (parallèle) → T6.1 → T6.2 → T6.3
```

Le spike **T2.0** bloque T2.2–T2.4 (nom d'outil MCP, `namespace`, structure options) et la finalisation T1.1/T1.2 (nom d'outil dans les skills — le placeholder `mcp_context7_resolve-library-id` est écrit pendant T1.1/T1.2 puis corrigé au résultat du spike). Aucun ticket n'est reportable. Premier incrément testable après **T2.4** (skills+commands+MCP+tool), parité atteinte après **T6.3**.

---

## 5. Fichiers à créer (checklist — tout coché = parité)

- [ ] `package.json` — `{"name":"opencode-horka-mentor","version":"1.0.0","type":"module","exports":{".":"./src/index.ts"},"dependencies":{"@opencode-ai/plugin":"beta"}}`
- [ ] `tsconfig.json` — `module:ESNext, target:ESNext, moduleResolution:bundler, strict:true`
- [ ] `src/index.ts` — 6 enregistrements (skills×2, commands×2, mcp, tool×1) + 3 hooks (prompt proactif, context dédup, compacting)
- [ ] `src/skills/horka-mentor.md` — complet (Steps 0–5, Formats, Cross-Stack, Regression, 10 règles)
- [ ] `src/skills/horka-mentor-quiz.md` — complet (Steps 0–6, 7 règles)
- [ ] `src/references/pedagogy.md` — 1:1 (9 142 B)
- [ ] `src/references/level-up-rules.md` — 1:1 (2 347 B)
- [ ] `src/references/memory-templates.md` — adapté chemins (3 599 B)
- [ ] `.opencode/plugins/horka-mentor.ts` — dev
- [ ] `README.md` — toutes commandes + options
- [ ] `opencode.jsonc` — exemple complet

---

## 6. Décisions à trancher avant T1.1 (avec défauts pour parité)

1. **Nom npm** : `opencode-horka-mentor` (défaut) — **distribution GitHub, pas de publish npm** : `opencode2 plugin add github:<user>/opencode-horka-mentor`. Le `name` package.json reste l'identifiant affiché par `plugin list`. Valider le nom et le repo GitHub cible.
2. **Chemin mémoire** : défaut `~/.config/opencode/mentor` + `options.memoryPath: "~/.claude/mentor"` pour compat Claude Code (défaut proposé : `~/.config/opencode/mentor`, fallback `~/.claude/mentor` si `compatClaudePath:true`).
3. **URL Context7** : **TRANCHÉE** — `https://mcp.context7.com/mcp` (remote, streamable HTTP) est la doc officielle Context7 pour Opencode (context7.com/docs + upstash-context7.mintlify.app). Fonctionne sans clé API (rate limits réduits) ; clé gratuite optionnelle sur context7.com/dashboard via header `Authorization: Bearer` (ou `CONTEXT7_API_KEY`). Le spike T2.0 ② ne fait qu'un smoke test.
4. **Hook proactif** : **TRANCHÉ** — scope minimaliste (injection + throttle retry-safe), détection INTERVENE déléguée au modèle via skill `autoinvoke: true` + tool `check_proactive`. Pas de détection keywords en TS.
5. **Hook compaction** : **TRANCHÉ** — `experimental.session.compacting` obligatoire (T4.3) pour préserver l'état pédagogique dans le résumé de compaction Opencode 2.
6. **Compabilité Claude (chemins)** : `compatClaudePath` — la substitution `{{memoryPath}}` unique ne suffit pas si le fallback `~/.claude/mentor` est actif. T3.2 doit injecter le **chemin résolu effectif** (ou deux variables `{{memoryPath}}`/`{{memoryPathFallback}}`).

Réponds aux 3 (npm name) ou je pars sur les défauts ci-dessus — les 4-6 sont tranchés.

---

## 7. Estimation (parité complète)

| Phase | Durée | Effort |
|---|---|---|
| 0 Scaffolding | 0.5h | faible |
| 1 Contenus | 1.5–2h | faible |
| 2 Runtime (incl. spike T2.0) | 2.5–3.5h | moyen |
| 3 Options | 1–2h | faible |
| 4 Hooks | 1.5–2h | moyen (injection + throttle retry-safe + hook compaction) |
| 5 Polish/docs | 1h | faible |
| 6 Validation parité | 2h | — |
| **Total parité complète** | **~10–12h** | |

---

## 8. Prochaines actions

1. Valider les 3 décisions §6 (ou `défauts OK`).
2. Je lance `T0.1` : `aube add @opencode-ai/plugin@beta && aube add -d typescript @types/node`.
3. J'enchaîne `T1.1–T1.4` (copie des 5 fichiers sources) dès validation.

---

*Chaque ligne §1 est traçable à `RESEARCH.md:§1.3–1.5` (sources primaires `raw.githubusercontent.com` + `opencode.ai/v2/docs/build/plugins`). Aucune fonctionnalité n'est exclue.*

---

## 9. Résultats du spike T2.0 (rempli 2026-08-28 — fait foi pour T2.2–T2.4 et T3.1)

| Question | Résultat | Impact |
|---|---|---|
| ① Nom exact des tools MCP context7 exposés au modèle | `context7_resolve-library-id` / `context7_query-docs` (exposés via serveur MCP `context7` ; alias `mcp_context7_…` / `mcp__plugin_context7_…` selon version Opencode — les skills tentent les candidats et le hook `context` détecte dynamiquement `Object.keys(event.tools)` contenant `context7` pour injecter les noms exacts) | Step 0 Gate des 2 skills (M0/Q0) |
| ② Smoke test URL `https://mcp.context7.com/mcp` + appel réel OK ? | URL **tranchée** par doc officielle Context7 pour Opencode (`type: remote`, streamable HTTP) ; pas de clé requise (rate limits réduits), clé `CONTEXT7_API_KEY` optionnelle via `headers.Authorization`. Déclaration `ctx.mcp.transform()` vérifiée type-safe (`@opencode-ai/schema` `Mcp.RemoteConfig` avec `type/url/headers/oauth/disabled/codemode/timeout`). Smoke test réel dans une session recommandé, pas bloquant pour le build | T2.3 critère d'acceptation |
| ③ `ToolInfo` supporte `namespace` ? Nom final du tool progress ? | **Oui** — `Tool.Options` contient `namespace?: string` (`node_modules/@opencode-ai/schema/dist/tool.d.ts:18`). Nom effectif `name: "mentor_progress"` + `options: {namespace:"horka"}` → `horka_mentor_progress` (dots/char non supportés → `_`). Validé via `ctx.tool.transform()` | T2.4, F3, références dans les skills |
| ④ Structure de `ctx.options` | `ctx.options: PluginOptions = Readonly<Record<string, any>>` — objet plat issu de l'entrée plugin `{"package":…, "options":{…}}` dans `opencode.jsonc`. Accès direct `ctx.options.memoryPath`, `ctx.options.proactive`, etc. (`node_modules/@opencode-ai/plugin/dist/options.d.ts`) | T3.1, exemple `opencode.jsonc` (T5.1/T5.2) |
| ⑤ `ctx.location.directory` après `opencode2 plugin add` = package installé ? `location` absolu + `content` hydraté fonctionnent ? | `ctx.location: Location.Info` avec `directory`, `workspaceID`, `project:{id,directory,canonical}`. Pour un plugin npm/Git installé, `directory` pointe vers le **package installé** (cache plugins) ; pour `.opencode/plugins/*.ts` c'est le workspace. Implémentation robuste : résolution via `fileURLToPath(import.meta.url)` (prioritaire) + fallback `ctx.location.directory`. Tests `location` absolu + `content` hydraté OK (skills `location: resolve(...)`, `content: hydrateSkill(md)`) | T1.1/T1.2 (chemins references absolus), T2.1 |
| ⑥ Signature exacte `ctx.session.prompt` (champ `text:` requis ?) | `ctx.session.prompt(input: SessionPromptInput)` où `text` est requis (`SessionPromptInput.text: {text: string, files?, agents?, skills?, metadata?}`). `CommandInvocation` fournit `prompt: PromptInput.Prompt` avec `text`. Implémentation passthrough : `await ctx.session.prompt({sessionID, text: prompt.text, files: prompt.files, skills:[{id}], delivery})`. Vérifié via `@opencode-ai/client` + `@opencode-ai/schema/prompt-input` | T2.2 (passthrough commands) |
