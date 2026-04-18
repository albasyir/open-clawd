import {
  existsSync, mkdirSync,
  readdirSync, readFileSync,
  unlinkSync, rmSync, writeFileSync,
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
  const globalToolsDir = join(baseDir, 'toolbox')


  return {
    // ── Global tools ──

    listGlobal(): ToolInfo[] {
      try {
        const entries = readdirSync(globalToolsDir, { withFileTypes: true })
        return entries
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name)
          .sort()
          .map((name) => {
            let content: string | undefined
            try { content = readFileSync(join(globalToolsDir, name, 'tool.ts'), 'utf-8') } catch {}
            return { id: name, name, content }
          })
      } catch {
        return []
      }
    },

    createGlobal(name: string): { id: string; name: string } {
      const dirPath = join(globalToolsDir, name)
      if (existsSync(dirPath)) {
        throw new AgentError('ALREADY_EXISTS', `Tool "${name}" already exists`)
      }
      mkdirSync(dirPath, { recursive: true })
      writeFileSync(join(dirPath, 'tool.ts'), NEW_TOOL_TEMPLATE.replace(/__NAME__/g, name), 'utf-8')
      const camelName = name.replace(/-([a-z])/g, (g) => g[1].toUpperCase())
      const indexContent = `import ${camelName} from "./tool";\n\nexport default {\n    tool: ${camelName},\n}\n`
      writeFileSync(join(dirPath, 'index.ts'), indexContent, 'utf-8')
      return { id: name, name }
    },

    updateGlobal(id: string, content: string): void {
      const filePath = join(globalToolsDir, id, 'tool.ts')
      writeFileSync(filePath, content, 'utf-8')
    },

    deleteGlobal(id: string): void {
      const dirPath = join(globalToolsDir, id)
      if (!existsSync(dirPath)) {
        throw new AgentError('NOT_FOUND', `Global tool "${id}" not found`)
      }
      rmSync(dirPath, { recursive: true, force: true })
    },

    async testGlobal(id: string, input: Record<string, unknown>): Promise<TestResult> {
      const absolutePath = join(globalToolsDir, id, 'tool.ts')
      const label = `agent/toolbox/${id}/tool.ts`
      return runToolTest({ absolutePath, label, input, allowCallable: false })
    },

    async streamTestGlobal(
      id: string,
      input: Record<string, unknown>,
      writer: TestStreamWriter,
    ): Promise<void> {
      const absolutePath = join(globalToolsDir, id, 'tool.ts')
      const label = `agent/toolbox/${id}/tool.ts`
      const result = await runToolTest({ absolutePath, label, input, allowCallable: false, writer })
      writer({ type: 'result', ...result })
    },

    // ── Agent ↔ Global tool linking ──

    listLinkedTools(agentId: string): string[] {
      const toolFilePath = join(baseDir, 'agents', agentId, 'tool.ts')
      if (!existsSync(toolFilePath)) return []

      const content = readFileSync(toolFilePath, 'utf-8')
      const importPattern = /\(await import\(['"]\.\.\/\.\.\/toolbox\/([^'"]+)['"]\)\)\.default/g
      const linked: string[] = []
      let match: RegExpExecArray | null
      while ((match = importPattern.exec(content)) !== null) {
        linked.push(match[1])
      }
      return linked
    },

    linkTool(agentId: string, toolName: string): void {
      const globalPath = join(globalToolsDir, toolName)
      if (!existsSync(globalPath)) {
        throw new AgentError('NOT_FOUND', `Global tool "${toolName}" not found`)
      }

      const toolFilePath = join(baseDir, 'agents', agentId, 'tool.ts')
      if (!existsSync(toolFilePath)) {
        throw new AgentError('NOT_FOUND', `Agent "${agentId}" tool.ts not found`)
      }

      let content = readFileSync(toolFilePath, 'utf-8')
      if (content.includes(`'../../toolbox/${toolName}'`)) return

      const newEntry = `    (await import('../../toolbox/${toolName}')).default`
      const closingBracketIndex = content.lastIndexOf(']')
      if (closingBracketIndex === -1) return

      const before = content.slice(0, closingBracketIndex).trimEnd()
      const after = content.slice(closingBracketIndex)
      const hasEntries = before.includes('(await import(')
      const separator = hasEntries ? ',\n' : '\n'

      content = before + separator + newEntry + '\n' + after
      writeFileSync(toolFilePath, content, 'utf-8')
    },

    unlinkTool(agentId: string, toolName: string): void {
      const toolFilePath = join(baseDir, 'agents', agentId, 'tool.ts')
      if (!existsSync(toolFilePath)) {
        throw new AgentError('NOT_FOUND', `Agent "${agentId}" tool.ts not found`)
      }

      let content = readFileSync(toolFilePath, 'utf-8')
      const lines = content.split('\n')
      const filtered = lines.filter((line) => !line.includes(`'../../toolbox/${toolName}'`))
      writeFileSync(toolFilePath, filtered.join('\n'), 'utf-8')
    },

  }
}

export type ToolManager = ReturnType<typeof createToolManager>
