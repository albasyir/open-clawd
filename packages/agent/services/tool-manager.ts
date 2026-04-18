import {
  existsSync, mkdirSync,
  readdirSync, readFileSync,
  unlinkSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IndentationText, Project, QuoteKind, SyntaxKind } from 'ts-morph'
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

      const project = new Project({
        manipulationSettings: {
          indentationText: IndentationText.TwoSpaces,
          quoteKind: QuoteKind.Single
        }
      })
      const sourceFile = project.addSourceFileAtPath(toolFilePath)
      
      return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter(call => call.getExpression().getKind() === SyntaxKind.ImportKeyword)
        .map(call => {
          const arg = call.getArguments()[0]
          return arg && arg.getKind() === SyntaxKind.StringLiteral ? arg.getLiteralText() : null
        })
        .filter(text => text !== null && text.startsWith('../../toolbox/'))
        .map(text => text!.replace('../../toolbox/', ''))
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

      const project = new Project({
        manipulationSettings: {
          indentationText: IndentationText.TwoSpaces,
          quoteKind: QuoteKind.Single
        }
      })
      const sourceFile = project.addSourceFileAtPath(toolFilePath)
      
      const exportAssign = sourceFile.getExportAssignment(d => !d.isExportEquals())
      if (!exportAssign) return

      const arrayLiteral = exportAssign.getExpressionIfKind(SyntaxKind.ArrayLiteralExpression)
      if (!arrayLiteral) return

      const importPath = `../../toolbox/${toolName}`
      const existing = arrayLiteral.getElements().some(element => element.getText().includes(importPath))
      if (existing) return

      arrayLiteral.addElement(`(await import('${importPath}')).default`)
      sourceFile.formatText()
      sourceFile.saveSync()
    },

    unlinkTool(agentId: string, toolName: string): void {
      const toolFilePath = join(baseDir, 'agents', agentId, 'tool.ts')
      if (!existsSync(toolFilePath)) {
        throw new AgentError('NOT_FOUND', `Agent "${agentId}" tool.ts not found`)
      }

      const project = new Project({
        manipulationSettings: {
          indentationText: IndentationText.TwoSpaces,
          quoteKind: QuoteKind.Single
        }
      })
      const sourceFile = project.addSourceFileAtPath(toolFilePath)
      
      const exportAssign = sourceFile.getExportAssignment(d => !d.isExportEquals())
      if (!exportAssign) return

      const arrayLiteral = exportAssign.getExpressionIfKind(SyntaxKind.ArrayLiteralExpression)
      if (!arrayLiteral) return

      const importPath = `../../toolbox/${toolName}`
      
      const elementsToRemove = arrayLiteral.getElements().filter(element => element.getText().includes(importPath))
      // Remove elements in reverse order to preserve indices of earlier elements
      for (let i = elementsToRemove.length - 1; i >= 0; i--) {
        arrayLiteral.removeElement(elementsToRemove[i])
      }
      
      sourceFile.formatText()
      sourceFile.saveSync()
    },

  }
}

export type ToolManager = ReturnType<typeof createToolManager>
