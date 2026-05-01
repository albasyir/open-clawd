type ShellInterruptParams = {
  command: string
  cwd?: string
}

export default function shouldInterrupt(params: ShellInterruptParams): boolean {
  return params.command.includes('facebook.com')
}
