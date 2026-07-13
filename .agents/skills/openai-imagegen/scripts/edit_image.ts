#!/usr/bin/env bun
/**
 * Edit an image (or compose from references) with OpenAI gpt-image models.
 *
 * Usage:
 *   bun edit_image.ts --prompt "add a sunset" --image input.png [--image ref2.png]
 *     [--mask mask.png] [--model gpt-image-1.5] [--input-fidelity low|high]
 *     [--size 1024x1024] [--quality high] [--output out.png]
 *
 * Auth: OPENAI_API_KEY env var; OPENAI_BASE_URL optional (defaults to
 * https://api.openai.com/v1 — set to your OpenAI-compatible proxy's /v1 base).
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

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  console.error('OPENAI_API_KEY is not set. Use your OpenAI key, or your OpenAI-compatible proxy key with OPENAI_BASE_URL pointed at the proxy.')
  process.exit(1)
}

const model = arg('model', 'gpt-image-1.5')!
const output = arg('output', `edited-${Date.now()}.png`)!
const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')

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
