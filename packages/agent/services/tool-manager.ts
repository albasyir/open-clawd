import {
  existsSync, mkdirSync,
  readdirSync, readFileSync,
  rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IndentationText, Project, QuoteKind, SyntaxKind, type AsExpression, type CallExpression, type Node, type StringLiteral } from 'ts-morph'
import { AgentError } from '../types'
import type { ToolInfo, TestResult } from '../types'
import { resolveBaseDir } from './resolve-base'

const TOOLBOX_IMPORT_PREFIX = '../../toolbox/'
const EDITABLE_TOOL_FILES = ['tool.ts', 'interrupt.ts'] as const
type EditableToolFile = typeof EDITABLE_TOOL_FILES[number]

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

function getToolboxImportPath(toolName: string): string {
  return `${TOOLBOX_IMPORT_PREFIX}${toolName}/index.ts`
}

function getToolboxImportExpression(toolName: string): string {
  return `(await import('${getToolboxImportPath(toolName)}')).default`
}

function normalizeToolboxImportPath(importPath: string): string | null {
  if (!importPath.startsWith(TOOLBOX_IMPORT_PREFIX)) return null

  const linkedTool = importPath.slice(TOOLBOX_IMPORT_PREFIX.length)
  return linkedTool.endsWith('/index.ts')
    ? linkedTool.slice(0, -'/index.ts'.length)
    : linkedTool
}

function getStringLiteralText(node: Node | undefined): string | null {
  if (node?.getKind() === SyntaxKind.AsExpression) {
    return getStringLiteralText((node as AsExpression).getExpression())
  }

  if (!node || node.getKind() !== SyntaxKind.StringLiteral) return null
  return (node as StringLiteral).getLiteralText()
}

function getToolboxImportPathFromCall(call: CallExpression): string | null {
  const arg = call.getArguments()[0]
  const directImportPath = getStringLiteralText(arg)
  if (directImportPath) return directImportPath

  const urlExpression = arg?.getDescendantsOfKind(SyntaxKind.NewExpression)
    .find(expression => expression.getExpression().getText() === 'URL')
  return getStringLiteralText(urlExpression?.getArguments()[0])
}

function getLinkedToolNameFromElement(element: Node): string | null {
  const importCall = element.getDescendantsOfKind(SyntaxKind.CallExpression)
    .find(call => call.getExpression().getKind() === SyntaxKind.ImportKeyword)
  const importPath = importCall ? getToolboxImportPathFromCall(importCall) : null
  return importPath ? normalizeToolboxImportPath(importPath) : null
}

function readEditableToolFile(dirPath: string, fileName: EditableToolFile) {
  const filePath = join(dirPath, fileName)
  if (!existsSync(filePath)) return null

  return {
    id: fileName,
    name: fileName,
    content: readFileSync(filePath, 'utf-8'),
  }
}

function listEditableToolFiles(dirPath: string) {
  return EDITABLE_TOOL_FILES
    .map(fileName => readEditableToolFile(dirPath, fileName))
    .filter((file): file is { id: EditableToolFile; name: EditableToolFile; content: string } => file !== null)
}

function resolveToolExport(mod: Record<string, unknown>, label: string): { tool?: unknown; error?: string } {
  // 1. Check default export first
  const exported = mod.default
  if (exported != null) {
    if (isInvokableTool(exported) || typeof exported === 'function') {
      return { tool: exported }
    }

    if (typeof exported === 'object' && exported !== null && 'tool' in exported) {
      const toolboxTool = (exported as { tool?: unknown }).tool
      if (toolboxTool == null) {
        return { error: `In ${label}: Default toolbox export does not expose a tool.` }
      }
      return { tool: toolboxTool }
    }
  }

  // 2. Scan named exports for an invokable tool
  for (const [key, value] of Object.entries(mod)) {
    if (key === 'default') continue
    if (isInvokableTool(value)) {
      return { tool: value }
    }
  }

  if (exported != null) {
    return { tool: exported }
  }

  return { error: `In ${label}: No tool export found.` }
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
    const mod = await import(toolUrl) as Record<string, unknown>
    const resolved = resolveToolExport(mod, label)

    if (resolved.error) {
      return { success: false, error: resolved.error }
    }

    const tool = resolved.tool

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
            const files = listEditableToolFiles(join(globalToolsDir, name))
            const content = files.find(file => file.id === 'tool.ts')?.content
            return { id: name, name, content, files }
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
      const camelName = name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      const indexContent = `// @ts-expect-error Runtime TS loaders and Nuxt both need the explicit extension.\nimport ${camelName} from './tool.ts'\n\nexport default {\n    tool: ${camelName},\n}\n`
      writeFileSync(join(dirPath, 'index.ts'), indexContent, 'utf-8')
      return { id: name, name }
    },

    updateGlobal(id: string, content: string, fileName: EditableToolFile = 'tool.ts'): void {
      if (!EDITABLE_TOOL_FILES.includes(fileName)) {
        throw new AgentError('INVALID_INPUT', 'Invalid toolbox file')
      }

      const dirPath = join(globalToolsDir, id)
      if (!existsSync(dirPath)) {
        throw new AgentError('NOT_FOUND', `Global tool "${id}" not found`)
      }

      const filePath = join(dirPath, fileName)
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
      
      const exportAssign = sourceFile.getExportAssignment(d => !d.isExportEquals())
      const arrayLiteral = exportAssign?.getExpressionIfKind(SyntaxKind.ArrayLiteralExpression)
      if (!arrayLiteral) return []

      return arrayLiteral.getElements()
        .map(getLinkedToolNameFromElement)
        .filter((text): text is string => text !== null)
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

      const existing = arrayLiteral.getElements().some(element => {
        return getLinkedToolNameFromElement(element) === toolName
      })
      if (existing) return

      arrayLiteral.addElement(getToolboxImportExpression(toolName))
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

      const elementsToRemove = arrayLiteral.getElements().filter(element => {
        return getLinkedToolNameFromElement(element) === toolName
      })
      // Remove elements in reverse order to preserve indices of earlier elements
      for (let i = elementsToRemove.length - 1; i >= 0; i--) {
        const element = elementsToRemove[i]
        if (element) arrayLiteral.removeElement(element)
      }
      
      sourceFile.formatText()
      sourceFile.saveSync()
    },

  }
}

export type ToolManager = ReturnType<typeof createToolManager>
