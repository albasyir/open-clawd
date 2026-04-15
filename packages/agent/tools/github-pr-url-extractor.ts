import { tool } from '@langchain/core/tools'
import { z } from 'zod'

export default tool(
  async (input) => {
    const url = new URL(input.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (url.hostname !== 'github.com') {
      throw new Error(`Unsupported host: ${url.hostname}`)
    }

    if (parts.length < 4 || parts[2] !== 'pull') {
      throw new Error('Not a GitHub pull request URL')
    }

    const pull_number = Number(parts[3])

    if (!Number.isInteger(pull_number) || pull_number <= 0) {
      throw new Error('Invalid pull request number')
    }

    return {
      owner: parts[0],
      repo: parts[1],
      pull_number,
    }
  },
  {
    name: 'github_pull_request_url_extractor',
    description:
      'Extract owner, repo, and pull_number from a GitHub pull request URL.',
    schema: z.object({
      url: z.url(),
    }),
  },
)