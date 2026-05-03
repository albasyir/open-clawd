export default [
  (await import('../../toolbox/talivy/index.ts')).default,
  (await import('../../toolbox/shell/index.ts')).default,
  (await import('../../toolbox/get-relevant-skill/index.ts')).default,
  (await import('../../toolbox/get-skill-detail/index.ts')).default
]
