import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/** Add a dynamic import entry to the agent's tool.ts file. */
function updateToolFile(agentId: string, toolName: string): void {
  const agentDir = join(process.cwd(), 'server', 'agentic-system', 'agents', agentId)
  const toolFilePath = join(agentDir, 'tool.ts')
  if (!existsSync(toolFilePath)) return

  const newEntry = `    (await import('./tools/${toolName}')).default`
  let content = readFileSync(toolFilePath, 'utf-8')

  // Already registered
  if (content.includes(`'./tools/${toolName}'`)) return

  // Insert before the closing bracket of the exported array
  // Pattern: find the last `]` that closes `export default [`
  const closingBracketIndex = content.lastIndexOf(']')
  if (closingBracketIndex === -1) return

  const before = content.slice(0, closingBracketIndex).trimEnd()
  const after = content.slice(closingBracketIndex)

  // Check if the array already has entries (need a comma)
  const hasEntries = before.includes('(await import(')
  const separator = hasEntries ? ',\n' : '\n'

  content = before + separator + newEntry + '\n' + after
  writeFileSync(toolFilePath, content, 'utf-8')
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
    const msg = result.error.issues.map((e: { message: string }) => e.message).join('; ')
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

    updateToolFile(agentId, name)

    return { id: name, name, symlink: !!linkGlobal }
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Failed to create tool'
    })
  }
})
