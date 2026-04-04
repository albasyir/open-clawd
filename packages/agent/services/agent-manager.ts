import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentError } from '../types'
import type { AgentInfo, AgentFileInfo, TemplateInfo } from '../types'
import agents from '../agents'

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .map((block: any) => (block?.type === 'text' ? block.text : typeof block === 'string' ? block : ''))
      .filter(Boolean)
      .join('')
    if (text) return text
  }
  if (content != null && typeof content === 'object') return JSON.stringify(content)
  return ''
}

const ALLOWED_FILES = ['agent.ts', 'memory.ts', 'model.ts', 'identity.ts', 'soul.md']

export function createAgentManager(baseDir: string) {
  const agentsDir = join(baseDir, 'agents')
  const templatesDir = join(baseDir, 'templates', 'agent')

  return {
    listAgents(): AgentInfo[] {
      const now = new Date().toISOString()
      return Object.entries(agents).map(([id, data]) => {
        let name = id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
        if (data.identity?.name) name = data.identity.name
        return {
          id,
          agentId: id,
          agent: {
            name,
            avatar: { src: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(id)}` },
          },
          messages: [],
          updatedAt: now,
        }
      })
    },

    createAgent(name: string, template: string): AgentInfo {
      const newAgentDir = join(agentsDir, name)
      if (existsSync(newAgentDir)) {
        throw new AgentError(409, 'Agent with this name already exists')
      }
      const templateDir = join(templatesDir, template)
      if (!existsSync(templateDir)) {
        throw new AgentError(404, 'Template not found')
      }
      cpSync(templateDir, newAgentDir, { recursive: true })
      const agentName = name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]/g, ' ')
      return {
        id: name,
        agentId: name,
        agent: {
          name: agentName,
          avatar: { src: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}` },
        },
        messages: [],
        updatedAt: new Date().toISOString(),
      }
    },

    async invokeAgent(id: string, threadId: string, message: string): Promise<{ reply: string }> {
      const agentData = agents[id]
      if (!agentData) throw new AgentError(404, `Agent "${id}" not found`)

      const agent = agentData.agent
      if (!agent?.invoke) throw new AgentError(404, `Agent "${id}" is invalid or has no invoke method`)

      const config = { configurable: { thread_id: threadId } }
      const result = await agent.invoke(
        { messages: [{ role: 'user' as const, content: message }] },
        config,
      )

      const allMessages = result?.messages ?? []
      const lastMessage = allMessages.at(-1) as { content?: unknown } | undefined
      const reply = lastMessage ? extractTextContent(lastMessage.content) : ''
      return { reply: reply || '(No response from agent)' }
    },

    listAgentFiles(agentId: string): AgentFileInfo[] {
      const agentDir = join(agentsDir, agentId)
      return ALLOWED_FILES.map((file) => {
        const filePath = join(agentDir, file)
        let name = file
        if (name.endsWith('.ts')) name = name.slice(0, -3)
        if (name.endsWith('.md')) name = name.slice(0, -3)
        let content: string | undefined
        try {
          content = readFileSync(filePath, 'utf-8')
        } catch {
          if (file === 'soul.md') {
            content = 'Now you are agent for user, soon or leter you become someone'
          }
        }
        return { id: file, name, content, symlink: false }
      }).filter((f) => f.content !== undefined)
    },

    updateAgentFile(agentId: string, fileId: string, content: string): void {
      if (!ALLOWED_FILES.includes(fileId)) {
        throw new AgentError(400, 'Invalid file id')
      }
      const filePath = join(agentsDir, agentId, fileId)
      writeFileSync(filePath, content, 'utf-8')
    },

    listTemplates(): TemplateInfo[] {
      try {
        return readdirSync(templatesDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .map((d) => ({
            id: d.name,
            name: d.name.charAt(0).toUpperCase() + d.name.slice(1).replace(/[-_]/g, ' '),
          }))
      } catch {
        return []
      }
    },
  }
}

export type AgentManager = ReturnType<typeof createAgentManager>
