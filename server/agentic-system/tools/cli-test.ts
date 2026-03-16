import { tool } from 'langchain'
import { z } from 'zod'
import { spawnSync } from 'node:child_process'

export default tool((input) => {
  const { command, cwd } = input
  const result = spawnSync(command, {
    shell: true,
    encoding: 'utf-8',
    cwd: cwd || undefined,
    timeout: 30_000
  })
  const stdout = result.stdout?.trim() ?? ''
  const stderr = result.stderr?.trim() ?? ''
  const exitCode = result.status ?? result.signal ? -1 : 0
  const out = [stdout, stderr].filter(Boolean).join('\n') || '(no output)'
  return `Exit code: ${exitCode}\n${out}`
}, {
  name: 'cli',
  description: 'Execute a shell command and return stdout/stderr and exit code',
  schema: z.object({
    command: z.string().describe('The shell command to run (e.g. "ls -la", "echo hello")'),
    cwd: z.string().optional().describe('Working directory for the command (default: current)')
  })
});
