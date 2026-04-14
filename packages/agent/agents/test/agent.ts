import { createAgent } from 'langchain'

import model from './model'
import memory from './memory'
import tool from './tool'
import identity from './identity'

const agent = createAgent({
  name: identity.name,
  model: model,
  tools: tool,
  checkpointer: memory,
  systemPrompt: `**You are ${identity.name}, first assistant of ${identity.owner}.**`
})

export default agent
