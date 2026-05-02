import { spawn } from 'node:child_process'
import { tool } from 'langchain'
import { ToolMessage } from '@langchain/core/messages'
import type { ToolRuntime } from '@langchain/core/tools'
import { interrupt, isGraphInterrupt } from '@langchain/langgraph'
import { z } from 'zod'

const PROCESS_TIMEOUT_MS = 30_000
const SHELL_TOOL_NAME = 'shell_exec'
const SHELL_APPROVAL_DECISIONS = ['approve', 'edit', 'reject'] as const
const TOOLBOX_TEST_CONFIG_KEY = '__toolboxTest'

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
type ShellInterruptCallback = (input: ShellToolInput) => boolean | Promise<boolean>

const shellToolSchema = z.object({
  command: z.string().describe('The shell command to run (e.g. "ls -la", "echo hello")'),
  cwd: z.string().optional().describe('Working directory for the command (default: current)')
})

class ToolboxToolInterruptedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolboxToolInterruptedError'
  }
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

function getRuntimeConfigurable(runtime?: ShellToolRuntime): Record<string, unknown> | undefined {
  const directConfigurable = (runtime as { configurable?: unknown } | undefined)?.configurable
  if (directConfigurable && typeof directConfigurable === 'object') {
    return directConfigurable as Record<string, unknown>
  }

  const nestedConfigurable = (runtime as { config?: { configurable?: unknown } } | undefined)?.config?.configurable
  if (nestedConfigurable && typeof nestedConfigurable === 'object') {
    return nestedConfigurable as Record<string, unknown>
  }

  return undefined
}

function isToolboxTestRuntime(runtime?: ShellToolRuntime): boolean {
  return getRuntimeConfigurable(runtime)?.[TOOLBOX_TEST_CONFIG_KEY] === true
}

function throwToolboxInterrupted(input: ShellToolInput): never {
  throw new ToolboxToolInterruptedError(
    [
      `Tool execution interrupted by shell interrupt policy.`,
      `\`${SHELL_TOOL_NAME}\` requires approval before running: ${input.command}`,
      'This runner cannot resume interrupted tool calls. Run it from an agent chat to approve, edit, or reject the command.',
    ].join(' '),
  )
}

function isMissingInterruptRuntimeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return [
    'Called interrupt() outside the context of a graph.',
    'No configurable found in config',
    'No checkpointer set',
  ].includes(error.message)
}

async function loadShellInterruptCallback(): Promise<ShellInterruptCallback> {
  const interruptUrl = new URL(`./interrupt.ts?t=${Date.now()}`, import.meta.url).href
  const mod = await import(interruptUrl) as { default?: unknown }
  if (typeof mod.default !== 'function') {
    throw new Error('Shell interrupt callback must be the default export function from interrupt.ts.')
  }

  return mod.default as ShellInterruptCallback
}

async function shouldRequestShellApproval(input: ShellToolInput): Promise<boolean> {
  const shouldInterrupt = await loadShellInterruptCallback()
  const result = await shouldInterrupt({ command: input.command, cwd: input.cwd })

  if (typeof result !== 'boolean') {
    throw new Error('Shell interrupt callback must return true or false.')
  }

  return result
}

async function resolveShellApproval(input: ShellToolInput, runtime?: ShellToolRuntime): Promise<ShellApprovalResult> {
  if (!(await shouldRequestShellApproval(input))) {
    return { type: 'execute', input }
  }

  if (isToolboxTestRuntime(runtime)) {
    throwToolboxInterrupted(input)
  }

  let response: unknown
  try {
    response = interrupt({
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
  } catch (error) {
    if (isGraphInterrupt(error)) throw error
    if (isMissingInterruptRuntimeError(error)) throwToolboxInterrupted(input)
    throw error
  }

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
  const approval = await resolveShellApproval(input, runtime)
  if (approval.type === 'reject') return approval.message
  return await runShellCommand(approval.input, runtime)
}, {
  name: SHELL_TOOL_NAME,
  description: `Access the machine terminal and execute shell commands.`,
  schema: shellToolSchema
})
