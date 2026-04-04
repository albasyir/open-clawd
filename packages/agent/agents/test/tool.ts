export default [
    (await import('./tools/shell')).default,
    (await import('./tools/get-weather')).default
]