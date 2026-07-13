#!/usr/bin/env bun
/**
 * Generate an image with OpenAI gpt-image models.
 *
 * Usage:
 *   bun generate_image.ts --prompt "a red fox" [--model gpt-image-2] [--size 1024x1024]
 *     [--quality low|medium|high|auto] [--background transparent|opaque|auto]
 *     [--output out.png] [--format png|jpeg|webp]
 *
 * Auth/endpoint (first match wins):
 *   OPENAI_API_KEY + OPENAI_BASE_URL (optional, default https://api.openai.com/v1)
 *   CLIPROXY_API_KEY + CLIPROXY_URL or CLIPROXY_DOMAIN — CLIProxyAPI; /v1 appended if missing
 */

function resolveAuth(): {apiKey: string; baseUrl: string} {
  const trimBase = (u: string) => u.replace(/\/$/, '')
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: trimBase(process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'),
    }
  }
  if (process.env.CLIPROXY_API_KEY) {
    const domain = process.env.CLIPROXY_DOMAIN
    const raw = process.env.CLIPROXY_URL ?? (domain ? (domain.includes('://') ? domain : `https://${domain}`) : process.env.OPENAI_BASE_URL)
    if (!raw) {
      console.error('CLIPROXY_API_KEY is set but no endpoint — set CLIPROXY_URL or CLIPROXY_DOMAIN (e.g. your-cliproxy-host.example).')
      process.exit(1)
    }
    const base = trimBase(raw)
    return {apiKey: process.env.CLIPROXY_API_KEY, baseUrl: base.endsWith('/v1') ? base : `${base}/v1`}
  }
  console.error('No credentials. Set OPENAI_API_KEY (+ optional OPENAI_BASE_URL), or CLIPROXY_API_KEY + CLIPROXY_URL for CLIProxyAPI. Project .env files work if your runner loads them (e.g. Bun auto-loads ./.env).')
  process.exit(1)
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const prompt = arg('prompt')
if (!prompt) {
  console.error('Usage: bun generate_image.ts --prompt "..." [--model gpt-image-2] [--size 1024x1024] [--quality high] [--background auto] [--output out.png] [--format png]')
  process.exit(1)
}

const {apiKey, baseUrl} = resolveAuth()

const model = arg('model', 'gpt-image-2')!
const background = arg('background', 'auto')!
if (model === 'gpt-image-2' && background === 'transparent') {
  console.error('gpt-image-2 does not support transparent backgrounds — use --model gpt-image-1.5')
  process.exit(1)
}

const format = arg('format', 'png')!
const output = arg('output', `image-${Date.now()}.${format}`)!
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
