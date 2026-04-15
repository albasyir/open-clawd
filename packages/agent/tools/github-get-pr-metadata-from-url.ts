import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { getGitHubPullRequestMetadata } from './github-get-pr-metadata'

const githubPullRequestUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .describe('GitHub pull request URL, for example https://github.com/owner/repo/pull/123'),
})

export function parseGitHubPullRequestUrl(urlString: string) {
  const url = new URL(urlString)

  if (!['github.com', 'www.github.com'].includes(url.hostname)) {
    throw new Error('Only github.com pull request URLs are supported')
  }

  const segments = url.pathname.split('/').filter(Boolean)

  if (segments.length < 4 || segments[2] !== 'pull') {
    throw new Error('URL must match https://github.com/{owner}/{repo}/pull/{number}')
  }

  const pullNumber = Number.parseInt(segments[3] ?? '', 10)

  if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
    throw new Error('Pull request number in URL must be a positive integer')
  }

  return {
    owner: segments[0] ?? '',
    repo: segments[1] ?? '',
    pull_number: pullNumber,
  }
}

export const githubPullRequestMetadataFromUrlTool = tool(
  async (input) => {
    const parsed = parseGitHubPullRequestUrl(input.url)
    return getGitHubPullRequestMetadata(parsed)
  },
  {
    name: 'github_pull_request_metadata_from_url',
    description:
      'Get GitHub pull request metadata from a GitHub pull request URL.',
    schema: githubPullRequestUrlSchema,
  },
)

export default githubPullRequestMetadataFromUrlTool
