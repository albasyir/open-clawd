import {
  SystemMessage,
  ToolMessage,
  createAgent,
  createMiddleware,
  humanInTheLoopMiddleware,
  summarizationMiddleware,
} from 'langchain'

import model from './model'
import memory from './memory'
import tool from './tool'
import identity from './identity'

const shellRejectedMessage = 'Shell command rejected by User.'

const shellRejectionStopMiddleware = createMiddleware({
  name: 'ShellRejectionStopMiddleware',
  afterModel: {
    canJumpTo: ['end'],
    hook: (state) => {
      const lastMessage = state.messages.at(-1)
      if (!ToolMessage.isInstance(lastMessage)) return
      if (lastMessage.name !== 'shell_exec' || lastMessage.status !== 'error') return

      const content = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content)

      if (!content.includes(shellRejectedMessage)) return

      return {
        jumpTo: 'end' as const,
        messages: [
          new SystemMessage(`${shellRejectedMessage}. now you have to stop and maybe explain why you can't execute the command.`),
        ],
      }
    },
  },
})

const agent = createAgent({
  name: identity.name,
  model: model,
  tools: tool,
  checkpointer: memory,
  middleware: [
    shellRejectionStopMiddleware,
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
  systemPrompt: `**You are ${identity.name}, first assistant of ${identity.owner}.**`
})

export default agent
