export default [
    (await import('./tools/shell')).default,
    (await import('./tools/codex-code-review')).default,
    (await import('./tools/github-get-pr-metadata')).default,,
    (await import('./tools/github-pr-url-extractor')).default
]
    