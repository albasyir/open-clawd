export default [
    (await import('./tools/shell')).default,
    (await import('./tools/codex-code-review')).default
]