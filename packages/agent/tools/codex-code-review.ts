import { execFile, spawn } from 'node:child_process'
import { tool } from 'langchain'
import type { ToolRuntime } from '@langchain/core/tools'
import { z } from 'zod'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const execFileAsync = promisify(execFile)

const schema = z.object({
  branch: z.string().trim().min(1).describe('The branch to review'),
  baseBranch: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Optional base branch. If omitted, the tool will infer a sensible default base branch and review the diff against it.',
    ),
  path: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Absolute or relative repository path. The tool will change directory to this path before running git and codex commands.',
    ),
  prompt: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Review instruction for Codex, for example: focus on bugs, regressions, risky logic, edge cases, and security issues.',
    ),
})

type ReviewBranchChangesInput = z.infer<typeof schema>

type RunResult = {
  stdout: string
  stderr: string
}

type RunOptions = {
  cwd?: string
}

type ReviewToolRuntime = ToolRuntime | { writer?: ((chunk: unknown) => void) | null }

function writeProgress(
  runtime: ReviewToolRuntime | undefined,
  message: string,
  extra: Record<string, unknown> = {},
): void {
  runtime?.writer?.({
    type: 'status',
    message,
    ...extra,
  })
}

function createLineWriter(
  streamName: 'stdout' | 'stderr',
  writer?: ((chunk: unknown) => void) | null,
): (chunk: string) => void {
  let buffer = ''

  return (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const text = line.trimEnd()
      if (!text) continue
      writer?.(`[codex:${streamName}] ${text}`)
    }
  }
}

function flushLineWriter(
  streamName: 'stdout' | 'stderr',
  writer?: ((chunk: unknown) => void) | null,
  remainder?: string,
): void {
  const text = remainder?.trim()
  if (text) {
    writer?.(`[codex:${streamName}] ${text}`)
  }
}

async function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      cwd: options.cwd,
    })

    return {
      stdout: result.stdout?.trim() ?? '',
      stderr: result.stderr?.trim() ?? '',
    }
  } catch (error) {
    const e = error as Error & {
      stdout?: string
      stderr?: string
    }

    const message = [e.message, e.stderr, e.stdout].filter(Boolean).join('\n').trim()
    throw new Error(message || `Failed to run command: ${command} ${args.join(' ')}`)
  }
}

async function ensureCommandExists(command: string, cwd?: string): Promise<void> {
  await run('which', [command], { cwd })
}

async function ensureGitRefExists(ref: string, cwd: string): Promise<void> {
  await run('git', ['rev-parse', '--verify', ref], { cwd })
}

async function getCurrentBranch(cwd: string): Promise<string> {
  const result = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  return result.stdout
}

async function gitRefExists(ref: string, cwd: string): Promise<boolean> {
  try {
    await ensureGitRefExists(ref, cwd)
    return true
  } catch {
    return false
  }
}

async function getBranchUpstream(branch: string, cwd: string): Promise<string | null> {
  const result = await run(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`],
    { cwd },
  )

  return result.stdout || null
}

async function getOriginHeadBranch(cwd: string): Promise<string | null> {
  const result = await run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd })
  const match = result.stdout.match(/^refs\/remotes\/origin\/(.+)$/)
  return match?.[1] ?? null
}

async function inferBaseBranch(branch: string, cwd: string): Promise<string> {
  const candidates = ['main', 'master', 'develop', 'dev']

  for (const candidate of candidates) {
    if (candidate !== branch && (await gitRefExists(candidate, cwd))) {
      return candidate
    }
  }

  try {
    const upstream = await getBranchUpstream(branch, cwd)
    if (upstream) {
      const normalized = upstream.replace(/^origin\//, '')
      if (normalized !== branch && (await gitRefExists(normalized, cwd))) {
        return normalized
      }
    }
  } catch {
    // Ignore upstream lookup failure.
  }

  try {
    const originHead = await getOriginHeadBranch(cwd)
    if (originHead && originHead !== branch && (await gitRefExists(originHead, cwd))) {
      return originHead
    }
  } catch {
    // Ignore origin HEAD lookup failure.
  }

  throw new Error(
    `Could not infer a base branch for "${branch}". Please provide baseBranch explicitly.`,
  )
}

async function getDiff(
  baseBranch: string,
  branch: string,
  cwd: string,
): Promise<string> {
  const result = await run(
    'git',
    [
      'diff',
      '--no-ext-diff',
      '--unified=3',
      `${baseBranch}...${branch}`,
    ],
    { cwd },
  )

  return result.stdout
}

async function withTempDiffFile<T>(
  _cwd: string,
  diff: string,
  callback: (diffFilePath: string) => Promise<T>,
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'codex-diff-review-'))
  const diffFilePath = join(tempDir, 'review.diff')

  try {
    await writeFile(diffFilePath, diff, 'utf8')
    return await callback(diffFilePath)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function runCodexExec(
  prompt: string,
  cwd: string,
  runtime?: ReviewToolRuntime,
): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      'codex',
      ['exec', '--sandbox', 'read-only', prompt],
      {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    let stdoutRemainder = ''
    let stderrRemainder = ''
    const writeStdout = createLineWriter('stdout', runtime?.writer)
    const writeStderr = createLineWriter('stderr', runtime?.writer)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutChunks.push(chunk)
      stdoutRemainder += chunk
      writeStdout(chunk)
      const parts = stdoutRemainder.split('\n')
      stdoutRemainder = parts.pop() ?? ''
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrChunks.push(chunk)
      stderrRemainder += chunk
      writeStderr(chunk)
      const parts = stderrRemainder.split('\n')
      stderrRemainder = parts.pop() ?? ''
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code, signal) => {
      flushLineWriter('stdout', runtime?.writer, stdoutRemainder)
      flushLineWriter('stderr', runtime?.writer, stderrRemainder)

      if (code !== 0) {
        const stderr = stderrChunks.join('').trim()
        const stdout = stdoutChunks.join('').trim()
        const parts = [
          `codex exec failed with exit code ${code}${signal ? ` (signal: ${signal})` : ''}.`,
          stderr,
          stdout,
        ].filter(Boolean)
        reject(new Error(parts.join('\n')))
        return
      }

      resolve({
        stdout: stdoutChunks.join('').trim(),
        stderr: stderrChunks.join('').trim(),
      })
    })
  })
}

async function runCodexDiffReview(params: {
  branch: string
  baseBranch: string
  path: string
  prompt: string
  runtime?: ReviewToolRuntime
}): Promise<string> {
  writeProgress(params.runtime, 'Generating git diff...', {
    branch: params.branch,
    baseBranch: params.baseBranch,
  })

  const diff = await getDiff(params.baseBranch, params.branch, params.path)

  if (!diff.trim()) {
    writeProgress(params.runtime, 'No diff found to review.')
    return `No diff found between "${params.baseBranch}" and "${params.branch}".`
  }

  writeProgress(params.runtime, 'Diff generated. Preparing Codex review...', {
    bytes: diff.length,
  })

  const reviewPrompt = [
    `Review only the git diff between "${params.baseBranch}" and "${params.branch}".`,
    'Treat it like a pull request review.',
    'Return only prioritized findings.',
    params.prompt,
  ].join(' ')

  return await withTempDiffFile(params.path, diff, async (diffFilePath) => {
    writeProgress(params.runtime, 'Running Codex CLI review...', {
      diffFilePath,
    })

    const result = await runCodexExec(
      `${reviewPrompt} The diff to review is stored in this file: ${diffFilePath}`,
      params.path,
      params.runtime,
    )

    writeProgress(params.runtime, 'Codex review completed.')
    return [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  })
}

export default tool(
  async (rawInput, runtime: ReviewToolRuntime) => {
    const input: ReviewBranchChangesInput = schema.parse(rawInput)

    writeProgress(runtime, 'Validating environment...', { path: input.path })
    await ensureCommandExists('git', input.path)
    await ensureCommandExists('codex', input.path)
    await ensureGitRefExists(input.branch, input.path)

    const currentBranch = await getCurrentBranch(input.path)
    writeProgress(runtime, 'Resolving base branch...', {
      branch: input.branch,
      currentBranch,
    })

    const baseBranch = input.baseBranch || (await inferBaseBranch(input.branch, input.path))

    await ensureGitRefExists(baseBranch, input.path)
    writeProgress(runtime, 'Starting review...', {
      branch: input.branch,
      baseBranch,
    })

    const review = await runCodexDiffReview({
      branch: input.branch,
      baseBranch,
      path: input.path,
      prompt: input.prompt,
      runtime,
    })

    return review
  },
  {
    name: 'Codex Code Review',
    description:
      'Review code with Codex CLI using a repository path, target branch, optional base branch, and review instruction. When baseBranch is omitted, the tool infers a sensible base branch and reviews the diff against it.',
    schema,
  },
)
