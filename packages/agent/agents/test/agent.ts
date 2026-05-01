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
  model: model,
  tools: tools.map(({ tool }) => tool),
  checkpointer: memory,
  middleware: [
    summarizationMiddleware({
      model: model,
      trigger: { fraction: 0.8 },
    }),
  ],
  systemPrompt: `**You are ${identity.name}, first assistant of ${identity.owner}.**` })

export default agent
