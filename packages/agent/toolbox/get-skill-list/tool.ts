import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { resolveBaseDir } from '../../services/resolve-base.ts'

const getSkillListSchema = z.object({})

type SkillSummary = {
  id: string
  name?: string
  description?: string
}

function getSkillsRoot() {
  return resolve(resolveBaseDir(), 'skills')
}

function toSkillId(root: string, filename: string) {
  return relative(root, dirname(filename))
}

function unquoteYamlValue(value: string) {
  const trimmed = value.trim()
  const quote = trimmed[0]

  if ((quote === '"' || quote === '\'') && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function parseSkillMetadata(content: string) {
  if (!content.startsWith('---\n')) return {}

  const endIndex = content.indexOf('\n---', 4)
  if (endIndex === -1) return {}

  const frontmatter = content.slice(4, endIndex)
  const metadata: Pick<SkillSummary, 'name' | 'description'> = {}

  for (const line of frontmatter.split('\n')) {
    const match = /^(name|description):\s*(.+)\s*$/.exec(line)
    if (!match) continue

    const [, key, value] = match
    metadata[key as 'name' | 'description'] = unquoteYamlValue(value)
  }

  return metadata
}

async function collectSkills(root: string, dir = root): Promise<SkillSummary[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const skills: SkillSummary[] = []

  for (const entry of entries) {
    const currentPath = join(dir, entry.name)
    if (entry.isFile() && entry.name === 'SKILL.md') {
      const content = await readFile(currentPath, 'utf-8')
      skills.push({
        id: toSkillId(root, currentPath),
        ...parseSkillMetadata(content),
      })
      continue
    }

    if (entry.isDirectory()) {
      skills.push(...await collectSkills(root, currentPath))
    }
  }

  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

export const getSkillListTool = tool(
  async () => {
    const root = getSkillsRoot()
    const skills = await collectSkills(root)

    return {
      count: skills.length,
      skills,
    }
  },
  {
    name: 'get_skill_list',
    description:
      'List available agent skills with ids, names, and descriptions.',
    schema: getSkillListSchema,
  },
)
