import { spawn } from 'node:child_process'
import { tool } from 'langchain'
import { ToolMessage } from '@langchain/core/messages'
import type { ToolRuntime } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { z } from 'zod'

const PROCESS_TIMEOUT_MS = 30_000
const SHELL_TOOL_NAME = 'shell_exec'
const SHELL_APPROVAL_DECISIONS = ['approve', 'edit', 'reject'] as const
const SHELL_INTERRUPT_PATTERN = 'facebook.com'

type ShellToolRuntime = Partial<ToolRuntime> & { writer?: ((chunk: unknown) => void) | null }
type ShellToolInput = {
  command: string
  cwd?: string
}
type ShellApprovalDecision =
  | { type: 'approve' }
  | { type: 'edit', editedAction: { name: string, args: Record<string, unknown> } }
  | { type: 'reject', message?: string }
type ShellApprovalResponse = {
  decisions: ShellApprovalDecision[]
}
type ShellApprovalResult =
  | { type: 'execute', input: ShellToolInput }
  | { type: 'reject', message: string | ToolMessage }

const shellToolSchema = z.object({
  command: z.string().describe('The shell command to run (e.g. "ls -la", "echo hello")'),
  cwd: z.string().optional().describe('Working directory for the command (default: current)')
})

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

function describeShellCommand(input: ShellToolInput): string {
  const workingDirectory = input.cwd ? `\nWorking directory: ${input.cwd}` : ''
  return `Command: ${input.command}${workingDirectory}`
}

function validateShellApprovalResponse(response: unknown): ShellApprovalDecision {
  const decisions = (response as Partial<ShellApprovalResponse> | null | undefined)?.decisions
  if (!Array.isArray(decisions) || decisions.length === 0) {
    throw new Error('Invalid HITLResponse: decisions must be a non-empty array')
  }
  if (decisions.length !== 1) {
    throw new Error(`Number of human decisions (${decisions.length}) does not match number of hanging tool calls (1).`)
  }

  const decision = decisions[0]
  if (!decision || typeof decision !== 'object') {
    throw new Error('Invalid human decision for shell_exec.')
  }
  if (!SHELL_APPROVAL_DECISIONS.includes(decision.type)) {
    throw new Error(
      `Unexpected human decision: ${JSON.stringify(decision)}. Decision type '${decision.type}' is not allowed for tool '${SHELL_TOOL_NAME}'. Expected one of ${JSON.stringify(SHELL_APPROVAL_DECISIONS)} based on the tool's configuration.`,
    )
  }

  return decision
}

function rejectShellCommand(message: string, runtime?: ShellToolRuntime): string | ToolMessage {
  const toolCallId = runtime?.toolCallId ?? runtime?.toolCall?.id
  if (!toolCallId) return message

  return new ToolMessage({
    content: message,
    name: SHELL_TOOL_NAME,
    tool_call_id: toolCallId,
    status: 'error',
  })
}

function resolveShellApproval(input: ShellToolInput, runtime?: ShellToolRuntime): ShellApprovalResult {
  if (!input.command.includes(SHELL_INTERRUPT_PATTERN)) {
    return { type: 'execute', input }
  }

  const response = interrupt({
    actionRequests: [
      {
        name: SHELL_TOOL_NAME,
        args: input,
        description: describeShellCommand(input),
      },
    ],
    reviewConfigs: [
      {
        actionName: SHELL_TOOL_NAME,
        allowedDecisions: [...SHELL_APPROVAL_DECISIONS],
      },
    ],
  })

  const decision = validateShellApprovalResponse(response)

  if (decision.type === 'approve') return { type: 'execute', input }

  if (decision.type === 'reject') {
    return {
      type: 'reject',
      message: rejectShellCommand(
        decision.message ?? `User rejected the tool call for \`${SHELL_TOOL_NAME}\``,
        runtime,
      ),
    }
  }

  const editedAction = decision.editedAction
  if (!editedAction || typeof editedAction.name !== 'string') {
    throw new Error(`Invalid edited action for tool "${SHELL_TOOL_NAME}": name must be a string`)
  }
  if (editedAction.name !== SHELL_TOOL_NAME) {
    throw new Error(`Invalid edited action for tool "${SHELL_TOOL_NAME}": name must be "${SHELL_TOOL_NAME}"`)
  }
  if (!editedAction.args || typeof editedAction.args !== 'object') {
    throw new Error(`Invalid edited action for tool "${SHELL_TOOL_NAME}": args must be an object`)
  }

  return { type: 'execute', input: shellToolSchema.parse(editedAction.args) }
}

async function runShellCommand(
  input: ShellToolInput,
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
  const approval = resolveShellApproval(input, runtime)
  if (approval.type === 'reject') return approval.message
  return await runShellCommand(approval.input, runtime)
}, {
  name: SHELL_TOOL_NAME,
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
  schema: shellToolSchema
})
