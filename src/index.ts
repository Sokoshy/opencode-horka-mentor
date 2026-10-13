import { Plugin } from "@opencode/plugin";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expandPath } from "./lib/paths";
import { parseDueTopics, parseProfile } from "./lib/memory";
import { readTopicFiles, readTopics } from "./lib/topics";
import { hasExplicitSkills, normalizePromptHash, shouldConsider, type ProactiveState } from "./lib/proactive-policy";
import { formatReminder } from "./lib/reminder";

const MARKER = "[horka-mentor]";
const todayISO = () => new Date().toISOString().slice(0, 10);
const safeRead = (p: string): Promise<string | null> => readFile(p, "utf8").catch(() => null);

async function firstExisting(cands: string[], dir: boolean): Promise<string | null> {
  for (const c of cands) { try { const s = await stat(c); if (dir ? s.isDirectory() : s.isFile()) return c; } catch {} }
  return null;
}

export default Plugin.define({
  id: "horka-mentor",
  async setup(ctx) {
    // 1. package / location dirs
    const locDir = (ctx as any)?.location?.directory ?? process.cwd();
    let pkgDir = locDir;
    try {
      pkgDir = dirname(fileURLToPath(import.meta.url));
    } catch {
      console.warn("[horka-mentor] import.meta.url illisible, fallback locDir");
    }
    // 2. references + options
    const referencesDir = (await firstExisting([join(pkgDir, "references"), join(dirname(pkgDir), "src", "references"), join(locDir, "src", "references")], true)) ?? join(pkgDir, "references");
    const opts = (ctx.options ?? {}) as Record<string, unknown>;
    const memoryPath = typeof opts.memoryPath === "string" ? expandPath(opts.memoryPath) : expandPath("~/.config/opencode/mentor");
    const fallbackPath = opts.compatClaudePath === true ? expandPath("~/.claude/mentor") : memoryPath;
    const memoryPaths = {
      primary: memoryPath, fallback: fallbackPath,
      get differs() { return fallbackPath !== memoryPath; },
      paths(...segs: string[]): string[] {
        const p = join(memoryPath, ...segs);
        return fallbackPath === memoryPath ? [p] : [p, join(fallbackPath, ...segs)];
      },
    };
    const proactiveOpt = opts.proactive !== false;
    const context7Opt = opts.context7;
    const context7Disabled = context7Opt === false;
    const context7Url = typeof context7Opt === "string" && context7Opt.length > 0 ? context7Opt : "https://mcp.context7.com/mcp";
    const context7ApiKey = typeof opts.context7ApiKey === "string" ? opts.context7ApiKey : undefined;

    const safeSet = (k: string, v: unknown) => ctx.storage.set(k, v as any).catch(() => {});
    const safeGet = (k: string): Promise<any> => ctx.storage.get(k).catch(() => null);
    const tryFallback = async (...segs: string[]): Promise<string | null> => {
      for (const p of memoryPaths.paths(...segs)) { const c = await safeRead(p); if (c !== null) return c; }
      return null;
    };
    const mirror = (k: string, v: unknown) => safeSet(`mirror:${k}`, v);
    const readMemoryFile = async (segs: string[], notFound: string) => {
      const content = await tryFallback(...segs);
      await mirror(segs[segs.length - 1].replace(/\.md$/, ""), content);
      return { content: content ?? notFound };
    };
    const updateState = async (sid: string, patch: { lastPrompt?: string; mode?: "learn" | "build" }) => { await safeSet(`state:${sid}`, { ...((await safeGet(`state:${sid}`)) ?? {}), ...patch, at: Date.now() }); };
    const getProactive = async (sid: string): Promise<ProactiveState> => {
      const s = await safeGet(`proactive:${sid}`);
      return { count: typeof s?.count === "number" ? s.count : 0, seen: Array.isArray(s?.seen) ? s.seen : [], cooldown: s?.cooldown === true, lastOutcome: s?.lastOutcome, updatedAt: typeof s?.updatedAt === "number" ? s.updatedAt : 0 };
    };
    async function readDueTopics() {
      const dir = await firstExisting(memoryPaths.paths("topics"), true);
      const profile = await tryFallback("dev-profile.md");
      const language = profile ? parseProfile(profile).language : "en";
      if (!dir) return { due: [], language };
      return { due: parseDueTopics(await readTopicFiles(dir), todayISO()), language };
    }

    // 4-5. skills (hydrate + fallback inline)
    let mentorContent = "# Horka Mentor\nContenu manquant — vérifie src/skills/horka-mentor.md";
    let quizContent = "# Horka Mentor Quiz\nContenu manquant — vérifie src/skills/horka-mentor-quiz.md";
    let mentorLocation = join(referencesDir, "..", "skills", "horka-mentor.md");
    let quizLocation = join(referencesDir, "..", "skills", "horka-mentor-quiz.md");
    try {
      const m = await firstExisting([join(pkgDir, "skills", "horka-mentor.md"), join(locDir, "src", "skills", "horka-mentor.md")], false);
      const q = await firstExisting([join(pkgDir, "skills", "horka-mentor-quiz.md"), join(locDir, "src", "skills", "horka-mentor-quiz.md")], false);
      if (m) { mentorLocation = m; const raw = await safeRead(m); if (raw) mentorContent = raw; }
      if (q) { quizLocation = q; const raw = await safeRead(q); if (raw) quizContent = raw; }
      const hydrate = (md: string) => md.replaceAll("{{memoryPath}}", memoryPaths.primary).replaceAll("{{memoryPathFallback}}", memoryPaths.fallback).replaceAll("{{referencesDir}}", referencesDir);
      mentorContent = hydrate(mentorContent);
      quizContent = hydrate(quizContent);
    } catch (e) {
      console.warn("[horka-mentor] skills fallback inline:", (e as Error)?.message);
    }

    // 6-9. registrations (each non-critical, warn-only)
    try {
      await ctx.skill.transform((draft) => {
        draft.add({ id: "horka-mentor" as any, name: "Horka Mentor" as any, description: "Teaching AI mentor — learn/build/proactif/spaced repetition. Invoke: mentor, mentor learn, mentor build.", path: resolve(mentorLocation) as any, content: mentorContent, autoinvoke: true } as any);
        draft.add({ id: "horka-mentor-quiz" as any, name: "Horka Mentor Quiz" as any, description: "Quiz spaced repetition. Invoke: mentor quiz, quiz, revision.", path: resolve(quizLocation) as any, content: quizContent, autoinvoke: false } as any);
      });
    } catch (e) {
      console.warn("[horka-mentor] skill registration failed:", (e as Error)?.message);
    }

    try {
      await ctx.command.transform((draft) => {
        const register = (name: string, description: string, skillId?: string, modeHint?: "learn" | "build") => {
          draft.add({
            name,
            description,
            execute: async ({ sessionID, prompt, delivery }: any) => {
              await safeSet(`active:${sessionID}`, { at: Date.now(), via: name });
              const text = String((prompt as any)?.text ?? "");
              const payload: any = { sessionID, delivery, text };
              if ((prompt as any)?.files) payload.files = (prompt as any).files;
              if ((prompt as any)?.agents) payload.agents = (prompt as any).agents;
              const existing = (prompt as any)?.skills ?? [];
              if (skillId) payload.skills = [...existing, { id: skillId }];
              else if (existing.length) payload.skills = existing;
              if (!payload.text.trim()) payload.text = skillId === "horka-mentor-quiz" ? "quiz" : modeHint ? `mentor ${modeHint}` : "mentor";
              const mode = (/^\s*(?:mentor\s+)?(learn|build)\b/i.exec(payload.text)?.[1] as "learn" | "build" | undefined) ?? modeHint;
              await updateState(sessionID, { lastPrompt: payload.text, ...(mode ? { mode } : {}) });
              await ctx.session.prompt(payload);
            },
          });
        };
        register("mentor", "Mentor pédagogique (learn/build/profil/topics/proactif)", "horka-mentor");
        register("mentor-learn", "Mentor mode LEARN — apprendre un concept (1 question ouverte max)", "horka-mentor", "learn");
        register("mentor-build", "Mentor mode BUILD — construire sur un concept (évaluation max 1 question)", "horka-mentor", "build");
        register("mentor-quiz", "Quiz spaced repetition", "horka-mentor-quiz");
        register("quiz", "Alias mentor-quiz", "horka-mentor-quiz");
        register("revision", "Alias mentor-quiz", "horka-mentor-quiz");
        draft.add({
          name: "mentor-status",
          description: "Diagnostic mentor : mémoire, Context7, proactif, topics dus",
          execute: async ({ sessionID, delivery }: any) => {
            const { due } = await readDueTopics();
            await ctx.session.prompt({ sessionID, delivery, text: `MENTOR STATUS\n- Mémoire: ${memoryPaths.primary}${memoryPaths.differs ? ` (fallback ${memoryPaths.fallback})` : ""}\n- Proactif: ${proactiveOpt ? "on" : "off"}\n- Context7: ${context7Disabled ? "désactivé (mode pseudocode)" : context7Url}\n- Topics dus: ${due.length}${due.length ? ` (${due.slice(0, 5).map((t) => t.slug).join(", ")})` : ""}` } as any);
          },
        });
      });
    } catch (e) {
      console.warn("[horka-mentor] command registration failed:", (e as Error)?.message);
    }
    try {
      await ctx.mcp.transform((draft) => {
        if (context7Disabled || draft.get("context7")) return;
        const cfg: any = { type: "remote", url: context7Url };
        if (context7ApiKey) cfg.headers = { Authorization: `Bearer ${context7ApiKey}` };
        draft.set("context7", cfg);
      });
    } catch (e) {
      console.warn("[horka-mentor] mcp registration failed:", (e as Error)?.message);
    }
    try {
      await ctx.tool.transform((draft) => {
        const handlers: Record<string, (input: any) => Promise<{ content: string }>> = {
          get_profile: () => readMemoryFile(["dev-profile.md"], `No profile found at ${join(memoryPaths.primary, "dev-profile.md")}. Cold start required: ask 4 questions (name/language/experience/stack).`),
          list_topics: async () => {
            const dir = await firstExisting(memoryPaths.paths("topics"), true);
            if (!dir) return { content: `No topics directory at ${join(memoryPaths.primary, "topics")}. No topics covered yet.` };
            const topics = await readTopics(dir);
            topics.sort((a, b) => (a.next_review || "9999").localeCompare(b.next_review || "9999"));
            await mirror("topics", topics);
            return { content: JSON.stringify({ directory: dir, count: topics.length, topics }, null, 2) };
          },
          get_topic: async (input) => {
            const topic = input?.topic as string | undefined;
            if (!topic) return { content: "Missing required field: topic (slug, e.g. 'async-await')" };
            const slug = topic.replace(/\.md$/, "").toLowerCase();
            return readMemoryFile(["topics", `${slug}.md`], `Topic "${slug}" not found at ${join(memoryPaths.primary, "topics", `${slug}.md`)}.`);
          },
          get_quiz_log: () => readMemoryFile(["quiz-log.md"], `No quiz-log at ${join(memoryPaths.primary, "quiz-log.md")}. No reviews scheduled yet.`),
          check_proactive: async (input) => {
            const profile = await tryFallback("dev-profile.md");
            const dir = await firstExisting(memoryPaths.paths("topics"), true);
            const payload = { memoryPath: memoryPaths.primary, memoryPathFallback: memoryPaths.differs ? memoryPaths.fallback : undefined, prompt: input?.prompt ?? "(no prompt provided)", today: todayISO(), profile: profile ? profile.slice(0, 4000) : null, topics: dir ? await readTopics(dir) : [], hint: "JUGEMENT INTERVENE à faire par le modèle via pedagogy.md (INTERVENE vs NEVER, critères ALL/ANY). Ne pas décider en TS par keywords." };
            await mirror("check_proactive:last", payload);
            return { content: JSON.stringify(payload, null, 2) };
          },
          record_proactive: async (input) => {
            const sid = input?.sessionID as string | undefined;
            const outcome = input?.outcome as "intervened" | "skipped" | "ignored" | undefined;
            if (!sid) return { content: "Missing required field: sessionID." };
            if (outcome !== "intervened" && outcome !== "skipped" && outcome !== "ignored") return { content: `Invalid outcome: ${outcome}. Valid: intervened, skipped, ignored.` };
            const prev = await getProactive(sid);
            const seen = typeof input?.hash === "string" && !prev.seen.includes(input.hash) ? [...prev.seen, input.hash] : prev.seen;
            await safeSet(`proactive:${sid}`, { ...prev, seen, cooldown: outcome === "skipped" ? true : prev.cooldown, lastOutcome: outcome, updatedAt: Date.now() });
            return { content: `recorded ${outcome} for ${sid}${outcome === "skipped" ? " (cooldown on)" : ""}` };
          },
        };
        draft.add({
          name: "mentor_progress",
          description: `Gère la progression mentor: ${Object.keys(handlers).join(", ")}. Source de vérité = filesystem ${memoryPaths.primary} ; miroir ctx.storage write-only.`,
          input: { type: "object", properties: { action: { type: "string", enum: Object.keys(handlers) }, topic: { type: "string" }, prompt: { type: "string" }, sessionID: { type: "string" }, outcome: { type: "string", enum: ["intervened", "skipped", "ignored"] }, hash: { type: "string" } }, required: ["action"], additionalProperties: false } as any,
          options: { namespace: "horka" } as any,
          execute: async (input: any, context: any) => {
            const sid = (input as any)?.sessionID ?? context?.sessionID;
            const mergedInput = { ...input, sessionID: sid };
            const h = handlers[(input as any)?.action];
            return h ? h(mergedInput) : { content: `Unknown action: ${(input as any)?.action}. Valid: ${Object.keys(handlers).join(", ")}` };
          },
        } as any);
      });
    } catch (e) {
      console.warn("[horka-mentor] tool registration failed:", (e as Error)?.message);
    }
    try {
      await ctx.session.hook("prompt", async (event: any) => {
        if (!proactiveOpt) return;
        const raw: string = event.prompt?.text ?? "";
        const sid = (event.sessionID as string) ?? "";
        if (!sid) return;
        if (raw?.trim()) await updateState(sid, { lastPrompt: raw });
        if (hasExplicitSkills(event.prompt ?? {})) { await safeSet(`active:${sid}`, { at: Date.now(), via: "explicit" }); return; }
        if (!shouldConsider(raw, event.prompt ?? {})) return;
        const state = await getProactive(sid);
        if (state.cooldown || state.count >= 2) return;
        const hash = normalizePromptHash(raw);
        if (state.seen.includes(hash)) return;
        await safeSet(`active:${sid}`, { at: Date.now(), via: "proactive" });
        try {
          event.prompt.text = `[horka-mentor:proactive] Si cette requête implique un concept non couvert par \`${memoryPaths.primary}/topics/\` (ou niveau < confident et non évalué <30j), applique le protocole mentor Step 2 Proactif du skill horka-mentor (INTERVENE vs NEVER selon ${referencesDir}/pedagogy.md) : 1 question ouverte max (jamais oui/non), throttle 2/session, "skip" = cooldown, jamais sur concepts triviaux. Consulte la mémoire via le tool horka_mentor_progress (check_proactive) avant de juger. Sinon, ignore ce rappel et réponds normalement.\n\n` + raw;
        } catch {}
        await safeSet(`proactive:${sid}`, { ...state, count: state.count + 1, seen: [...state.seen, hash], updatedAt: Date.now() });
      });
    } catch (e) {
      console.warn("[horka-mentor] prompt hook failed:", (e as Error)?.message);
    }

    try {
      await ctx.session.hook("context", async (event: any) => {
        const sid = (event.sessionID as string) ?? "";
        if (!sid) return;
        if (!(await safeGet(`active:${sid}`))) return;
        try {
          for (const part of event.system ?? []) { const txt = typeof part === "string" ? part : part?.text ?? ""; if (typeof txt === "string" && txt.includes(MARKER)) return; }
        } catch {}
        let hint = "Context7 indisponible — limite aux APIs natives et pseudocode (voir Step 0).";
        try {
          const found = Object.keys(event.tools ?? {}).filter((k) => k.toLowerCase().includes("context7"));
          if (found.length) hint = `Tools Context7 disponibles: ${found.join(", ")} (utilise resolve-library-id → query-docs).`;
        } catch {}
        if (!Array.isArray(event.system)) event.system = [];
        event.system.push({ type: "text", text: `${MARKER} Tu es horka-mentor pour cette session. Respecte strictement le skill horka-mentor et ${referencesDir}/pedagogy.md : jamais de questions oui/non, max 1 question d'évaluation par concept en BUILD (max 2 avec backstep prérequis, budgets séparés), toujours mettre à jour la mémoire (${memoryPaths.primary}/topics/<slug>.md, quiz-log.md, dev-profile.md) après chaque interaction, toujours vérifier la doc via Context7 avant un exemple d'API framework/library. Mémoire: ${memoryPaths.primary}/${memoryPaths.differs ? ` (fallback ${memoryPaths.fallback})` : ""}. ${hint} Règles: profil privé, commentaires code en anglais, topics font foi sur quiz-log, respecter skip (needs-revisit).` } as any);
        try {
          if (!(await safeGet(`reminderDone:${sid}`))) {
            const { due, language } = await readDueTopics();
            await safeSet(`reminderDone:${sid}`, true);
            const reminder = formatReminder(language, due);
            if (reminder) event.system.push({ type: "text", text: reminder } as any);
          }
        } catch {}
      });
    } catch (e) {
      console.warn("[horka-mentor] context hook failed:", (e as Error)?.message);
    }

    try {
      await ctx.session.hook("compaction", async (event: any) => {
        const sid: string | undefined = event?.sessionID ?? event?.sessionId;
        if (!sid || !(await safeGet(`active:${sid}`))) return;
        const topics = await readTopics((await firstExisting(memoryPaths.paths("topics"), true)) ?? join(memoryPaths.primary, "topics"));
        const summary = topics.slice(0, 20).map((t) => `- ${t.slug}: ${t.level} (next: ${t.next_review})`).join("\n");
        const st = (await safeGet(`state:${sid}`)) ?? {};
        try {
          if (Array.isArray(event?.system)) event.system.push({ type: "text", text: `${MARKER} État pédagogique à préserver dans le résumé:\n- Mémoire: ${memoryPaths.primary}/\n- Topics:\n${summary || "(aucun)"}\n- Règles: jamais oui/non, max 1 question BUILD, maj mémoire, Context7 APIs, respecter skip.\n- Mode: ${st.mode ?? "(non détecté)"}\n- Dernière requête: ${typeof st.lastPrompt === "string" ? `"${st.lastPrompt}"` : "(aucune)"}\n- Question posée par le mentor dans topics/<slug>.md + quiz-log.md.` } as any);
        } catch {}
      });
    } catch (e) {
      console.warn("[horka-mentor] compaction hook failed:", (e as Error)?.message);
    }

    // 10. cleanup (aucun intervalle persistant)
    return () => {};
  },
});
