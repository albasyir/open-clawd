import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const createAgentSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_-]+$/i, 'Use only letters, numbers, hyphen or underscore'),
  template: z.string().min(1).regex(/^[a-z0-9_-]+$/i, 'Invalid template id')
})

export default defineEventHandler(async (event) => {
  const rawBody = await readBody(event)
  const result = createAgentSchema.safeParse(rawBody)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.error.issues[0]?.message || 'Invalid input' })
  }
  const { name, template } = result.data

  const agentsDir = join(process.cwd(), 'server', 'agentic-system', 'agents')
  const newAgentDir = join(agentsDir, name)

  if (existsSync(newAgentDir)) {
    throw createError({ statusCode: 409, message: 'Agent with this name already exists' })
  }

  const templateDir = join(process.cwd(), 'server', 'agentic-system', 'templates', 'agent', template)
  if (!existsSync(templateDir)) {
    throw createError({ statusCode: 404, message: 'Template not found' })
  }

  try {
    cpSync(templateDir, newAgentDir, { recursive: true })

    const agentName = name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]/g, ' ')
    
    return {
      id: name,
      agentId: name,
      agent: {
        name: agentName,
        avatar: { src: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}` }
      },
      messages: [],
      updatedAt: new Date().toISOString()
    }
  } catch (err) {
    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Failed to create agent'
    })
  }
})
