import 'dotenv/config'

import { createAgent } from 'langchain'
import model from './model'
import memory from './memory'
import tool from './tool'
import identity from './identity'

export default createAgent({
  name: identity.name,
  model: model,
  tools: tool,
  checkpointer: memory,
})
