# opencode-horka-mentor

Pedagogical mentor for junior developers — port of the Claude Code `horka-mentor`
plugin to OpenCode. Runtime: bun on `@opencode/plugin@^2.0.7`.

- 2 skills (5 + 6 steps), 3 reference docs, 5+ commands
- 2 modes: `learn` (Socratic exploration) and `build` (code together)
- Security-directive mode + strict Context7 gate
- Proactive throttling: 2 prompts/session, retry-safe dedup, deterministic cooldown
- Spaced repetition J+1 → J+30, cross-stack translation, regression detection

> Source: `joey-barbier/ClaudeCode-Plugin/plugins/horka-mentor` → target OpenCode.
> Distribution is **GitHub only** (`opencode2 plugin add github:Sokoshy/opencode-horka-mentor`);
> no NPM publish is required.

---

## Installation

```sh
opencode2 plugin add github:Sokoshy/opencode-horka-mentor
opencode2 plugin list        # should show horka-mentor
opencode2 service restart
```

### Local development

```sh
git clone <repo> && cd opencode-horka-mentor
bun install
opencode2 service restart   # auto-discovered via .opencode/plugins/horka-mentor.ts
```

> **Important**: auto-discovery is enough. Never put `.opencode/plugins/horka-mentor.ts`
> into the `plugins` list of `opencode.jsonc` (otherwise:
> "configured plugin path must be a directory").
> `package.json` exposes `".": "./src/index.ts"` for `opencode2 plugin add`.

---

## Configuration (`opencode.jsonc`)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-horka-mentor", // or "github:Sokoshy/opencode-horka-mentor" / local path
      "options": {
        "memoryPath": "~/.config/opencode/mentor",   // default — global, cross-projects
        "proactive": true,                            // default true
        "context7": "https://mcp.context7.com/mcp",   // false to disable the MCP
        "context7ApiKey": "{env:CONTEXT7_API_KEY}",   // optional — Bearer header
        "compatClaudePath": false                     // true → fall back to ~/.claude/mentor
      }
    }
  ]
}
```

| Option | Purpose |
|---|---|
| `memoryPath` | Memory directory (`dev-profile.md`, `quiz-log.md`, `topics/*.md`). `~` is expanded. Injected into skills via `{{memoryPath}}`. |
| `compatClaudePath` | `true` reads `memoryPath` first, then `~/.claude/mentor/` as fallback (Claude Code migration). |
| `context7` / `context7ApiKey` | Declares the remote Context7 MCP and its Bearer key (see Context7 section). |
| `proactive` | Enables/disables minimal proactive injection. |

`ctx.storage` is a **write-only mirror** — filesystem stays the source of truth.

---

## Commands

| Command | Description |
|---|---|
| `/mentor` | Default **build** mode (code together) |
| `/mentor learn` | **learn** mode (Socratic exploration) |
| `/mentor build` | Explicit alias for build mode |
| `/mentor --no-context7` | Bypass Context7 → warning + pseudocode/concepts only |
| `/mentor proactif on\|off` | Enable/disable proactive mode |
| `/mentor profil` | Show `dev-profile.md` |
| `/mentor topics` | List covered topics with levels |
| `/mentor-status` | Diagnostics: memory, Context7, proactivity, due topics |
| `/mentor-quiz` / `/quiz` / `/revision` | Spaced repetition (3 due topics, specific topic, or `all`) |

The main skill has `autoinvoke: true` — the model can invoke it without a command
(proactive flow).

---

## Memory

```
~/.config/opencode/mentor/        # or ~/.claude/mentor/ with compat
├── dev-profile.md
├── quiz-log.md
└── topics/
    ├── async-await.md
    └── ...
```

- **Source of truth**: `topics/<slug>.md` (Status 7 fields + Context + history).
- **Levels**: `unknown → learning → understood → confident`
  (`src/references/level-up-rules.md`).
- **Spaced repetition**: J+1 → J+30 (`interval_step` 1–6).
- **Tool** `horka_mentor_progress` (namespace `horka`) exposes: `get_profile`,
  `list_topics`, `get_topic`, `get_quiz_log`, `check_proactive`, `record_proactive`.
- On divergence, filesystem wins (storage = cache/trace).

Templates live in `src/references/memory-templates.md`.

---

## Context7

- Declared automatically via `ctx.mcp.transform()`:
  `{type:"remote", url:"https://mcp.context7.com/mcp"}` +
  `Authorization: Bearer …` if key.
- Never overrides an existing `context7` config.
- **Hard gate by default**: the skill blocks without Context7 (`MENTOR BLOCKED`),
  except with `--no-context7` → warning + pseudocode.
- Quiz gate is **soft**: `[Context7 indisponible]` warning → limits to `explain` + native APIs.
- `context7: false` disables the declaration.
- **Web fetch is not an automatic substitute.**

Quick test: call `context7_resolve-library-id` with `query:"test"` — the server should
answer (even without results). Free key: https://context7.com/dashboard.

---

## Hooks (summary)

- **`prompt`** (proactive): throttle 2/session via `ctx.storage` (`proactive:<sessionID>`:
  `count`, `seen`, `cooldown`), dedup by prompt hash, cooldown after `skip` (via
  `record_proactive`, markdown fallback). `INTERVENE/NEVER` judgement delegated to the model.
- **`context`**: one-shot `[horka-mentor] …` injection (dedup by marker), dynamic
  Context7 tool discovery, unique quiz reminder (`reminderDone:<sessionID>`).
- **`compaction`**: injects topics/levels + `mode` + last prompt (`state:<sessionID>`),
  `event.result` left to the model.

---

## References

- `src/references/pedagogy.md` — 5 assessment methods, INTERVENE/COMMENT INLINE/NEVER,
  3 depth levels, ALL/ANY criteria, Security-Critical DIRECTIVE+batch, fast/slow
  /disengaged adaptation, dependency map, Dunning-Kruger, cross-stack, session length.
- `src/references/level-up-rules.md` — level transition table.
- `src/references/memory-templates.md` — memory templates adapted to Opencode paths.
- Conceptual check: `scripts/check-reference-sync.sh [canonical_dir]`.

---

## Development

```sh
bun run typecheck   # tsc --noEmit
bun test            # paths, memory, proactive-policy, reminder, storage-state
opencode2 service status
opencode2 plugin list
```

Compatibility: `@opencode/plugin@^2.0.7` (tested on OpenCode, bun runtime).
Test the installed package, not only the workspace link.

---

## Known limits (v1.1)

- No multi-user support.
- No custom dashboard/UI.
- No automatic web fetch (Context7 hard gate by default).
- Proactive cooldown depends on the model calling `record_proactive` (markdown fallback
  documented).

*Port of the source plugin — 2 skills 5+6 steps, 3 references, proactivity, spaced
repetition, cross-stack, regression, 10+7 rules.*
EOF