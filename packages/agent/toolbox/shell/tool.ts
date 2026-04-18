import { spawn } from 'node:child_process'
import { tool } from 'langchain'
import type { ToolRuntime } from '@langchain/core/tools'
import { z } from 'zod'

const PROCESS_TIMEOUT_MS = 30_000

type ShellToolRuntime = ToolRuntime | { writer?: ((chunk: unknown) => void) | null }

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
      writer?.(`[${streamName}] ${text}`)
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
    writer?.(`[${streamName}] ${text}`)
  }
}

async function runShellCommand(
  input: { command: string, cwd?: string },
  runtime?: ShellToolRuntime,
): Promise<string> {
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []

  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, {
      shell: true,
      cwd: input.cwd || undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    runtime?.writer?.(`[command] ${input.command}`)
    if (input.cwd) {
      runtime?.writer?.(`[cwd] ${input.cwd}`)
    }

    const writeStdout = createLineWriter('stdout', runtime?.writer)
    const writeStderr = createLineWriter('stderr', runtime?.writer)
    let stdoutRemainder = ''
    let stderrRemainder = ''
    let finished = false
    let timedOut = false

    const finish = (result: { error?: Error, output?: string }) => {
      if (finished) return
      finished = true
      clearTimeout(timeoutId)
      if (result.error) {
        reject(result.error)
      } else {
        resolve(result.output ?? '(no output)')
      }
    }

    const timeoutId = setTimeout(() => {
      timedOut = true
      runtime?.writer?.(`[timeout] Process exceeded ${PROCESS_TIMEOUT_MS}ms and will be terminated.`)
      child.kill('SIGTERM')
    }, PROCESS_TIMEOUT_MS)

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
      finish({ error })
    })

    child.on('close', (code, signal) => {
      flushLineWriter('stdout', runtime?.writer, stdoutRemainder)
      flushLineWriter('stderr', runtime?.writer, stderrRemainder)

      const stdout = stdoutChunks.join('').trim()
      const stderr = stderrChunks.join('').trim()
      const exitCode = typeof code === 'number' ? code : -1

      if (timedOut) {
        const timedOutOutput = [stdout, stderr, `Process timed out after ${PROCESS_TIMEOUT_MS}ms.`]
          .filter(Boolean)
          .join('\n')
        finish({ output: `Exit code: ${exitCode}\n${timedOutOutput}` })
        return
      }

      const out = [stdout, stderr].filter(Boolean).join('\n') || '(no output)'
      const signalSuffix = signal ? ` (signal: ${signal})` : ''
      finish({ output: `Exit code: ${exitCode}${signalSuffix}\n${out}` })
    })
  })
}

export const shellTool = tool(async (input, runtime: ShellToolRuntime) => {
  return await runShellCommand(input, runtime)
}, {
  name: 'shell_exec',
  description: `Access the machine terminal and execute shell commands.

This tool allows you to perform any task that can be done via a command-line interface (CLI), including but not limited to:

- Networking:
  ping, curl, wget, traceroute, nslookup, dig
  Examples:
    ping facebook.com
    curl -I https://example.com
    wget https://example.com/file

- Filesystem:
  ls, cd, pwd, mkdir, rm, cp, mv, cat, touch
  Examples:
    ls -la
    cat file.txt
    mkdir logs

- File editing / writing:
  echo, printf, redirection (>, >>), tee
  Examples:
    echo "hello" > file.txt
    printf "data" >> file.txt

- Search and processing:
  grep, find, awk, sed
  Examples:
    grep "error" app.log
    find . -name "*.ts"

- System / environment:
  whoami, env, export, ps, top
  Examples:
    ps aux
    env

- Development tools:
  node, npm, yarn, pnpm, git, docker
  Examples:
    node -v
    git status
    docker ps

- Compression / archive:
  zip, unzip, tar
  Examples:
    tar -xvf file.tar
    unzip file.zip

You may translate natural language into an appropriate shell command.
If the user asks for something that can be done in a terminal, use this tool.

This is the primary interface for interacting with the machine.`,
  schema: z.object({
    command: z.string().describe('The shell command to run (e.g. "ls -la", "echo hello")'),
    cwd: z.string().optional().describe('Working directory for the command (default: current)')
  })
})
