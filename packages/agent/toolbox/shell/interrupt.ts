type ShellInterruptParams = {
  command: string
  cwd?: string
}

export default function(params: ShellInterruptParams): boolean {
  return params.command.includes('x.com')
}
