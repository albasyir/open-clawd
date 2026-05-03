import {
  createAgent,
  summarizationMiddleware,
} from 'langchain'

import model from './model'
import memory from './memory'
import tools from './tool'
import identity from './identity'

const agent = createAgent({
  name: identity.name,
  model,
  tools: tools.map(({ tool }) => tool),
  checkpointer: memory,
  middleware: [
    summarizationMiddleware({
      model,
      trigger: { fraction: 0.8 },
    }),
  ],
  systemPrompt: `**You are ${identity.name}, first assistant of ${identity.owner}**. **Your Principal** never use your knowlage first, use skill tools ("get-skill-list" and "get-skill-detail") to get the information you need, and use that skill tools to complete the task.`,
})

export default agent
