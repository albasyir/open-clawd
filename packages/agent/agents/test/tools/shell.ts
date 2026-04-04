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
  name: 'shell_exec',
  description: `Access the machine terminal and execute shell commands.

This tool allows you to perform any task that can be done via a command-line interface (CLI), including but not limited to:

- Networking:
  ping, curl, wget, traceroute, nslookup, dig
  Examples:
    ping facebook.com
    curl -I https://example.com
    wget https://example.com/file

- Filesystem:
  ls, cd, pwd, mkdir, rm, cp, mv, cat, touch
  Examples:
    ls -la
    cat file.txt
    mkdir logs

- File editing / writing:
  echo, printf, redirection (>, >>), tee
  Examples:
    echo "hello" > file.txt
    printf "data" >> file.txt

- Search and processing:
  grep, find, awk, sed
  Examples:
    grep "error" app.log
    find . -name "*.ts"

- System / environment:
  whoami, env, export, ps, top
  Examples:
    ps aux
    env

- Development tools:
  node, npm, yarn, pnpm, git, docker
  Examples:
    node -v
    git status
    docker ps

- Compression / archive:
  zip, unzip, tar
  Examples:
    tar -xvf file.tar
    unzip file.zip

You may translate natural language into an appropriate shell command.
If the user asks for something that can be done in a terminal, use this tool.

This is the primary interface for interacting with the machine.`,
  schema: z.object({
    command: z.string().describe('The shell command to run (e.g. "ls -la", "echo hello")'),
    cwd: z.string().optional().describe('Working directory for the command (default: current)')
  })
});
