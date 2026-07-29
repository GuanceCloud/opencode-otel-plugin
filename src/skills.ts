import { readFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, resolve } from "node:path"

export interface SkillInfo {
  name: string
  path: string
  sourceType: "system" | "user" | "workspace"
  description?: string
  version?: string
}

const SKILL_PATH_PATTERN = /(?:^|[\s"'=`])((?:\/|\.{1,2}\/)[^\s"'`]*?SKILL\.md)(?=$|[\s"'`;,)])/g

function normalizeCandidate(candidate: string, directory: string): string {
  const cleaned = candidate.replace(/[),;]+$/, "")
  return isAbsolute(cleaned) ? cleaned : resolve(directory, cleaned)
}

function sourceType(path: string, directory: string): SkillInfo["sourceType"] {
  if (path.includes("/skills/.system/") || path.includes("/.system/skills/")) return "system"
  if (path.startsWith(`${resolve(directory)}/`)) return "workspace"
  return "user"
}

function parseFrontmatter(content: string): { name?: string; description?: string; version?: string } {
  if (!content.startsWith("---")) return {}
  const end = content.indexOf("\n---", 3)
  if (end === -1) return {}
  const result: Record<string, string> = {}
  for (const line of content.slice(3, end).split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+?)\s*$/)
    if (!match) continue
    const key = match[1]
    const raw = match[2]
    if (!key || !raw) continue
    result[key] = raw.replace(/^["']|["']$/g, "")
  }
  return {
    name: result.name,
    description: result.description,
    version: result.version,
  }
}

function findSkillPaths(value: unknown, directory: string, result = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(SKILL_PATH_PATTERN)) {
      const path = match[1]
      if (path) result.add(normalizeCandidate(path, directory))
    }
    return result
  }
  if (Array.isArray(value)) {
    for (const item of value) findSkillPaths(item, directory, result)
    return result
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      findSkillPaths(item, directory, result)
    }
  }
  return result
}

export async function detectSkills(args: unknown, directory: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []
  for (const path of findSkillPaths(args, directory)) {
    let frontmatter: ReturnType<typeof parseFrontmatter> = {}
    try {
      frontmatter = parseFrontmatter(await readFile(path, "utf8"))
    } catch {
      continue
    }
    skills.push({
      name: frontmatter.name || basename(dirname(path)),
      path,
      sourceType: sourceType(path, directory),
      description: frontmatter.description,
      version: frontmatter.version,
    })
  }
  return skills
}
