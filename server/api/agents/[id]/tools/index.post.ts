import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/** e.g. get-weather -> getWeatherTool, math -> mathTool */
function toolNameToVar(name: string): string {
  const camel = name
    .split(/[-_]/)
    .map((part, i) => (i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join('')
  return `${camel}Tool`
}

function updateAgentFile(agentId: string, toolName: string): void {
  const agentDir = join(process.cwd(), 'server', 'agentic-system', 'agents', agentId)
  const agentPath = join(agentDir, `${agentId}.agent.ts`)
  if (!existsSync(agentPath)) return

  const varName = toolNameToVar(toolName)
  const newImport = `import ${varName} from './tools/${toolName}'`
  let content = readFileSync(agentPath, 'utf-8')

  if (content.includes(newImport)) return

  const lines = content.split('\n')
  let lastToolImportIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (/from\s+['"]\.\/tools\//.test(lines[i]!)) lastToolImportIndex = i
  }
  if (lastToolImportIndex >= 0) {
    lines.splice(lastToolImportIndex + 1, 0, newImport)
    content = lines.join('\n')
  }

  const toolsArrayRegex = /(tools:\s*\[)([\s\S]*?)(\],)/
  const match = content.match(toolsArrayRegex)
  if (match) {
    const inner = match[2]!.trim()
    const newInner = inner ? `${inner}, ${varName}` : varName
    content = content.replace(toolsArrayRegex, `$1${newInner}$3`)
  }

  writeFileSync(agentPath, content, 'utf-8')
}

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

const createToolBodySchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Name must be letters, numbers, hyphen or underscore only'),
  linkGlobal: z.boolean().optional()
})

const GLOBAL_TOOLS_DIR = join(process.cwd(), 'server', 'agentic-system', 'tools')

export default defineEventHandler(async (event) => {
  const agentId = getRouterParam(event, 'id')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }

  const rawBody = await readBody(event)
  const result = createToolBodySchema.safeParse(rawBody)
  if (!result.success) {
    const msg = result.error.errors.map((e) => e.message).join('; ')
    throw createError({ statusCode: 400, message: msg })
  }
  const { name, linkGlobal } = result.data

  const toolsDir = join(process.cwd(), 'server', 'agentic-system', 'agents', agentId, 'tools')
  const linkPath = join(toolsDir, `${name}.ts`)

  if (existsSync(linkPath)) {
    throw createError({ statusCode: 409, message: `Tool "${name}" already exists` })
  }

  try {
    mkdirSync(toolsDir, { recursive: true })

    if (linkGlobal) {
      const globalPath = join(GLOBAL_TOOLS_DIR, `${name}.ts`)
      if (!existsSync(globalPath)) {
        throw createError({ statusCode: 404, message: `Global tool "${name}" not found` })
      }
      const relativeTarget = join('..', '..', '..', 'tools', `${name}.ts`)
      symlinkSync(relativeTarget, linkPath)
    } else {
      const content = NEW_TOOL_TEMPLATE.replace(/__NAME__/g, name)
      writeFileSync(linkPath, content, 'utf-8')
    }

    updateAgentFile(agentId, name)

    return { id: name, name, symlink: !!linkGlobal }
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Failed to create tool'
    })
  }
})
