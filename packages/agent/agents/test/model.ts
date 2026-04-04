import OpenAICodexModel from "../../models/open-ai-codex";

const llmParams = {
    model: 'gpt-5',
    apiKey: 'sk-',
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
}

const llmToolCallParams = {
    ...llmParams,
    model: 'gpt-5.3-codex',
}

export default new OpenAICodexModel({
    llmParams,
    llmToolCallParams,
})