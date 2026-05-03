import testAgent from './test/agent'
import testIdentity from './test/identity'
export type AgentRegistryEntry = {
  agent: unknown
  identity: {
    name?: string
    owner?: string
    avatar?: { src: string }
  }
}

export const agents: Record<string, AgentRegistryEntry> = {
  test: {
    agent: testAgent,
    identity: testIdentity
  }
}

export default agents
