#!/usr/bin/env bun
/**
 * Generate an image with OpenAI gpt-image models.
 *
 * Usage:
 *   bun generate_image.ts --prompt "a red fox" [--model gpt-image-2] [--size 1024x1024]
 *     [--quality low|medium|high|auto] [--background transparent|opaque|auto]
 *     [--output out.png] [--format png|jpeg|webp]
 *
 * Auth/endpoint:
 *   OPENAI_API_KEY   — required (for OpenAI-compatible proxies, the proxy's key)
 *   OPENAI_BASE_URL  — optional, defaults to https://api.openai.com/v1
 *                      (set to your proxy's /v1 base to route through it)
 */

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const prompt = arg('prompt')
if (!prompt) {
  console.error('Usage: bun generate_image.ts --prompt "..." [--model gpt-image-2] [--size 1024x1024] [--quality high] [--background auto] [--output out.png] [--format png]')
  process.exit(1)
}

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  console.error('OPENAI_API_KEY is not set. Use your OpenAI key, or your OpenAI-compatible proxy key with OPENAI_BASE_URL pointed at the proxy.')
  process.exit(1)
}

const model = arg('model', 'gpt-image-2')!
const background = arg('background', 'auto')!
if (model === 'gpt-image-2' && background === 'transparent') {
  console.error('gpt-image-2 does not support transparent backgrounds — use --model gpt-image-1.5')
  process.exit(1)
}

const format = arg('format', 'png')!
const output = arg('output', `image-${Date.now()}.${format}`)!
const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')

const body: Record<string, unknown> = {
  model,
  prompt,
  size: arg('size', '1024x1024'),
  quality: arg('quality', 'high'),
  output_format: format,
  response_format: 'b64_json',
}
if (background !== 'auto') body.background = background

const res = await fetch(`${baseUrl}/images/generations`, {
  method: 'POST',
  headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(300_000),
})

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
  process.exit(1)
}

const json = (await res.json()) as {data?: {b64_json?: string}[]}
const b64 = json.data?.[0]?.b64_json
if (!b64) {
  console.error(`No image in response: ${JSON.stringify(json).slice(0, 300)}`)
  process.exit(1)
}

await Bun.write(output, Buffer.from(b64, 'base64'))
console.log(`Saved ${output} (${Math.round(Buffer.from(b64, 'base64').length / 1024)} KB, model=${model})`)
