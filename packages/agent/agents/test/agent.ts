import {
  createAgent,
  humanInTheLoopMiddleware,
  summarizationMiddleware,
} from 'langchain'

import model from './model'
import memory from './memory'
import tool from './tool'
import identity from './identity'

const agent = createAgent({
  name: identity.name,
  model: model,
  tools: tool,
  checkpointer: memory,
  middleware: [
    humanInTheLoopMiddleware({
      interruptOn: {
        shell_exec: {
          allowedDecisions: ['approve', 'edit', 'reject'],
          description: (toolCall) => {
            const command = typeof toolCall.args?.command === 'string'
              ? toolCall.args.command
              : JSON.stringify(toolCall.args)
            const cwd = typeof toolCall.args?.cwd === 'string'
              ? `\nWorking directory: ${toolCall.args.cwd}`
              : ''

            return `Command: ${command}${cwd}`
          },
        },
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
