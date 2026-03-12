/**
 * Registry of all runnable agents. Add new agents here when you create a new *.agent.ts file.
 */
import testAgent from './test.agent'

export type AgentInvokeConfig = { configurable?: { thread_id?: string } }

export const agents: Record<string, {
  invoke: (
    opts: { messages: Array<{ role: string; content: string }> },
    config?: AgentInvokeConfig
  ) => Promise<{ messages?: unknown[] }>
}> = {
  test: testAgent
}

export const agentIds = Object.keys(agents)
