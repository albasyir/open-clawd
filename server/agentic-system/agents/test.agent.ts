import 'dotenv/config'
import { createAgent } from 'langchain'
import { MemorySaver } from '@langchain/langgraph'
import OpenAICodexModel from '../models/open-ai-codex'
import getWeatherTool from '../tools/get-weather'
import mathTool from '../tools/math'

const llmParams = {
  model: 'gpt-5',
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
}

const llmToolCallParams = {
  ...llmParams,
  model: 'gpt-5.3-codex',
}

const checkpointer = new MemorySaver()

export default createAgent({
  name: 'test',
  model: new OpenAICodexModel({
    llmParams,
    llmToolCallParams,
  }),
  tools: [getWeatherTool, mathTool],
  checkpointer,
})
