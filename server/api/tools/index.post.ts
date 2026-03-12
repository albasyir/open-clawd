import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

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
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Name must be letters, numbers, hyphen or underscore only')
})

export default defineEventHandler(async (event) => {
  const rawBody = await readBody(event)
  const result = createToolBodySchema.safeParse(rawBody)
  if (!result.success) {
    const msg = result.error.errors.map((e) => e.message).join('; ')
    throw createError({ statusCode: 400, message: msg })
  }
  const { name } = result.data

  const toolsDir = join(process.cwd(), 'server', 'agentic-system', 'tools')
  const filePath = join(toolsDir, `${name}.ts`)

  if (existsSync(filePath)) {
    throw createError({ statusCode: 409, message: `Tool "${name}" already exists` })
  }

  try {
    mkdirSync(toolsDir, { recursive: true })
    const content = NEW_TOOL_TEMPLATE.replace(/__NAME__/g, name)
    writeFileSync(filePath, content, 'utf-8')
    return { id: name, name }
  } catch (err) {
    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Failed to create tool'
    })
  }
})
