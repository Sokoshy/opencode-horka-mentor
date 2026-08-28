import { Plugin } from "@opencode-ai/plugin"
import { readFile, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandPath(p: string): string {
  if (p === "~") return homedir()
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  return p
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseStatusField(content: string, field: string): string | undefined {
  const re = new RegExp(`^-\\s*\\*\\*${field}\\*\\*:\\s*(.+)$`, "m")
  const m = content.match(re)
  return m?.[1]?.trim()
}

async function safeRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function resolveSkillContent(primaryUrl: string, fallbackPath: string): Promise<string> {
  try {
    return await readFile(new URL(primaryUrl, import.meta.url), "utf8")
  } catch {
    try {
      return await readFile(fallbackPath, "utf8")
    } catch {
      return ""
    }
  }
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
    const candidates = [
      join(pkgDir, "references"),
      join(dirname(pkgDir), "src", "references"),
      join(locDir, "src", "references"),
    ]
    let referencesDir = candidates[0]
    for (const c of candidates) {
      try {
        const s = await stat(c)
        if (s.isDirectory()) {
          referencesDir = c
          break
        }
      } catch {}
    }

    const opts = (ctx.options ?? {}) as Record<string, unknown>
    const memoryPathRaw = typeof opts.memoryPath === "string" ? (opts.memoryPath as string) : "~/.config/opencode/mentor"
    const memoryPath = expandPath(memoryPathRaw)
    const compatClaudePath = opts.compatClaudePath === true
    const memoryPathFallback = compatClaudePath ? expandPath("~/.claude/mentor") : memoryPath
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

    let mentorRaw = ""
    let quizRaw = ""
    for (const p of mentorCandidates) {
      const c = await safeRead(p)
      if (c) {
        mentorRaw = c
        break
      }
    }
    for (const p of quizCandidates) {
      const c = await safeRead(p)
      if (c) {
        quizRaw = c
        break
      }
    }

    // Fallback inline minimal content if files missing (dev error — still load plugin)
    if (!mentorRaw) mentorRaw = "# Horka Mentor\nContenu manquant — vérifie src/skills/horka-mentor.md"
    if (!quizRaw) quizRaw = "# Horka Mentor Quiz\nContenu manquant — vérifie src/skills/horka-mentor-quiz.md"

    const hydrateSkill = (md: string) =>
      md
        .replaceAll("{{memoryPath}}", memoryPath)
        .replaceAll("{{memoryPathFallback}}", memoryPathFallback)
        .replaceAll("{{referencesDir}}", referencesDir)

    const mentorContent = hydrateSkill(mentorRaw)
    const quizContent = hydrateSkill(quizRaw)

    const mentorLocation = join(referencesDir, "..", "skills", "horka-mentor.md")
    const quizLocation = join(referencesDir, "..", "skills", "horka-mentor-quiz.md")

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
      const passthrough =
        (name: string, description: string, skillId?: string) =>
        () => {
          draft.add({
            name,
            description,
            execute: async ({ sessionID, prompt, delivery }: any) => {
              // Mark session as mentor-active for context hook dedup
              try {
                await ctx.storage.set(`active:${sessionID}`, { at: Date.now(), via: name })
              } catch {}
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
                payload.text = skillId === "horka-mentor-quiz" ? "quiz" : "mentor"
              }
              await ctx.session.prompt(payload)
            },
          })
        }

      passthrough("mentor", "Mentor pédagogique (learn/build/profil/topics/proactif)", "horka-mentor")()
      passthrough("mentor-quiz", "Quiz spaced repetition", "horka-mentor-quiz")()
      passthrough("quiz", "Alias mentor-quiz", "horka-mentor-quiz")()
      passthrough("revision", "Alias mentor-quiz", "horka-mentor-quiz")()
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
        if (context7ApiKey) {
          cfg.headers = { Authorization: `Bearer ${context7ApiKey}` }
        } else if (process.env.CONTEXT7_API_KEY) {
          cfg.headers = { Authorization: `Bearer ${process.env.CONTEXT7_API_KEY}` }
        }
        draft.set("context7", cfg)
      }
    })

    // -----------------------------------------------------------------------
    // 4. Tool — horka_mentor_progress (5 actions, fs source de vérité, storage miroir)
    // -----------------------------------------------------------------------
    await ctx.tool.transform((draft) => {
      draft.add({
        name: "mentor_progress",
        description:
          "Gère la progression mentor: get_profile, list_topics, get_topic, get_quiz_log, check_proactive. Source de vérité = filesystem {{memoryPath}} ; miroir ctx.storage write-only.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["get_profile", "list_topics", "get_topic", "get_quiz_log", "check_proactive"],
            },
            topic: { type: "string", description: "slug du topic (ex: async-await)" },
            prompt: { type: "string", description: "requête utilisateur pour check_proactive" },
          },
          required: ["action"],
          additionalProperties: false,
        } as any,
        options: { namespace: "horka" } as any,
        execute: async (input: any, toolCtx: any) => {
          const action = (input as any)?.action as string
          const topic = (input as any)?.topic as string | undefined
          const promptText = (input as any)?.prompt as string | undefined

          const tryFallback = async (primary: string) => {
            const c = await safeRead(primary)
            if (c !== null) return c
            if (memoryPathFallback !== memoryPath) {
              const fallback = primary.replace(memoryPath, memoryPathFallback)
              return await safeRead(fallback)
            }
            return null
          }

          const mirror = (key: string, value: unknown) => {
            // fire-and-forget mirror to ctx.storage (write-only cache)
            void ctx.storage.set(`mirror:${key}`, value as any).catch(() => {})
          }

          if (action === "get_profile") {
            const p = join(memoryPath, "dev-profile.md")
            const content = await tryFallback(p)
            const result = content ?? null
            mirror("dev-profile", result)
            if (result === null) {
              return { content: `No profile found at ${p}${memoryPathFallback !== memoryPath ? ` (fallback ${join(memoryPathFallback, "dev-profile.md")} tried)` : ""}. Cold start required: ask 4 questions (name/language/experience/stack).` }
            }
            return { content: result }
          }

          if (action === "list_topics") {
            const tryPaths = [join(memoryPath, "topics"), ...(memoryPathFallback !== memoryPath ? [join(memoryPathFallback, "topics")] : [])]
            let dir = tryPaths[0]
            let entries: string[] = []
            for (const d of tryPaths) {
              try {
                entries = await readdir(d)
                dir = d
                break
              } catch {}
            }
            if (!entries.length) {
              try {
                await readdir(dir)
              } catch {
                return { content: `No topics directory at ${dir}. No topics covered yet.` }
              }
            }
            const topics: Array<Record<string, string>> = []
            for (const f of entries.filter((e) => e.endsWith(".md"))) {
              const full = join(dir, f)
              const c = await safeRead(full)
              if (!c) continue
              const level = parseStatusField(c, "Level") ?? "unknown"
              const last = parseStatusField(c, "Last assessed") ?? ""
              const next = parseStatusField(c, "Next review") ?? ""
              const step = parseStatusField(c, "Interval step") ?? ""
              const slug = f.replace(/\.md$/, "")
              topics.push({ slug, file: f, level, last_assessed: last, next_review: next, interval_step: step })
            }
            // sort by next_review ascending (due first)
            topics.sort((a, b) => (a.next_review || "9999").localeCompare(b.next_review || "9999"))
            mirror("topics", topics)
            return { content: JSON.stringify({ directory: dir, count: topics.length, topics }, null, 2) }
          }

          if (action === "get_topic") {
            if (!topic) return { content: "Missing required field: topic (slug, e.g. 'async-await')" }
            const slug = topic.replace(/\.md$/, "").toLowerCase()
            const p = join(memoryPath, "topics", `${slug}.md`)
            const content = await tryFallback(p)
            if (content === null) {
              // try glob-like search
              const dir = join(memoryPath, "topics")
              try {
                const files = await readdir(dir)
                const match = files.find((f) => f.toLowerCase().includes(slug) || slug.includes(f.replace(/\.md$/, "").toLowerCase()))
                if (match) {
                  const alt = await safeRead(join(dir, match))
                  if (alt) {
                    mirror(`topic:${slug}`, alt)
                    return { content: alt }
                  }
                }
              } catch {}
              return { content: `Topic "${slug}" not found at ${p}.` }
            }
            mirror(`topic:${slug}`, content)
            return { content }
          }

          if (action === "get_quiz_log") {
            const p = join(memoryPath, "quiz-log.md")
            const content = await tryFallback(p)
            const result = content ?? null
            mirror("quiz-log", result)
            if (result === null) return { content: `No quiz-log at ${p}. No reviews scheduled yet.` }
            return { content: result }
          }

          if (action === "check_proactive") {
            // Returns profile + topics summary so the MODEL can judge INTERVENE (not TS keywords)
            const profilePath = join(memoryPath, "dev-profile.md")
            const profile = await tryFallback(profilePath)
            const dir = join(memoryPath, "topics")
            let topicsSummary: Array<Record<string, string>> = []
            try {
              const files = await readdir(dir)
              for (const f of files.filter((e) => e.endsWith(".md"))) {
                const c = await safeRead(join(dir, f))
                if (!c) continue
                topicsSummary.push({
                  slug: f.replace(/\.md$/, ""),
                  level: parseStatusField(c, "Level") ?? "unknown",
                  last_assessed: parseStatusField(c, "Last assessed") ?? "",
                  next_review: parseStatusField(c, "Next review") ?? "",
                })
              }
            } catch {}
            // also try fallback
            if (!topicsSummary.length && memoryPathFallback !== memoryPath) {
              try {
                const files = await readdir(join(memoryPathFallback, "topics"))
                for (const f of files.filter((e) => e.endsWith(".md"))) {
                  const c = await safeRead(join(memoryPathFallback, "topics", f))
                  if (!c) continue
                  topicsSummary.push({
                    slug: f.replace(/\.md$/, ""),
                    level: parseStatusField(c, "Level") ?? "unknown",
                    last_assessed: parseStatusField(c, "Last assessed") ?? "",
                    next_review: parseStatusField(c, "Next review") ?? "",
                  })
                }
              } catch {}
            }
            const payload = {
              memoryPath,
              memoryPathFallback: memoryPathFallback !== memoryPath ? memoryPathFallback : undefined,
              prompt: promptText ?? "(no prompt provided)",
              today: todayISO(),
              profile: profile ? profile.slice(0, 4000) : null,
              topics: topicsSummary,
              hint: "JUGEMENT INTERVENE à faire par le modèle via pedagogy.md (INTERVENE vs NEVER, critères ALL/ANY). Ne pas décider en TS par keywords.",
            }
            mirror("check_proactive:last", payload)
            return { content: JSON.stringify(payload, null, 2) }
          }

          return { content: `Unknown action: ${action}. Valid: get_profile, list_topics, get_topic, get_quiz_log, check_proactive` }
        },
      } as any)
    })

    // -----------------------------------------------------------------------
    // 5. Hook proactif — minimaliste, throttle retry-safe, jugement délégué au modèle
    // -----------------------------------------------------------------------
    // In-memory throttle (complète le miroir storage pour retry-safety intra-process)
    const seenHashes = new Map<string, Set<string>>() // sessionID -> Set<hash>
    const injectionCount = new Map<string, number>()

    await ctx.session.hook("prompt", async (event: any) => {
      if (!proactive) return
      const raw: string = event.prompt?.text ?? ""
      if (!raw || raw.trim().length === 0) return
      // Skip injection for explicit mentor/quiz commands (they already attach skills) and for skip itself
      const lower = raw.trim().toLowerCase()
      if (lower.startsWith("skip") || lower === "pass" || lower.startsWith("/mentor proactif off")) return
      if (lower.startsWith("/mentor") || lower.startsWith("mentor") || lower.startsWith("/quiz") || lower.startsWith("quiz") || lower.startsWith("revision")) {
        // still mark active, but don't inject proactive prefix (explicit invocation)
        try {
          await ctx.storage.set(`active:${event.sessionID}`, { at: Date.now(), via: "explicit" })
        } catch {}
        return
      }

      const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16)
      const sid: string = event.sessionID

      // Retry-safety: if same hash already seen for this session, don't double-count
      let set = seenHashes.get(sid)
      if (!set) {
        set = new Set()
        seenHashes.set(sid, set)
      }
      if (set.has(hash)) return
      set.add(hash)

      // Throttle 2 injections / session (persisted in storage for cross-restart, mirrored in memory)
      let count = injectionCount.get(sid) ?? 0
      try {
        const stored = (await ctx.storage.get(`proactive:${sid}`)) as any
        if (stored && typeof stored.count === "number") count = Math.max(count, stored.count)
        if (stored?.cooldown) return
        if (stored?.skip) return
      } catch {}
      if (count >= 2) return

      // Detect skip in recent prompts for cooldown
      if (lower.includes("skip")) {
        try {
          await ctx.storage.set(`proactive:${sid}`, { count, skip: true, at: Date.now() })
        } catch {}
        return
      }

      // Mark session active for context hook
      try {
        await ctx.storage.set(`active:${sid}`, { at: Date.now(), via: "proactive" })
      } catch {}

      const prefix =
        `[horka-mentor:proactive] Si cette requête implique un concept non couvert par \`${memoryPath}/topics/\` (ou niveau < confident et non évalué <30j), ` +
        `applique le protocole mentor Step 2 Proactif du skill horka-mentor (INTERVENE vs NEVER selon {{referencesDir}}/pedagogy.md) : ` +
        `1 question ouverte max (jamais oui/non), throttle 2/session, "skip" = cooldown, jamais sur concepts triviaux. ` +
        `Consulte la mémoire via le tool horka_mentor_progress (check_proactive) avant de juger. Sinon, ignore ce rappel et réponds normalement.\n\n`

      // Inject prefix into prompt text (owned mutable draft)
      try {
        event.prompt.text = prefix.replace("{{referencesDir}}", referencesDir) + raw
      } catch {
        // fallback
        if (event.prompt && typeof event.prompt.text === "string") event.prompt.text = prefix + raw
      }

      const next = count + 1
      injectionCount.set(sid, next)
      try {
        await ctx.storage.set(`proactive:${sid}`, { count: next, at: Date.now() })
      } catch {}
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
        `toujours mettre à jour la mémoire (${memoryPath}/topics/<slug>.md, quiz-log.md, dev-profile.md) après chaque interaction, ` +
        `toujours vérifier la doc via Context7 avant un exemple d'API framework/library. ` +
        `Mémoire: ${memoryPath}/ (fallback ${memoryPathFallback}). ${context7Hint} ` +
        `Règles: profil privé, commentaires code en anglais, topics font foi sur quiz-log, respecter skip (needs-revisit).`

      try {
        event.system.push({ text: systemText } as any)
      } catch {
        try {
          event.system.push({ type: "text", text: systemText } as any)
        } catch {}
      }
    })

    // -----------------------------------------------------------------------
    // 7. Hook compaction — préservation état pédagogique
    //    Pas de hook typé "experimental.session.compacting" dans l'API beta actuelle ;
    //    on tente l'enregistrement si disponible (as any), sinon on s'appuie sur le
    //    context hook ci-dessus + l'état filesystem (source de vérité).
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
        // Collect minimal pedagogical state from filesystem for the compaction summary
        let topicsSummary = ""
        try {
          const dir = join(memoryPath, "topics")
          const files = await readdir(dir)
          const lines: string[] = []
          for (const f of files.filter((e) => e.endsWith(".md")).slice(0, 20)) {
            const c = await safeRead(join(dir, f))
            if (!c) continue
            const level = parseStatusField(c, "Level") ?? "unknown"
            const next = parseStatusField(c, "Next review") ?? ""
            lines.push(`- ${f.replace(/\.md$/, "")}: ${level} (next: ${next})`)
          }
          if (lines.length) topicsSummary = lines.join("\n")
        } catch {}
        const state =
          `${CONTEXT_MARKER} État pédagogique à préserver dans le résumé de compaction:\n` +
          `- Mémoire: ${memoryPath}/ (fallback ${memoryPathFallback})\n` +
          `- Topics & levels:\n${topicsSummary || "(aucun topic encore)"}\n` +
          `- Règles à conserver: jamais oui/non, max 1 question BUILD, toujours maj mémoire, Context7 pour APIs framework, respecter skip.\n` +
          `- Mode actif et dernière question posée — reprendre le fil pédagogique sans le perdre.`

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
