import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(() => {
  const templatesDir = join(process.cwd(), 'server', 'agentic-system', 'templates', 'agent')
  
  let templateIds: string[] = []
  try {
    templateIds = readdirSync(templatesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
      .map((dirent) => dirent.name)
  } catch {
    // Return empty if templates directory does not exist yet
  }

  return templateIds.map((id) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
  }))
})
