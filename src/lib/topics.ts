import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseStatusField } from "./paths";
import type { TopicRecord } from "./memory";

export type { TopicRecord };

const safeRead = (p: string): Promise<string | null> => readFile(p, "utf8").catch(() => null);

// All topics with parsed status fields. Unsorted (callers sort as needed).
export async function readTopics(dir: string): Promise<TopicRecord[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: TopicRecord[] = [];
  for (const f of entries.filter((e) => e.endsWith(".md"))) {
    const c = await safeRead(join(dir, f));
    if (!c) continue;
    out.push({
      slug: f.replace(/\.md$/, ""),
      file: f,
      level: parseStatusField(c, "Level") ?? "unknown",
      last_assessed: parseStatusField(c, "Last assessed") ?? "",
      next_review: parseStatusField(c, "Next review") ?? "",
      interval_step: parseStatusField(c, "Interval step") ?? "",
    });
  }
  return out;
}

// Raw topic files for due-date projection. Unsorted (parseDueTopics sorts).
export async function readTopicFiles(dir: string): Promise<{ slug: string; content: string }[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files: { slug: string; content: string }[] = [];
  for (const f of entries.filter((e) => e.endsWith(".md"))) {
    const c = await safeRead(join(dir, f));
    if (c !== null) files.push({ slug: f.replace(/\.md$/, ""), content: c });
  }
  return files;
}
