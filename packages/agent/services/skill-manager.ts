import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { AgentError } from '../types'
import type { InstalledSkillInfo, SkillInstallInput, SkillInstallResult, SkillInstallationStatus } from '../types'
import { resolveBaseDir } from './resolve-base'
import { isRecord } from '../utils/record.ts'

type GithubContentResponse = {
  type?: unknown
  path?: unknown
  encoding?: unknown
  content?: unknown
  html_url?: unknown
}

type GithubTreeResponse = {
  tree?: unknown
  truncated?: unknown
}

type GithubTreeItem = {
  path?: unknown
  type?: unknown
}

const githubRepoPattern = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i
const skillIdPattern = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[a-z0-9_.:@-]+(?:\/[a-z0-9_.:@-]+)*$/i

const skillPathCandidates = (skillId: string) => [
  `${skillId}/SKILL.md`,
  `skills/${skillId}/SKILL.md`,
  `skill/${skillId}/SKILL.md`,
  'SKILL.md'
]

function decodeGithubContent(content: string) {
  return Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf-8')
}

function unquoteYamlValue(value: string) {
  const trimmed = value.trim()
  const quote = trimmed[0]

  if ((quote === '"' || quote === '\'') && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function parseSkillName(content: string) {
  if (!content.startsWith('---\n')) return null

  const endIndex = content.indexOf('\n---', 4)
  if (endIndex === -1) return null

  const frontmatter = content.slice(4, endIndex)
  for (const line of frontmatter.split('\n')) {
    const match = /^name:\s*(.+)\s*$/.exec(line)
    if (!match?.[1]) continue

    return unquoteYamlValue(match[1])
  }

  return null
}

async function getGithubErrorMessage(response: Response) {
  try {
    const body = await response.json() as unknown
    if (isRecord(body) && typeof body.message === 'string' && body.message) {
      return body.message
    }
  } catch {
    // Ignore and use fallback below.
  }

  return `GitHub responded with ${response.status}`
}

function parseGithubContentResponse(payload: unknown) {
  if (!isRecord(payload)) {
    throw new AgentError('UPSTREAM_ERROR', 'GitHub returned an unexpected SKILL.md response')
  }

  const body: GithubContentResponse = payload
  if (body.type !== 'file'
    || typeof body.path !== 'string'
    || typeof body.encoding !== 'string'
    || typeof body.content !== 'string'
  ) {
    throw new AgentError('UPSTREAM_ERROR', 'GitHub returned an unexpected SKILL.md response')
  }

  if (body.encoding !== 'base64') {
    throw new AgentError('UPSTREAM_ERROR', 'GitHub returned SKILL.md with an unsupported encoding')
  }

  return {
    content: decodeGithubContent(body.content),
    githubPath: body.path,
    githubUrl: typeof body.html_url === 'string' ? body.html_url : undefined
  }
}

async function fetchGithubContent(source: string, path: string) {
  const url = new URL(`https://api.github.com/repos/${source}/contents/${path}`)
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'clawpro-agent',
    }
  })

  if (response.status === 404) return null

  if (!response.ok) {
    throw new AgentError(
      'UPSTREAM_ERROR',
      await getGithubErrorMessage(response),
      response.status
    )
  }

  return parseGithubContentResponse(await response.json())
}

function normalizeSkillLookup(value: string) {
  return value.toLowerCase()
}

function pathSkillName(path: string) {
  const parts = path.split('/')
  return parts.at(-2) ?? ''
}

function isSkillMatch(path: string, content: string, skillId: string) {
  const target = normalizeSkillLookup(skillId)
  const name = parseSkillName(content)
  if (name && normalizeSkillLookup(name) === target) return true

  const dirname = normalizeSkillLookup(pathSkillName(path))
  return dirname === target || dirname === normalizeSkillLookup(skillId.split('/').at(-1) ?? skillId)
}

async function fetchGithubSkillByRecursiveSearch(source: string, skillId: string) {
  const url = new URL(`https://api.github.com/repos/${source}/git/trees/HEAD`)
  url.searchParams.set('recursive', '1')

  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'clawpro-agent',
    }
  })

  if (response.status === 404) return null

  if (!response.ok) {
    throw new AgentError(
      'UPSTREAM_ERROR',
      await getGithubErrorMessage(response),
      response.status
    )
  }

  const payload = await response.json() as GithubTreeResponse
  const tree = Array.isArray(payload.tree) ? payload.tree as GithubTreeItem[] : []
  const skillPaths = tree
    .filter(item => item.type === 'blob' && typeof item.path === 'string' && item.path.endsWith('/SKILL.md'))
    .map(item => item.path as string)
    .sort((a, b) => a.localeCompare(b))

  for (const path of skillPaths) {
    const markdown = await fetchGithubContent(source, path)
    if (!markdown) continue

    if (isSkillMatch(path, markdown.content, skillId)) return markdown
  }

  return null
}

async function fetchSkillMarkdown(source: string, skillId: string) {
  const paths = skillPathCandidates(skillId)
  let found404 = false

  for (const path of paths) {
    const markdown = await fetchGithubContent(source, path)
    if (!markdown) {
      found404 = true
      continue
    }

    return markdown
  }

  const recursiveMatch = await fetchGithubSkillByRecursiveSearch(source, skillId)
  if (recursiveMatch) return recursiveMatch

  if (found404) {
    throw new AgentError('NOT_FOUND', `Could not find SKILL.md for ${source}/${skillId}`)
  }

  throw new AgentError('UPSTREAM_ERROR', 'Unable to fetch SKILL.md', 502)
}

export function createSkillManager() {
  const skillsDir = join(resolveBaseDir(), 'skills')

  function toSkillId(filename: string) {
    return relative(skillsDir, dirname(filename))
  }

  function isInsideSkillsDir(target: string) {
    const offset = relative(skillsDir, target)
    return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
  }

  function normalizeSkillId(skill: string) {
    return skill.replace(/^\/+|\/+$/g, '')
  }

  function parseSkillMetadata(content: string): Pick<InstalledSkillInfo, 'name' | 'description'> {
    if (!content.startsWith('---\n')) return { name: 'SKILL.md' }

    const endIndex = content.indexOf('\n---', 4)
    if (endIndex === -1) return { name: 'SKILL.md' }

    const frontmatter = content.slice(4, endIndex)
    const metadata: Partial<Pick<InstalledSkillInfo, 'name' | 'description'>> = {}

    for (const line of frontmatter.split('\n')) {
      const match = /^(name|description):\s*(.+)\s*$/.exec(line)
      if (!match) continue

      const key = match[1] as 'name' | 'description'
      const value = match[2]
      if (!value) continue

      metadata[key] = unquoteYamlValue(value)
    }

    return {
      name: metadata.name || 'SKILL.md',
      description: metadata.description
    }
  }

  async function collectInstalledSkills(dir = skillsDir): Promise<InstalledSkillInfo[]> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }

    const skills: InstalledSkillInfo[] = []

    for (const entry of entries) {
      const currentPath = join(dir, entry.name)
      if (entry.isFile() && entry.name === 'SKILL.md') {
        const content = await readFile(currentPath, 'utf-8')
        skills.push({
          id: toSkillId(currentPath),
          ...parseSkillMetadata(content)
        })
        continue
      }

      if (entry.isDirectory()) {
        skills.push(...await collectInstalledSkills(currentPath))
      }
    }

    return skills.sort((a, b) => a.id.localeCompare(b.id))
  }

  async function resolveInstalledSkillFilename(skill: string) {
    const normalizedSkill = normalizeSkillId(skill)
    const skillDir = resolve(skillsDir, normalizedSkill)

    if (!isInsideSkillsDir(skillDir)) {
      throw new AgentError('INVALID_INPUT', 'Skill id must stay inside the skills directory')
    }

    const skillPath = join(skillDir, 'SKILL.md')
    try {
      await access(skillPath)
      return skillPath
    } catch {
      throw new AgentError('NOT_FOUND', `Skill "${skill}" is not installed`)
    }
  }

  function validateInput(input: SkillInstallInput) {
    if (!githubRepoPattern.test(input.source) || !skillIdPattern.test(input.skillId)) {
      throw new AgentError('INVALID_INPUT', 'Skill source or skillId is not installable')
    }

    if (input.id !== `${input.source}/${input.skillId}`) {
      throw new AgentError('INVALID_INPUT', 'Skill id must match source and skillId')
    }
  }

  function canCheckInstall(input: SkillInstallInput) {
    return githubRepoPattern.test(input.source)
      && skillIdPattern.test(input.skillId)
      && input.id === `${input.source}/${input.skillId}`
  }

  function getInstallDir(input: SkillInstallInput) {
    return join(skillsDir, input.source, input.skillId)
  }

  return {
    async listInstalled(): Promise<InstalledSkillInfo[]> {
      return collectInstalledSkills()
    },

    async getInstalled(skill: string): Promise<InstalledSkillInfo> {
      const filename = await resolveInstalledSkillFilename(skill)
      const content = await readFile(filename, 'utf-8')

      return {
        id: toSkillId(filename),
        ...parseSkillMetadata(content),
        content
      }
    },

    async install(input: SkillInstallInput): Promise<SkillInstallResult> {
      validateInput(input)

      const markdown = await fetchSkillMarkdown(input.source, input.skillId)
      const installDir = getInstallDir(input)
      const skillPath = join(installDir, 'SKILL.md')

      await mkdir(installDir, { recursive: true })
      await writeFile(skillPath, markdown.content, 'utf-8')

      return {
        id: input.id,
        skillId: input.skillId,
        source: input.source,
        path: skillPath,
        githubPath: markdown.githubPath,
        githubUrl: markdown.githubUrl
      }
    },

    async uninstall(input: SkillInstallInput): Promise<{ id: string; skillId: string; source: string; path: string }> {
      validateInput(input)

      const installDir = getInstallDir(input)
      try {
        await access(installDir)
      } catch {
        throw new AgentError('NOT_FOUND', `Skill "${input.id}" is not installed`)
      }

      await rm(installDir, { recursive: true, force: true })

      return {
        id: input.id,
        skillId: input.skillId,
        source: input.source,
        path: installDir
      }
    },

    async checkSkillInstallation(skills: SkillInstallInput[]): Promise<SkillInstallationStatus[]> {
      return Promise.all(skills.map(async (skill) => {
        if (!canCheckInstall(skill)) {
          return { ...skill, installed: false }
        }

        try {
          await access(getInstallDir(skill))
          return { ...skill, installed: true }
        } catch {
          return { ...skill, installed: false }
        }
      }))
    }
  }
}

export type SkillManager = ReturnType<typeof createSkillManager>
