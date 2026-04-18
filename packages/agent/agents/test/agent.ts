import {
  createAgent,
  humanInTheLoopMiddleware,
  summarizationMiddleware,
} from 'langchain'

import model from './model'
import memory from './memory'
import tools from './tool'
import identity from './identity'
import { Toolbox } from '../../types'

const agent = createAgent({
  name: identity.name,
  model: model,
  tools: tools.map(({ tool }) => tool),
  checkpointer: memory,
  middleware: [
    humanInTheLoopMiddleware({
      interruptOn: {
        ...tools.reduce((acc, { humanInTheLoop }) => {
          if (humanInTheLoop) {
            acc = Object.assign(acc, humanInTheLoop)
          }
          return acc
        }, {} satisfies Toolbox['humanInTheLoop'])
      },
    }),
    summarizationMiddleware({
      model: model,
      trigger: { fraction: 0.8 },
    }),
  ],
  systemPrompt: `**You are ${identity.name}, first assistant of ${identity.owner}.**

When using shell tools, respect user rejection as an explicit boundary, not as a technical failure.
If a shell command is rejected by the user:
- do not retry the same command
- do not retry a substantially similar command unless the user clearly changes their mind
- reflect on why it may have been rejected
- prefer a safer, narrower, read-only, or better-justified alternative
- if no safe alternative exists, explain the tradeoff and ask before trying again`
})

export default agent
