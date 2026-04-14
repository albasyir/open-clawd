import {
  copyFileSync, existsSync, lstatSync, mkdirSync,
  readdirSync, readFileSync, readlinkSync, symlinkSync,
  unlinkSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AgentError } from '../types'
import type { ToolInfo, TestResult } from '../types'
import { resolveBaseDir } from './resolve-base'

const NEW_TOOL_TEMPLATE = `import { tool } from 'langchain'
import { z } from 'zod'

export default tool((input) => \`\${input.firstName} \${input.lastName}\`, {
  name: '__NAME__',
  description: 'Change it, this only example',
  schema: z.object({
    firstName: z.string().describe('First name to be concated'),
    lastName:  z.string().describe('Last name to be concated')
  }),
})
`

function addToToolFile(baseDir: string, agentId: string, toolName: string): void {
  const toolFilePath = join(baseDir, 'agents', agentId, 'tool.ts')
  if (!existsSync(toolFilePath)) return

  const newEntry = `    (await import('./tools/${toolName}')).default`
  let content = readFileSync(toolFilePath, 'utf-8')

  if (content.includes(`'./tools/${toolName}'`)) return

  const closingBracketIndex = content.lastIndexOf(']')
  if (closingBracketIndex === -1) return

  const before = content.slice(0, closingBracketIndex).trimEnd()
  const after = content.slice(closingBracketIndex)
  const hasEntries = before.includes('(await import(')
  const separator = hasEntries ? ',\n' : '\n'

  content = before + separator + newEntry + '\n' + after
  writeFileSync(toolFilePath, content, 'utf-8')
}

function removeFromToolFile(baseDir: string, agentId: string, toolName: string): void {
  const toolFilePath = join(baseDir, 'agents', agentId, 'tool.ts')
  if (!existsSync(toolFilePath)) return

  let content = readFileSync(toolFilePath, 'utf-8')
  const lines = content.split('\n')
  const filtered = lines.filter((line) => !line.includes(`'./tools/${toolName}'`))
  writeFileSync(toolFilePath, filtered.join('\n'), 'utf-8')
}

function renameInToolFile(baseDir: string, agentId: string, oldName: string, newName: string): void {
  const toolFilePath = join(baseDir, 'agents', agentId, 'tool.ts')
  if (!existsSync(toolFilePath)) return

  let content = readFileSync(toolFilePath, 'utf-8')
  content = content.replace(`'./tools/${oldName}'`, `'./tools/${newName}'`)
  writeFileSync(toolFilePath, content, 'utf-8')
}

function formatError(label: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  return stack ? `${message}\n\nAt:\n${stack}` : `In ${label}: ${message}`
}

type TestStreamChunk =
  | { type: 'start'; label: string }
  | { type: 'progress'; data: unknown }
  | { type: 'result'; success: boolean; result?: unknown; error?: string }

type TestStreamWriter = (chunk: TestStreamChunk) => void

type InvokableTool = {
  invoke: (
    input: Record<string, unknown>,
    config?: { writer?: (chunk: unknown) => void },
  ) => Promise<unknown>
}

function isInvokableTool(tool: unknown): tool is InvokableTool {
  return typeof tool === 'object' && tool !== null && 'invoke' in tool && typeof tool.invoke === 'function'
}

async function runToolTest(
  params: {
    absolutePath: string
    label: string
    input: Record<string, unknown>
    allowCallable: boolean
    writer?: TestStreamWriter
  },
): Promise<TestResult> {
  const { absolutePath, label, input, allowCallable, writer } = params
  const toolUrl = pathToFileURL(absolutePath).href + `?t=${Date.now()}`

  writer?.({ type: 'start', label })

  try {
    const mod = await import(toolUrl)
    const tool = mod.default

    if (tool == null) {
      return { success: false, error: `In ${label}: No default export.` }
    }

    const emitProgress = (data: unknown) => {
      writer?.({ type: 'progress', data })
    }

    if (isInvokableTool(tool)) {
      const result = await tool.invoke(input, { writer: emitProgress })
      return { success: true, result }
    }

    if (allowCallable && typeof tool === 'function') {
      const result = await tool(input, { writer: emitProgress })
      return { success: true, result }
    }

    return {
      success: false,
      error: allowCallable
        ? `In ${label}: Tool does not expose invoke() or is not callable.`
        : `In ${label}: Tool does not expose invoke().`,
    }
  } catch (err) {
    return { success: false, error: formatError(label, err) }
  }
}

export function createToolManager() {
  const baseDir = resolveBaseDir()
  const globalToolsDir = join(baseDir, 'tools')
  const agentsDir = join(baseDir, 'agents')

  return {
    // ── Global tools ──

    listGlobal(): ToolInfo[] {
      try {
        return readdirSync(globalToolsDir)
          .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
          .sort()
          .map((file) => {
            const name = file.replace(/\.ts$/, '')
            let content: string | undefined
            try { content = readFileSync(join(globalToolsDir, file), 'utf-8') } catch {}
            return { id: name, name, content }
          })
      } catch {
        return []
      }
    },

    createGlobal(name: string): { id: string; name: string } {
      const filePath = join(globalToolsDir, `${name}.ts`)
      if (existsSync(filePath)) {
        throw new AgentError('ALREADY_EXISTS', `Tool "${name}" already exists`)
      }
      mkdirSync(globalToolsDir, { recursive: true })
      writeFileSync(filePath, NEW_TOOL_TEMPLATE.replace(/__NAME__/g, name), 'utf-8')
      return { id: name, name }
    },

    updateGlobal(id: string, content: string): void {
      const filePath = join(globalToolsDir, `${id}.ts`)
      writeFileSync(filePath, content, 'utf-8')
    },

    deleteGlobal(id: string): void {
      const filePath = join(globalToolsDir, `${id}.ts`)
      if (!existsSync(filePath)) {
        throw new AgentError('NOT_FOUND', `Global tool "${id}" not found`)
      }
      unlinkSync(filePath)
    },

    async testGlobal(id: string, input: Record<string, unknown>): Promise<TestResult> {
      const absolutePath = join(globalToolsDir, `${id}.ts`)
      const label = `agent/tools/${id}.ts`
      return runToolTest({ absolutePath, label, input, allowCallable: false })
    },

    async streamTestGlobal(
      id: string,
      input: Record<string, unknown>,
      writer: TestStreamWriter,
    ): Promise<void> {
      const absolutePath = join(globalToolsDir, `${id}.ts`)
      const label = `agent/tools/${id}.ts`
      const result = await runToolTest({ absolutePath, label, input, allowCallable: false, writer })
      writer({ type: 'result', ...result })
    },

    getGlobalDeps(id: string): { agentId: string; toolName: string }[] {
      const globalToolPath = join(globalToolsDir, `${id}.ts`)
      if (!existsSync(globalToolPath)) {
        throw new AgentError('NOT_FOUND', `Global tool "${id}" not found`)
      }

      const deps: { agentId: string; toolName: string }[] = []
      if (!existsSync(agentsDir)) return deps

      const agents = readdirSync(agentsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)

      for (const agentId of agents) {
        const toolsDir = join(agentsDir, agentId, 'tools')
        if (!existsSync(toolsDir)) continue
        for (const file of readdirSync(toolsDir, { withFileTypes: true })) {
          if (!file.name.endsWith('.ts')) continue
          const filePath = join(toolsDir, file.name)
          if (lstatSync(filePath).isSymbolicLink()) {
            const target = readlinkSync(filePath)
            if (target.endsWith(`/${id}.ts`) || target.endsWith(`\\${id}.ts`)) {
              deps.push({ agentId, toolName: file.name.replace(/\.ts$/, '') })
            }
          }
        }
      }
      return deps
    },

    // ── Agent tools ──

    listForAgent(agentId: string): ToolInfo[] {
      const toolsDir = join(agentsDir, agentId, 'tools')
      try {
        return readdirSync(toolsDir)
          .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
          .sort()
          .map((file) => {
            const filePath = join(toolsDir, file)
            let isSymlink = false
            try { isSymlink = lstatSync(filePath).isSymbolicLink() } catch {}
            const name = file.replace(/\.ts$/, '')
            let content: string | undefined
            try { content = readFileSync(filePath, 'utf-8') } catch {}
            return { id: name, name, content, symlink: isSymlink || undefined }
          })
      } catch {
        return []
      }
    },

    createForAgent(agentId: string, name: string, opts?: { linkGlobal?: boolean }): { id: string; name: string; symlink: boolean } {
      const toolsDir = join(agentsDir, agentId, 'tools')
      const linkPath = join(toolsDir, `${name}.ts`)

      if (existsSync(linkPath)) {
        throw new AgentError('ALREADY_EXISTS', `Tool "${name}" already exists`)
      }

      mkdirSync(toolsDir, { recursive: true })

      if (opts?.linkGlobal) {
        const globalPath = join(globalToolsDir, `${name}.ts`)
        if (!existsSync(globalPath)) {
          throw new AgentError('NOT_FOUND', `Global tool "${name}" not found`)
        }
        const relativeTarget = join('..', '..', '..', 'tools', `${name}.ts`)
        symlinkSync(relativeTarget, linkPath)
      } else {
        writeFileSync(linkPath, NEW_TOOL_TEMPLATE.replace(/__NAME__/g, name), 'utf-8')
      }

      addToToolFile(baseDir, agentId, name)
      return { id: name, name, symlink: !!opts?.linkGlobal }
    },

    updateForAgent(agentId: string, toolId: string, content: string): void {
      const filePath = join(agentsDir, agentId, 'tools', `${toolId}.ts`)
      const stat = lstatSync(filePath, { throwIfNoEntry: false })
      if (stat?.isSymbolicLink()) {
        throw new AgentError('INVALID_INPUT', 'Cannot edit a symlinked tool')
      }
      writeFileSync(filePath, content, 'utf-8')
    },

    deleteForAgent(agentId: string, toolId: string): void {
      const filePath = join(agentsDir, agentId, 'tools', `${toolId}.ts`)
      if (!existsSync(filePath)) {
        throw new AgentError('NOT_FOUND', `Tool "${toolId}" not found`)
      }
      unlinkSync(filePath)
      removeFromToolFile(baseDir, agentId, toolId)
    },

    copyForAgent(agentId: string, toolId: string): { id: string; name: string; symlink: boolean; content: string } {
      const toolPath = join(agentsDir, agentId, 'tools', `${toolId}.ts`)
      if (!existsSync(toolPath)) {
        throw new AgentError('NOT_FOUND', `Tool "${toolId}" not found`)
      }
      if (!lstatSync(toolPath).isSymbolicLink()) {
        throw new AgentError('INVALID_INPUT', `Tool "${toolId}" is already a local file`)
      }
      const content = readFileSync(toolPath, 'utf-8')
      unlinkSync(toolPath)
      writeFileSync(toolPath, content, 'utf-8')
      return { id: toolId, name: toolId, symlink: false, content }
    },

    promoteForAgent(agentId: string, toolId: string, globalName?: string): { id: string; name: string; symlink: boolean } {
      const finalName = globalName || toolId
      const toolsDir = join(agentsDir, agentId, 'tools')
      const agentToolPath = join(toolsDir, `${toolId}.ts`)

      if (!existsSync(agentToolPath)) {
        throw new AgentError('NOT_FOUND', `Tool "${toolId}" not found`)
      }
      if (lstatSync(agentToolPath).isSymbolicLink()) {
        throw new AgentError('INVALID_INPUT', `Tool "${toolId}" is already a global link`)
      }

      const globalToolPath = join(globalToolsDir, `${finalName}.ts`)
      if (existsSync(globalToolPath)) {
        throw new AgentError('ALREADY_EXISTS', `A global tool named "${finalName}" already exists`)
      }

      mkdirSync(globalToolsDir, { recursive: true })
      copyFileSync(agentToolPath, globalToolPath)
      unlinkSync(agentToolPath)

      const newSymlinkPath = join(toolsDir, `${finalName}.ts`)
      const relativeTarget = join('..', '..', '..', 'tools', `${finalName}.ts`)
      symlinkSync(relativeTarget, newSymlinkPath)

      if (finalName !== toolId) {
        renameInToolFile(baseDir, agentId, toolId, finalName)
      }

      return { id: finalName, name: finalName, symlink: true }
    },

    async testForAgent(agentId: string, toolId: string, input: Record<string, unknown>): Promise<TestResult> {
      const absolutePath = join(agentsDir, agentId, 'tools', `${toolId}.ts`)
      const label = `agent/agents/${agentId}/tools/${toolId}.ts`

      const stat = lstatSync(absolutePath, { throwIfNoEntry: false })
      if (stat?.isSymbolicLink()) {
        throw new AgentError('INVALID_INPUT', 'Cannot run test for a symlinked tool')
      }

      return runToolTest({ absolutePath, label, input, allowCallable: true })
    },

    async streamTestForAgent(
      agentId: string,
      toolId: string,
      input: Record<string, unknown>,
      writer: TestStreamWriter,
    ): Promise<void> {
      const absolutePath = join(agentsDir, agentId, 'tools', `${toolId}.ts`)
      const label = `agent/agents/${agentId}/tools/${toolId}.ts`

      const stat = lstatSync(absolutePath, { throwIfNoEntry: false })
      if (stat?.isSymbolicLink()) {
        writer({
          type: 'result',
          success: false,
          error: 'Cannot run test for a symlinked tool',
        })
        return
      }

      const result = await runToolTest({ absolutePath, label, input, allowCallable: true, writer })
      writer({ type: 'result', ...result })
    },
  }
}

export type ToolManager = ReturnType<typeof createToolManager>
