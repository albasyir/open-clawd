import 'dotenv/config'

import { createAgent } from 'langchain'
import testModel from './model'
import testMemory from './memory'
import testTool from './tool'

export default createAgent({
  name: 'test',
  model: testModel,
  tools: testTool,
  checkpointer: testMemory,
})
