import { IndentationText, Node, Project, QuoteKind, SyntaxKind } from 'ts-morph'
import { join } from 'node:path'

function createProject() {
  return new Project({
    useInMemoryFileSystem: false,
    manipulationSettings: {
      quoteKind: QuoteKind.Single,
      indentationText: IndentationText.TwoSpaces,
    },
  })
}

function toSafeIdentifier(agentName: string, kind: 'agent' | 'identity') {
  const sanitized = agentName
    .replace(/[^a-zA-Z0-9_$]/g, '_')
    .replace(/^[^a-zA-Z_$]/, '_$&')
  const base = sanitized || 'agent'
  return `${base}_${kind}`
}

export function registerAgent(baseDir: string, agentName: string): void {
  const indexPath = join(baseDir, 'agents', 'index.ts')
  const project = createProject()
  const source = project.addSourceFileAtPath(indexPath)

  const agentModuleSpecifier = `./${agentName}/agent`
  const identityModuleSpecifier = `./${agentName}/identity`
  const agentImportName = toSafeIdentifier(agentName, 'agent')
  const identityImportName = toSafeIdentifier(agentName, 'identity')

  if (source.getImportDeclaration((d) => d.getModuleSpecifierValue() === agentModuleSpecifier)) {
    return
  }

  source.addImportDeclaration({
    defaultImport: agentImportName,
    moduleSpecifier: agentModuleSpecifier,
  })
  source.addImportDeclaration({
    defaultImport: identityImportName,
    moduleSpecifier: identityModuleSpecifier,
  })

  const agentsVar = source.getVariableDeclaration('agents')
  if (!agentsVar) return

  const initializer = agentsVar.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression)
  if (!initializer) return

  initializer.addPropertyAssignment({
    name: JSON.stringify(agentName),
    initializer: `{ agent: ${agentImportName}, identity: ${identityImportName} }`,
  })

  source.formatText({ indentSize: 2 })
  source.saveSync()
}

export function unregisterAgent(baseDir: string, agentName: string): void {
  const indexPath = join(baseDir, 'agents', 'index.ts')
  const project = createProject()
  const source = project.addSourceFileAtPath(indexPath)

  const agentModuleSpecifier = `./${agentName}/agent`
  const identityModuleSpecifier = `./${agentName}/identity`

  source.getImportDeclaration((d) => d.getModuleSpecifierValue() === agentModuleSpecifier)?.remove()
  source.getImportDeclaration((d) => d.getModuleSpecifierValue() === identityModuleSpecifier)?.remove()

  const agentsVar = source.getVariableDeclaration('agents')
  if (!agentsVar) return

  const initializer = agentsVar.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression)
  if (!initializer) return

  initializer
    .getProperty((property) => {
      if (!Node.isPropertyAssignment(property)) return false
      const key = property.getNameNode().getText().replace(/^['"]|['"]$/g, '')
      return key === agentName
    })
    ?.remove()

  source.formatText({ indentSize: 2 })
  source.saveSync()
}
