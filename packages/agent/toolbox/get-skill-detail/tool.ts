import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { resolveBaseDir } from '../../services/resolve-base.ts'

const getSkillDetailSchema = z.object({
  skill: z
    .string()
    .trim()
    .min(1)
    .describe('Skill id returned by get_relevant_skill. Short unique names are accepted.'),
})

type GetSkillDetailInput = z.infer<typeof getSkillDetailSchema>

function getSkillsRoot() {
  return resolve(resolveBaseDir(), 'skills')
}

function isInsideRoot(root: string, target: string) {
  const offset = relative(root, target)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

function toSkillId(root: string, filename: string) {
  return relative(root, dirname(filename))
}

async function fileExists(filename: string) {
  try {
    await stat(filename)
    return true
  } catch {
    return false
  }
}

function normalizeSkillInput(skill: string) {
  return skill.replace(/^\/+|\/+$/g, '')
}

async function findSkillMatches(root: string, target: string, dir = root): Promise<Array<[string, string]>> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const matches: Array<[string, string]> = []

  for (const entry of entries) {
    const currentFilename = join(dir, entry.name)

    if (entry.isFile() && entry.name === 'SKILL.md') {
      const id = toSkillId(root, currentFilename)
      if (id === target || id.endsWith(`/${target}`) || id.split('/').at(-1) === target) {
        matches.push([id, currentFilename])
      }
      continue
    }

    if (entry.isDirectory()) {
      matches.push(...await findSkillMatches(root, target, currentFilename))
    }
  }

  return matches.sort(([a], [b]) => a.localeCompare(b))
}

async function resolveSkillFilename(root: string, skill: string) {
  const normalizedSkill = normalizeSkillInput(skill)
  const directFilename = resolve(root, normalizedSkill)

  if (!isInsideRoot(root, directFilename)) {
    throw new Error('Skill id must stay inside the skills directory')
  }

  const directSkillFilename = directFilename.endsWith('SKILL.md')
    ? directFilename
    : join(directFilename, 'SKILL.md')

  if (await fileExists(directSkillFilename)) {
    return directSkillFilename
  }

  const matches = await findSkillMatches(root, normalizedSkill)

  if (matches.length === 1) return matches[0][1]

  if (matches.length > 1) {
    throw new Error(
      `Multiple skills match "${skill}": ${matches.map(([id]) => id).join(', ')}`,
    )
  }

  throw new Error(`Skill "${skill}" not found`)
}

export const getSkillDetailTool = tool(
  async ({ skill }: GetSkillDetailInput) => {
    const root = getSkillsRoot()
    const filename = await resolveSkillFilename(root, skill)
    const content = await readFile(filename, 'utf-8')

    return {
      id: toSkillId(root, filename),
      content,
    }
  },
  {
    name: 'get_skill_detail',
    description:
      'Get the full SKILL.md content for a selected skill id from get_relevant_skill.',
    schema: getSkillDetailSchema,
  },
)
