import { OpenAI } from "@langchain/openai";

export default new OpenAI({
    model: 'gpt-5.3-codex',
    apiKey: process.env.OPENAI_API_KEY,
})