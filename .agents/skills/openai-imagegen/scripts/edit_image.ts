#!/usr/bin/env bun
/**
 * Edit an image (or compose from references) with OpenAI gpt-image models.
 *
 * Usage:
 *   bun edit_image.ts --prompt "add a sunset" --image input.png [--image ref2.png]
 *     [--mask mask.png] [--model gpt-image-1.5] [--input-fidelity low|high]
 *     [--size 1024x1024] [--quality high] [--output out.png]
 *
 * Auth/endpoint (first match wins):
 *   OPENAI_API_KEY + OPENAI_BASE_URL (optional, default https://api.openai.com/v1)
 *   CLIPROXY_API_KEY + CLIPROXY_URL or CLIPROXY_DOMAIN — CLIProxyAPI; /v1 appended if missing
 * Endpoint: POST {base}/images/edits (multipart).
 * Note: --input-fidelity applies to gpt-image-1.5 only (gpt-image-2 is fixed high).
 */

function args(name: string): string[] {
  const out: string[] = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1] as string)
  }
  return out
}
const arg = (name: string, fallback?: string) => args(name)[0] ?? fallback

const prompt = arg('prompt')
const images = args('image')
if (!prompt || images.length === 0) {
  console.error('Usage: bun edit_image.ts --prompt "..." --image input.png [--image ref.png] [--mask mask.png] [--model gpt-image-1.5] [--output out.png]')
  process.exit(1)
}

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

const {apiKey, baseUrl} = resolveAuth()

const model = arg('model', 'gpt-image-1.5')!
const output = arg('output', `edited-${Date.now()}.png`)!
const form = new FormData()
form.append('model', model)
form.append('prompt', prompt)
form.append('size', arg('size', '1024x1024')!)
form.append('quality', arg('quality', 'high')!)
for (const img of images) {
  form.append(images.length > 1 ? 'image[]' : 'image', new Blob([await Bun.file(img).arrayBuffer()]), img.split('/').pop())
}
const mask = arg('mask')
if (mask) form.append('mask', new Blob([await Bun.file(mask).arrayBuffer()]), 'mask.png')
const fidelity = arg('input-fidelity')
if (fidelity) form.append('input_fidelity', fidelity)

const res = await fetch(`${baseUrl}/images/edits`, {
  method: 'POST',
  headers: {Authorization: `Bearer ${apiKey}`},
  body: form,
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
