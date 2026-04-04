import { OpenAI } from "@langchain/openai";
import identity from "./identity";



export default new OpenAI({
    model: identity.model || 'gpt-5',
    apiKey: identity.apiKey,
})