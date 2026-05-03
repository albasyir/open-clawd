import { tool } from '@langchain/core/tools'
import { z } from 'zod'

const githubPullRequestUrlSchema = z.object({
  url: z.url(),
})

export const githubPullRequestUrlExtractorTool = tool(
  async (input) => {
    const url = new URL(input.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (url.hostname !== 'github.com') {
      throw new Error(`Unsupported host: ${url.hostname}`)
    }

    const [owner, repo, marker, pullNumberPath] = parts
    if (!owner || !repo || marker !== 'pull' || !pullNumberPath) {
      throw new Error('Not a GitHub pull request URL')
    }

    const pull_number = Number(pullNumberPath)

    if (!Number.isInteger(pull_number) || pull_number <= 0) {
      throw new Error('Invalid pull request number')
    }

    return {
      owner,
      repo,
      pull_number,
    }
  },
  {
    name: 'github_pull_request_url_extractor',
    description:
      'Extract owner, repo, and pull_number from a GitHub pull request URL.',
    schema: githubPullRequestUrlSchema,
  },
)
