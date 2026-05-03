import { ChatOllama } from '@langchain/ollama'

export default new ChatOllama({
  model: 'qwen3.5:4b',
  think: true,
})
