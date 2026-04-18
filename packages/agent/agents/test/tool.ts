export default [
  (await import('../../toolbox/github-get-pr-metadata')).default,
  (await import('../../toolbox/shell')).default,
  (await import('../../toolbox/talivy')).default,
  (await import('../../toolbox/github-pr-url-extractor')).default
]
