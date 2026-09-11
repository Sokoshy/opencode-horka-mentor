import { Plugin } from "@opencode-ai/plugin"
import { readFile, readdir, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { expandPath, parseStatusField } from "./lib/paths"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

async function safeRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function firstExisting(
  candidates: string[],
  match: (s: import("node:fs").Stats) => boolean,
): Promise<string | null> {
  for (const c of candidates) {
    try {
      const s = await stat(c)
      if (match(s)) return c
    } catch {}
  }
  return null
}

const firstFile = (candidates: string[]) => firstExisting(candidates, (s) => s.isFile())
const firstDir = (candidates: string[]) => firstExisting(candidates, (s) => s.isDirectory())

// Record partagé pour tous les lecteurs de topics (list_topics, check_proactive, compaction)
type TopicRecord = {
  slug: string
  file?: string
  level: string
  last_assessed: string
  next_review: string
  interval_step?: string
}

async function readTopics(dir: string): Promise<TopicRecord[]> {
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const topics: TopicRecord[] = []
  for (const f of entries.filter((e) => e.endsWith(".md"))) {
    const c = await safeRead(join(dir, f))
    if (!c) continue
    topics.push({
      slug: f.replace(/\.md$/, ""),
      file: f,
      level: parseStatusField(c, "Level") ?? "unknown",
      last_assessed: parseStatusField(c, "Last assessed") ?? "",
      next_review: parseStatusField(c, "Next review") ?? "",
      interval_step: parseStatusField(c, "Interval step") ?? "",
    })
  }
  return topics
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default Plugin.define({
  id: "horka-mentor",
  async setup(ctx) {
    // Resolve package / reference directories robustly for both npm-installed and local dev.
    // import.meta.url points to the transpiled file location (installed package cache or workspace).
    const locDir = (ctx as any)?.location?.directory ?? process.cwd()
    let pkgDir: string
    try {
      pkgDir = dirname(fileURLToPath(import.meta.url))
    } catch {
      pkgDir = locDir
    }
    // src/index.ts -> src/references ; if built to dist, adjust; fallback to locDir/src
    const referencesCandidates = [
      join(pkgDir, "references"),
      join(dirname(pkgDir), "src", "references"),
      join(locDir, "src", "references"),
    ]
    const referencesDirResolved = await firstDir(referencesCandidates)
    if (!referencesDirResolved) {
      console.warn(
        `[horka-mentor] Aucun dossier references trouvé; candidats essayés: ${referencesCandidates.join(", ")}`,
      )
    }
    const referencesDir = referencesDirResolved ?? referencesCandidates[0]

    const opts = (ctx.options ?? {}) as Record<string, unknown>
    const memoryPathRaw = typeof opts.memoryPath === "string" ? (opts.memoryPath as string) : "~/.config/opencode/mentor"
    const memoryPath = expandPath(memoryPathRaw)
    const compatClaudePath = opts.compatClaudePath === true
    const fallbackPath = compatClaudePath ? expandPath("~/.claude/mentor") : memoryPath

    // Couple primaire/fallback centralisé — le fallback n'apparaît que s'il diffère du primaire.
    // `paths(...segments)` construit les chemins candidats ICI (invariant local : pas de
    // chirurgie de string sur le chemin primaire par les appelants).
    const memoryPaths = {
      primary: memoryPath,
      fallback: fallbackPath,
      // true si un fallback distinct existe (compatClaudePath: true)
      get differs(): boolean {
        return fallbackPath !== memoryPath
      },
      // [cheminPrimaire, cheminFallback?] — le fallback seulement s'il diffère du primaire
      paths(...segments: string[]): string[] {
        const primary = join(memoryPath, ...segments)
        if (fallbackPath === memoryPath) return [primary]
        return [primary, join(fallbackPath, ...segments)]
      },
    }

    const proactive = opts.proactive !== false
    const context7Opt = opts.context7
    const context7Disabled = context7Opt === false
    const context7Url =
      typeof context7Opt === "string" && context7Opt.length > 0 ? (context7Opt as string) : "https://mcp.context7.com/mcp"
    const context7ApiKey =
      typeof opts.context7ApiKey === "string" ? (opts.context7ApiKey as string) : undefined

    // Load skill markdowns via fs (Node standard APIs only — no Bun.file)
    // Primary: relative to this file; fallback: locDir
    const mentorCandidates = [
      join(pkgDir, "skills", "horka-mentor.md"),
      join(locDir, "src", "skills", "horka-mentor.md"),
    ]
    const quizCandidates = [
      join(pkgDir, "skills", "horka-mentor-quiz.md"),
      join(locDir, "src", "skills", "horka-mentor-quiz.md"),
    ]
    const mentorSkillPath = await firstFile(mentorCandidates)
    const quizSkillPath = await firstFile(quizCandidates)

    let mentorRaw = mentorSkillPath ? await safeRead(mentorSkillPath) : null
    let quizRaw = quizSkillPath ? await safeRead(quizSkillPath) : null

    // Fallback inline minimal content if files missing (dev error — still load plugin)
    if (!mentorRaw) mentorRaw = "# Horka Mentor\nContenu manquant — vérifie src/skills/horka-mentor.md"
    if (!quizRaw) quizRaw = "# Horka Mentor Quiz\nContenu manquant — vérifie src/skills/horka-mentor-quiz.md"

    const hydrateSkill = (md: string) =>
      md
        .replaceAll("{{memoryPath}}", memoryPaths.primary)
        .replaceAll("{{memoryPathFallback}}", memoryPaths.fallback)
        .replaceAll("{{referencesDir}}", referencesDir)

    const mentorContent = hydrateSkill(mentorRaw)
    const quizContent = hydrateSkill(quizRaw)

    // Location réelle si le fichier skill a été trouvé, sinon dérivation depuis referencesDir
    const mentorLocation = mentorSkillPath ?? join(referencesDir, "..", "skills", "horka-mentor.md")
    const quizLocation = quizSkillPath ?? join(referencesDir, "..", "skills", "horka-mentor-quiz.md")

    // Set storage best-effort (échecs silencieux — le filesystem reste la source de vérité)
    const safeSet = (key: string, value: unknown) => ctx.storage.set(key, value as any).catch(() => {})

    // Read primary, fallback only if different (source de vérité = filesystem).
    // segments relatifs à la racine mémoire (ex: "dev-profile.md", "topics", "x.md")
    const tryFallback = async (...segments: string[]) => {
      for (const p of memoryPaths.paths(...segments)) {
        const c = await safeRead(p)
        if (c !== null) return c
      }
      return null
    }

    // Lecteur générique fichier mémoire: lecture (primaire→fallback), miroir, message si absent
    const readMemoryFile = async (segments: string[], notFound: string, mirrorKey?: string) => {
      const content = await tryFallback(...segments)
      await mirrorToStorage(mirrorKey ?? segments[segments.length - 1].replace(/\.md$/, ""), content)
      if (content === null) return { content: notFound }
      return { content }
    }

    // Miroir fire-and-forget vers ctx.storage (cache write-only)
    const mirrorToStorage = (key: string, value: unknown) => safeSet(`mirror:${key}`, value)

    // Read-modify-write du record état session (T4.3): mode actif + dernier prompt utilisateur.
    // NB: TS ne peut pas capturer la question POSÉE par le mentor (sortie modèle) — le fil
    // pédagogique complet vit dans topics/<slug>.md + quiz-log.md (source de vérité).
    const updateState = async (sid: string, patch: { lastPrompt?: string; mode?: "learn" | "build" }) => {
      let prev: any = null
      try {
        prev = await ctx.storage.get(`state:${sid}`)
      } catch {}
      await safeSet(`state:${sid}`, {
        ...(prev ?? {}),
        ...(patch.mode ? { mode: patch.mode } : {}),
        ...(patch.lastPrompt !== undefined ? { lastPrompt: patch.lastPrompt } : {}),
        at: Date.now(),
      })
    }

    // -----------------------------------------------------------------------
    // 1. Skills — 2 obligatoires
    // -----------------------------------------------------------------------
    await ctx.skill.transform((draft) => {
      draft.add({
        id: "horka-mentor" as any,
        name: "Horka Mentor" as any,
        description:
          "Teaching AI mentor — learn/build/proactif/spaced repetition. Invoke: mentor, mentor learn, mentor build.",
        location: resolve(mentorLocation) as unknown as string as any,
        content: mentorContent,
      } as any)
      draft.add({
        id: "horka-mentor-quiz" as any,
        name: "Horka Mentor Quiz" as any,
        description: "Quiz spaced repetition. Invoke: mentor quiz, quiz, revision.",
        location: resolve(quizLocation) as unknown as string as any,
        content: quizContent,
      } as any)
      // autoinvoke: true on horka-mentor reproduces proactive source behavior
      try {
        draft.update("horka-mentor", (s: any) => {
          s.autoinvoke = true
        })
      } catch {}
      try {
        draft.update("horka-mentor-quiz", (s: any) => {
          s.autoinvoke = false
        })
      } catch {}
    })

    // -----------------------------------------------------------------------
    // 2. Commands — mentor + mentor-quiz + alias quiz/revision
    // -----------------------------------------------------------------------
    await ctx.command.transform((draft) => {
      // Enregistre une commande qui passe le prompt à la session avec le skill attaché.
      // modeHint = sous-commande dédiée (mentor-learn / mentor-build) : le mode est fixé
      // par la commande, pas par le texte — l'autocomplete TUI ne complète que les noms
      // de commandes + descriptions, donc chaque sous-commande est une commande.
      const registerCommand = (
        name: string,
        description: string,
        skillId?: string,
        modeHint?: "learn" | "build",
      ) => {
        draft.add({
          name,
          description,
          execute: async ({ sessionID, prompt, delivery }: any) => {
            // Mark session as mentor-active for context hook dedup
            await safeSet(`active:${sessionID}`, { at: Date.now(), via: name })
            const text = (prompt as any)?.text ?? ""
            // Attach skill hint via prompt.skills if skillId provided — model will autoload skill
            // Use session.prompt with skill attachment; fallback to plain text if not supported
            const payload: any = { sessionID, delivery }
            // Preserve original prompt shape: text + files + skills
            if (typeof text === "string") payload.text = text
            else payload.text = String(text ?? "")
            // Preserve files/agents/skills from original prompt if present
            if ((prompt as any)?.files) payload.files = (prompt as any).files
            if ((prompt as any)?.agents) payload.agents = (prompt as any).agents
            const existingSkills = (prompt as any)?.skills ?? []
            if (skillId) {
              payload.skills = [...existingSkills, { id: skillId }]
            } else if (existingSkills.length) {
              payload.skills = existingSkills
            }
            // If text is empty (e.g. `/mentor` without args), provide a default trigger
            if (!payload.text || payload.text.trim() === "") {
              payload.text =
                skillId === "horka-mentor-quiz" ? "quiz" : modeHint ? `mentor ${modeHint}` : "mentor"
            }
            // État persistant (T4.3): mode via SOUS-COMMANDE uniquement (M2a: "le skill parse"
            // le reste) + dernier prompt utilisateur. Ancré au début du texte — pas de
            // détection sur le contenu ("explique le build system" ≠ mode build).
            // modeHint sert de fallback quand le texte ne parse pas (ex: `/mentor-learn sur X`).
            const mode =
              (/^\s*(?:mentor\s+)?(learn|build)\b/i.exec(payload.text)?.[1] as "learn" | "build" | undefined) ??
              modeHint
            await updateState(sessionID, { lastPrompt: payload.text, ...(mode ? { mode } : {}) })
            await ctx.session.prompt(payload)
          },
        })
      }

      registerCommand("mentor", "Mentor pédagogique (learn/build/profil/topics/proactif)", "horka-mentor")
      registerCommand(
        "mentor-learn",
        "Mentor mode LEARN — apprendre un concept (1 question ouverte max)",
        "horka-mentor",
        "learn",
      )
      registerCommand(
        "mentor-build",
        "Mentor mode BUILD — construire sur un concept (évaluation max 1 question)",
        "horka-mentor",
        "build",
      )
      registerCommand("mentor-quiz", "Quiz spaced repetition", "horka-mentor-quiz")
      registerCommand("quiz", "Alias mentor-quiz", "horka-mentor-quiz")
      registerCommand("revision", "Alias mentor-quiz", "horka-mentor-quiz")
    })

    // -----------------------------------------------------------------------
    // 3. MCP — context7 remote (ne surcharge pas une config existante)
    // -----------------------------------------------------------------------
    await ctx.mcp.transform((draft) => {
      if (context7Disabled) return
      if (!draft.get("context7")) {
        const cfg: any = {
          type: "remote",
          url: context7Url,
        }
        // T3.1: la clé se configure via {env:CONTEXT7_API_KEY} dans l'opencode.jsonc utilisateur
        if (context7ApiKey) {
          cfg.headers = { Authorization: `Bearer ${context7ApiKey}` }
        }
        draft.set("context7", cfg)
      }
    })

    // -----------------------------------------------------------------------
    // 4. Tool — horka_mentor_progress (5 actions, fs source de vérité, storage miroir)
    // -----------------------------------------------------------------------
    await ctx.tool.transform((draft) => {
      // Dispatch centralisé: enum du schéma dérivé de Object.keys(handlers)
      const handlers: Record<string, (input: any) => Promise<{ content: string }>> = {
        get_profile: async () => {
          const fallbackTried = memoryPaths.differs ? join(memoryPaths.fallback, "dev-profile.md") : undefined
          return readMemoryFile(["dev-profile.md"], `No profile found at ${join(memoryPaths.primary, "dev-profile.md")}${fallbackTried ? ` (fallback ${fallbackTried} tried)` : ""}. Cold start required: ask 4 questions (name/language/experience/stack).`)
        },

        list_topics: async () => {
          const tryDirs = memoryPaths.paths("topics")
          const dir = await firstDir(tryDirs)
          if (!dir) {
            return { content: `No topics directory at ${tryDirs[0]}. No topics covered yet.` }
          }
          const topics = await readTopics(dir)
          // sort by next_review ascending (due first)
          topics.sort((a, b) => (a.next_review || "9999").localeCompare(b.next_review || "9999"))
          await mirrorToStorage("topics", topics)
          return { content: JSON.stringify({ directory: dir, count: topics.length, topics }, null, 2) }
        },

        get_topic: async (input) => {
          const topic = input?.topic as string | undefined
          if (!topic) return { content: "Missing required field: topic (slug, e.g. 'async-await')" }
          const slug = topic.replace(/\.md$/, "").toLowerCase()
          const p = join(memoryPaths.primary, "topics", `${slug}.md`)
          return readMemoryFile(["topics", `${slug}.md`], `Topic "${slug}" not found at ${p}.`, `topic:${slug}`)
        },

        get_quiz_log: async () => {
          return readMemoryFile(["quiz-log.md"], `No quiz-log at ${join(memoryPaths.primary, "quiz-log.md")}. No reviews scheduled yet.`)
        },

        check_proactive: async (input) => {
          // Returns profile + topics summary so the MODEL can judge INTERVENE (not TS keywords)
          const promptText = input?.prompt as string | undefined
          const profile = await tryFallback("dev-profile.md")
          const tryDirs = memoryPaths.paths("topics")
          const dir = await firstDir(tryDirs)
          const topics = dir ? await readTopics(dir) : []
          const payload = {
            memoryPath: memoryPaths.primary,
            memoryPathFallback: memoryPaths.differs ? memoryPaths.fallback : undefined,
            prompt: promptText ?? "(no prompt provided)",
            today: todayISO(),
            profile: profile ? profile.slice(0, 4000) : null,
            topics,
            hint: "JUGEMENT INTERVENE à faire par le modèle via pedagogy.md (INTERVENE vs NEVER, critères ALL/ANY). Ne pas décider en TS par keywords.",
          }
          await mirrorToStorage("check_proactive:last", payload)
          return { content: JSON.stringify(payload, null, 2) }
        },
      }

      draft.add({
        name: "mentor_progress",
        description:
          `Gère la progression mentor: ${Object.keys(handlers).join(", ")}. Source de vérité = filesystem ${memoryPaths.primary} ; miroir ctx.storage write-only.`,
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: Object.keys(handlers),
            },
            topic: { type: "string", description: "slug du topic (ex: async-await)" },
            prompt: { type: "string", description: "requête utilisateur pour check_proactive" },
          },
          required: ["action"],
          additionalProperties: false,
        } as any,
        options: { namespace: "horka" } as any,
        execute: async (input: any) => {
          const action = (input as any)?.action as string
          const handler = handlers[action]
          if (!handler) {
            return { content: `Unknown action: ${action}. Valid: ${Object.keys(handlers).join(", ")}` }
          }
          return handler(input)
        },
      } as any)
    })

    // -----------------------------------------------------------------------
    // 5. Hook proactif — minimaliste, throttle retry-safe, jugement délégué au modèle
    // -----------------------------------------------------------------------
    // Retry-safety intra-process (complète le compteur persisté en storage — T4.1:
    // throttle keyé sur sessionId + hash(prompt), pas de détection keywords en TS)
    const seenHashes = new Map<string, Set<string>>() // sessionID -> Set<hash>

    await ctx.session.hook("prompt", async (event: any) => {
      if (!proactive) return
      const raw: string = event.prompt?.text ?? ""
      if (!raw || raw.trim().length === 0) return
      const sid: string = event.sessionID

      // État persistant (T4.3): dernier prompt utilisateur, à chaque prompt
      await updateState(sid, { lastPrompt: raw })

      // (a) Invocations de commandes: skills déjà attachés — pas d'injection proactive
      //     (pas de ré-entrée), on marque juste la session active
      if (Array.isArray(event.prompt?.skills) && event.prompt.skills.length > 0) {
        await safeSet(`active:${sid}`, { at: Date.now(), via: "explicit" })
        return
      }

      // (b) Slash commands: pas d'injection proactive
      if (raw.trim().startsWith("/")) return

      // (c) Throttle + injection (le skip/cooldown appartient au markdown du skill)
      const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16)

      // Retry-safety: if same hash already seen for this session, don't double-count
      let set = seenHashes.get(sid)
      if (!set) {
        set = new Set()
        seenHashes.set(sid, set)
      }
      if (set.has(hash)) return
      set.add(hash)

      // Throttle 2 injections / session — storage = source de vérité unique.
      // Pas de skip/cooldown en TS: délégués au skill markdown (T4.1).
      let stored: any = null
      try {
        stored = await ctx.storage.get(`proactive:${sid}`)
      } catch {}
      const count = typeof stored?.count === "number" ? stored.count : 0
      if (count >= 2) return

      // Mark session active for context hook
      await safeSet(`active:${sid}`, { at: Date.now(), via: "proactive" })

      // Préfixe hydraté UNE fois (pas de {{referencesDir}} littéral, y compris en fallback)
      const prefix =
        `[horka-mentor:proactive] Si cette requête implique un concept non couvert par \`${memoryPaths.primary}/topics/\` (ou niveau < confident et non évalué <30j), ` +
        `applique le protocole mentor Step 2 Proactif du skill horka-mentor (INTERVENE vs NEVER selon ${referencesDir}/pedagogy.md) : ` +
        `1 question ouverte max (jamais oui/non), throttle 2/session, "skip" = cooldown, jamais sur concepts triviaux. ` +
        `Consulte la mémoire via le tool horka_mentor_progress (check_proactive) avant de juger. Sinon, ignore ce rappel et réponds normalement.\n\n`

      // Inject prefix into prompt text (owned mutable draft)
      try {
        event.prompt.text = prefix + raw
      } catch {
        // fallback
        if (event.prompt && typeof event.prompt.text === "string") event.prompt.text = prefix + raw
      }

      await safeSet(`proactive:${sid}`, { count: count + 1, at: Date.now() })
    })

    // -----------------------------------------------------------------------
    // 6. Hook context — injection système avec dédup (à chaque appel modèle)
    // -----------------------------------------------------------------------
    const CONTEXT_MARKER = "[horka-mentor]"
    await ctx.session.hook("context", async (event: any) => {
      const sid: string = event.sessionID
      // Only inject if session was marked mentor-active (command or proactive)
      let active: unknown = null
      try {
        active = await ctx.storage.get(`active:${sid}`)
      } catch {}
      const isActive = !!active || seenHashes.has(sid)
      if (!isActive) return

      // Dedup: if system already contains marker, skip
      try {
        const sys: Array<any> = event.system ?? []
        for (const part of sys) {
          const txt = typeof part === "string" ? part : (part?.text ?? "")
          if (typeof txt === "string" && txt.includes(CONTEXT_MARKER)) return
        }
      } catch {}

      // Discover context7 tool names from available tools (dynamic, no hardcoding)
      let context7Hint = "Context7 indisponible — limite aux APIs natives et pseudocode (voir Step 0)."
      try {
        const toolKeys = Object.keys(event.tools ?? {})
        const ctxTools = toolKeys.filter((k) => k.toLowerCase().includes("context7"))
        if (ctxTools.length) {
          context7Hint = `Tools Context7 disponibles: ${ctxTools.join(", ")} (utilise resolve-library-id → query-docs).`
        }
      } catch {}

      const systemText =
        `${CONTEXT_MARKER} Tu es horka-mentor pour cette session. Respecte strictement le skill horka-mentor et ${referencesDir}/pedagogy.md : ` +
        `jamais de questions oui/non, max 1 question d'évaluation par concept en BUILD (max 2 avec backstep prérequis, budgets séparés), ` +
        `toujours mettre à jour la mémoire (${memoryPaths.primary}/topics/<slug>.md, quiz-log.md, dev-profile.md) après chaque interaction, ` +
        `toujours vérifier la doc via Context7 avant un exemple d'API framework/library. ` +
        `Mémoire: ${memoryPaths.primary}/${memoryPaths.differs ? ` (fallback ${memoryPaths.fallback})` : ""}. ${context7Hint} ` +
        `Règles: profil privé, commentaires code en anglais, topics font foi sur quiz-log, respecter skip (needs-revisit).`

      // LLM.SystemPart exige `type: "text"` (schéma validé strictement depuis beta-19271)
      event.system.push({ type: "text", text: systemText } as any)
    })

    // -----------------------------------------------------------------------
    // 7. Hook compaction — préservation état pédagogique
    //    Pas de hook typé "experimental.session.compacting" dans l'API beta actuelle ;
    //    on tente l'enregistrement si disponible (as any), sinon on s'appuie sur le
    //    context hook ci-dessus + l'état filesystem (source de vérité).
    //    On pousse l'état RÉEL (T4.3): topics & levels via readTopics, mode actif et
    //    dernier prompt utilisateur depuis le record state:<sid> (prompt hook + commandes) ;
    //    la question posée par le mentor reste dans topics/<slug>.md / quiz-log.md.
    // -----------------------------------------------------------------------
    try {
      await (ctx.session.hook as any)("experimental.session.compacting", async (input: any, output: any) => {
        const sid: string | undefined = input?.sessionID ?? input?.sessionId
        if (!sid) return
        let active: unknown = null
        try {
          active = await ctx.storage.get(`active:${sid}`)
        } catch {}
        if (!active && !seenHashes.has(sid)) return
        // Topics & levels réels depuis le filesystem
        const topics = await readTopics(join(memoryPaths.primary, "topics"))
        const topicsSummary = topics
          .slice(0, 20)
          .map((t) => `- ${t.slug}: ${t.level} (next: ${t.next_review})`)
          .join("\n")
        // Mode actif + dernier prompt utilisateur réels (record state:<sid>)
        let lastState: any = null
        try {
          lastState = await ctx.storage.get(`state:${sid}`)
        } catch {}
        const mode = typeof lastState?.mode === "string" ? lastState.mode : "(mode non détecté)"
        const lastPrompt =
          typeof lastState?.lastPrompt === "string" ? `"${lastState.lastPrompt}"` : "(aucune requête enregistrée)"
        const state =
          `${CONTEXT_MARKER} État pédagogique à préserver dans le résumé de compaction:\n` +
          `- Mémoire: ${memoryPaths.primary}/${memoryPaths.differs ? ` (fallback ${memoryPaths.fallback})` : ""}\n` +
          `- Topics & levels:\n${topicsSummary || "(aucun topic encore)"}\n` +
          `- Règles à conserver: jamais oui/non, max 1 question BUILD, toujours maj mémoire, Context7 pour APIs framework, respecter skip.\n` +
          `- Mode actif: ${mode}\n` +
          `- Dernière requête utilisateur: ${lastPrompt}\n` +
          `- La dernière question POSÉE par le mentor vit dans topics/<slug>.md et quiz-log.md — reprendre le fil pédagogique à partir de la mémoire.`

        try {
          if (Array.isArray(output?.context)) output.context.push(state)
          else if (output && typeof output === "object") output.context = [state]
        } catch {}
      })
    } catch {
      // Hook non supporté sur cette version beta — le context hook + FS state suffisent ; pas bloquant.
    }
  },
})
