import testAgent from './test/agent'
import testIdentity from './test/identity'
export const agents: Record<string, any> = {
  test: {
    agent: testAgent,
    identity: testIdentity
  }
}

export default agents
