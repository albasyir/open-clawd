export function createToolTestStreamResponse(
  run: (write: (chunk: unknown) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`))
      }

      try {
        await run(write)
      } catch (error) {
        write({
          type: 'result',
          success: false,
          error: error instanceof Error ? error.message : String(error)
        })
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no'
    }
  })
}
