import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentError } from '../types'
import type { SkillInstallInput, SkillInstallResult, SkillInstallationStatus } from '../types'
import { resolveBaseDir } from './resolve-base'

type GithubContentResponse = {
  type?: unknown
  path?: unknown
  encoding?: unknown
  content?: unknown
  html_url?: unknown
}

const skillPathCandidates = (skillId: string) => [
  `${skillId}/SKILL.md`,
  `skills/${skillId}/SKILL.md`,
  `skill/${skillId}/SKILL.md`,
  'SKILL.md'
]

function decodeGithubContent(content: string) {
  return Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf-8')
}

async function getGithubErrorMessage(response: Response) {
  try {
    const body = await response.json() as unknown
    if (body && typeof body === 'object') {
      const errorBody = body as { message?: unknown }
      if (typeof errorBody.message === 'string' && errorBody.message) return errorBody.message
    }
  } catch {
    // Ignore and use fallback below.
  }

  return `GitHub responded with ${response.status}`
}

function parseGithubContentResponse(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    throw new AgentError('UPSTREAM_ERROR', 'GitHub returned an unexpected SKILL.md response')
  }

  const body = payload as GithubContentResponse
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

async function fetchSkillMarkdown(source: string, skillId: string) {
  const paths = skillPathCandidates(skillId)
  let found404 = false

  for (const path of paths) {
    const url = new URL(`https://api.github.com/repos/${source}/contents/${path}`)
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'clawpro-agent',
      }
    })

    if (response.status === 404) {
      found404 = true
      continue
    }

    if (!response.ok) {
      throw new AgentError(
        'UPSTREAM_ERROR',
        await getGithubErrorMessage(response),
        response.status
      )
    }

    return parseGithubContentResponse(await response.json())
  }

  if (found404) {
    throw new AgentError('NOT_FOUND', `Could not find SKILL.md for ${source}/${skillId}`)
  }

  throw new AgentError('UPSTREAM_ERROR', 'Unable to fetch SKILL.md', 502)
}

export function createSkillManager() {
  const skillsDir = join(resolveBaseDir(), 'skills')

  function validateInput(input: SkillInstallInput) {
    if (input.id !== `${input.source}/${input.skillId}`) {
      throw new AgentError('INVALID_INPUT', 'Skill id must match source and skillId')
    }
  }

  function getInstallDir(input: SkillInstallInput) {
    return join(skillsDir, input.source, input.skillId)
  }

  return {
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
        validateInput(skill)

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
