import { tool } from '@langchain/core/tools'
import { TavilySearch } from '@langchain/tavily'
import { z } from 'zod'

const internetSearchSchema = z.object({
  query: z.string().describe('The search query'),
  maxResults: z
    .number()
    .optional()
    .default(5)
    .describe('Maximum number of results to return'),
  topic: z
    .enum(['general', 'news', 'finance'])
    .optional()
    .default('general')
    .describe('Search topic category'),
  includeRawContent: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include raw content'),
})

type InternetSearchInput = z.infer<typeof internetSearchSchema>

export default tool(
  async ({
    query,
    maxResults = 5,
    topic = 'general',
    includeRawContent = false,
  }: InternetSearchInput) => {
    const tavilySearch = new TavilySearch({
      maxResults,
      tavilyApiKey: process.env.TAVILY_API_KEY,
      includeRawContent,
      topic,
    })
    return tavilySearch.invoke({ query })
  },
  {
    name: 'internet_search',
    description: 'Run a web search',
    schema: internetSearchSchema,
  },
)
