async function importTool() {
  if (!import.meta.url.includes('/packages/agent/toolbox/')) {
    // @ts-expect-error Runtime TS loaders and Nuxt both need the explicit extension.
    return await import('./tool.ts')
  }

  const toolUrl = new URL('./tool.ts', import.meta.url)
  toolUrl.searchParams.set('t', Date.now().toString())
  return await import(toolUrl.href)
}

const { githubGetPRMetadata } = await importTool()

export default {
    tool: githubGetPRMetadata,
}
