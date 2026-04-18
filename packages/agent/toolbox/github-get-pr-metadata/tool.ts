import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { Octokit } from 'octokit'

const githubPullRequestMetadataSchema = z.object({
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  pull_number: z.number().int().positive(),
})

export type GitHubPullRequestMetadataInput = z.infer<
  typeof githubPullRequestMetadataSchema
>

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN

  if (!token) {
    throw new Error('GITHUB_TOKEN is required')
  }

  return new Octokit({ auth: token })
}

export async function getGitHubPullRequestMetadata(
  input: GitHubPullRequestMetadataInput,
) {
  const octokit = getOctokit()

  const result = await octokit.rest.pulls.get({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pull_number,
  })

  return result.data
}

export const githubGetPRMetadata = tool(
  async (input) => getGitHubPullRequestMetadata(input),
  {
    name: 'github_pull_request_metadata',
    description:
      'Get GitHub pull request metadata by owner, repo, and pull_number. when you have PR URL you can extract using `github_pull_request_url_extractor` tool.',
    schema: githubPullRequestMetadataSchema,
  },
)
