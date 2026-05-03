import { spawn } from 'node:child_process'
import { ToolMessage } from '@langchain/core/messages'
import { tool, type ToolRuntime } from '@langchain/core/tools'
import { interrupt, isGraphInterrupt } from '@langchain/langgraph'
import type { DecisionType, HITLRequest } from 'langchain'
import { z } from 'zod'
import { isRecord, type UnknownRecord } from '../../utils/record.ts'

const PROCESS_TIMEOUT_MS = 30_000
const SHELL_TOOL_NAME = 'shell_exec'
const SHELL_APPROVAL_DECISIONS = ['approve', 'edit', 'reject'] as const satisfies DecisionType[]
const TOOLBOX_TEST_CONFIG_KEY = '__toolboxTest'

const shellToolSchema = z.object({
  command: z.string().describe('The shell command to run (e.g. "ls -la", "echo hello")'),
  cwd: z.string().optional().describe('Working directory for the command (default: current)')
})

const shellApprovalDecisionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approve') }),
  z.object({
    type: z.literal('edit'),
    editedAction: z.object({
      name: z.string(),
      args: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    type: z.literal('reject'),
    message: z.string().optional(),
  }),
])

const shellApprovalResponseSchema = z.object({
  decisions: z.tuple([shellApprovalDecisionSchema]),
})

type ShellToolRuntime = Partial<ToolRuntime>
type ShellToolInput = z.infer<typeof shellToolSchema>
type ShellApprovalDecision = z.infer<typeof shellApprovalDecisionSchema>
type ShellApprovalResult =
  | { type: 'execute', input: ShellToolInput }
  | { type: 'reject', message: string | ToolMessage }
type ShellInterruptCallback = (input: ShellToolInput) => boolean | Promise<boolean>
type StreamName = 'stdout' | 'stderr'

class ToolboxToolInterruptedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolboxToolInterruptedError'
  }
}

function createLineWriter(
  streamName: StreamName,
  writer?: ((chunk: unknown) => void) | null,
): { write(chunk: string): void; flush(): void } {
  let buffer = ''

  const emit = (line: string) => {
    const text = line.trimEnd()
    if (text.trim()) writer?.(`[${streamName}] ${text}`)
  }

  return {
    write(chunk: string) {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) emit(line)
    },
    flush() {
      emit(buffer)
      buffer = ''
    },
  }
}

function createOutputCollector(
  streamName: StreamName,
  writer?: ((chunk: unknown) => void) | null,
): { write(chunk: string): void; flush(): void; text(): string } {
  const chunks: string[] = []
  const lineWriter = createLineWriter(streamName, writer)

  return {
    write(chunk: string) {
      chunks.push(chunk)
      lineWriter.write(chunk)
    },
    flush() {
      lineWriter.flush()
    },
    text() {
      return chunks.join('').trim()
    },
  }
}

function readSingleApprovalDecision(response: unknown): ShellApprovalDecision {
  const parsed = shellApprovalResponseSchema.safeParse(response)
  if (!parsed.success) {
    throw new Error('Invalid HITLResponse: decisions must contain exactly one shell approval decision')
  }

  return parsed.data.decisions[0]
}

function describeShellCommand(input: ShellToolInput): string {
  const workingDirectory = input.cwd ? `\nWorking directory: ${input.cwd}` : ''
  return `Command: ${input.command}${workingDirectory}`
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

function getRuntimeConfigurable(runtime?: ShellToolRuntime): UnknownRecord | undefined {
  if (isRecord(runtime?.configurable)) return runtime.configurable
  if (isRecord(runtime?.config?.configurable)) return runtime.config.configurable

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
  const mod = await import("./interrupt.ts")
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
    const request: HITLRequest = {
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
    }
    response = interrupt<HITLRequest, unknown>(request)
  } catch (error) {
    if (isGraphInterrupt(error)) throw error
    if (isMissingInterruptRuntimeError(error)) throwToolboxInterrupted(input)
    throw error
  }

  const decision = readSingleApprovalDecision(response)

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

  const { editedAction } = decision
  if (editedAction.name !== SHELL_TOOL_NAME) {
    throw new Error(`Invalid edited action for tool "${SHELL_TOOL_NAME}": name must be "${SHELL_TOOL_NAME}"`)
  }

  return { type: 'execute', input: shellToolSchema.parse(editedAction.args) }
}

async function runShellCommand(
  input: ShellToolInput,
  runtime?: ShellToolRuntime,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, {
      shell: true,
      cwd: input.cwd || undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    runtime?.writer?.(`[command] ${input.command}`)
    if (input.cwd) {
      runtime?.writer?.(`[cwd] ${input.cwd}`)
    }

    const stdout = createOutputCollector('stdout', runtime?.writer)
    const stderr = createOutputCollector('stderr', runtime?.writer)
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
      stdout.write(chunk)
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr.write(chunk)
    })

    child.on('error', (error) => {
      finish({ error })
    })

    child.on('close', (code, signal) => {
      stdout.flush()
      stderr.flush()

      const stdoutText = stdout.text()
      const stderrText = stderr.text()
      const exitCode = typeof code === 'number' ? code : -1

      if (timedOut) {
        const timedOutOutput = [stdoutText, stderrText, `Process timed out after ${PROCESS_TIMEOUT_MS}ms.`]
          .filter(Boolean)
          .join('\n')
        finish({ output: `Exit code: ${exitCode}\n${timedOutOutput}` })
        return
      }

      const out = [stdoutText, stderrText].filter(Boolean).join('\n') || '(no output)'
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
