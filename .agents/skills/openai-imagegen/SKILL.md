---
name: openai-imagegen
description: Use when generating or editing images with OpenAI gpt-image models (gpt-image-2, gpt-image-1.5) — creating images from text prompts, editing existing images, transparent-background assets like stickers or logos, product mockups, or any request to "generate an image" with OpenAI/gpt-image. Works against api.openai.com directly or any OpenAI-compatible proxy (e.g. CLIProxyAPI) via OPENAI_BASE_URL.
---

# OpenAI Image Generation (gpt-image)

Generate and edit images with `gpt-image-2` and `gpt-image-1.5` via the OpenAI Images API — directly against `api.openai.com`, or through any OpenAI-compatible proxy (e.g. [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), which translates these endpoints to the upstream Responses API).

## Credentials & Endpoint

| Env var | Meaning |
|---------|---------|
| `OPENAI_API_KEY` | Required. Your OpenAI key — or, when using a proxy, the proxy's API key. |
| `OPENAI_BASE_URL` | Optional. Defaults to `https://api.openai.com/v1`. Set to your proxy's `/v1` base to route through it. |

Before hunting for credentials, check whether the environment already provides an OpenAI-compatible proxy (a configured `OPENAI_BASE_URL`, or a local proxy config) — proxies often serve gpt-image models from an OAuth-backed upstream with no per-request OpenAI billing.

Check which image models are actually served: `GET {base}/models` (through a proxy the list may differ from OpenAI's).

## Model Choice

| Model | Pick when | Constraints |
|-------|-----------|-------------|
| `gpt-image-2` (default) | Photorealism, max quality, high-fidelity edits | **No transparent background**; input fidelity fixed high |
| `gpt-image-1.5` | Stickers/logos needing `background: transparent`; edits needing `input_fidelity` control | Slightly older |

Rule: transparency requested → `gpt-image-1.5` + `output_format: png` (or webp). Otherwise `gpt-image-2`.

## Quick Reference

- **Generate:** `POST {base}/images/generations` (JSON)
- **Edit/compose:** `POST {base}/images/edits` (multipart; `image` or `image[]`, optional `mask`)
- **Sizes:** `1024x1024`, `1536x1024` (landscape), `1024x1536` (portrait), `auto`. No exact 16:9 — `1536x1024` is the closest.
- **Params:** `quality` (`low|medium|high|auto`), `background`, `output_format` (`png|jpeg|webp`), `output_compression`, `moderation`
- **Response:** `data[0].b64_json` (use `response_format: b64_json`)
- **Generation takes 30–120s** — set generous HTTP timeouts (300s).
- Images carry C2PA provenance metadata; PNG out by default.

## Scripts

```bash
# Generate
bun ~/.agents/skills/openai-imagegen/scripts/generate_image.ts \
  --prompt "a minimalist robot mascot, flat design" \
  --model gpt-image-2 --size 1536x1024 --quality high --output robot.png

# Sticker with transparency (auto-guards model choice)
bun ~/.agents/skills/openai-imagegen/scripts/generate_image.ts \
  --prompt "kawaii red panda sticker, bold outlines" \
  --model gpt-image-1.5 --background transparent --output panda.png

# Edit / inpaint / compose from references
bun ~/.agents/skills/openai-imagegen/scripts/edit_image.ts \
  --prompt "add a sunset sky" --image scene.png --output sunset.png
```

Run either script with no args for full usage. Both fail with a clear message if `OPENAI_API_KEY` is missing.

## Raw API Pattern

```bash
curl -sS -X POST "${OPENAI_BASE_URL:-https://api.openai.com/v1}/images/generations" \
  -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"a red fox","size":"1024x1024","quality":"high","response_format":"b64_json"}' \
  | jq -r '.data[0].b64_json' | base64 -d > fox.png
```

## Streaming & Multi-Turn

Partial-image streaming (`stream: true`, `partial_images: 1-3`) is SSE-only and unreliable through proxies (CLIProxyAPI translates Images calls to the Responses API internally) — **prefer non-streaming calls**. For iterative refinement, chain `/images/edits` calls feeding the previous output back as `--image`.

## Common Mistakes

- Hardcoding `api.openai.com` when the environment routes through a proxy → honor `OPENAI_BASE_URL`.
- `gpt-image-1` / `dall-e-3` → stale; current models are `gpt-image-2` and `gpt-image-1.5`.
- Transparent background on `gpt-image-2` → unsupported; switch to `gpt-image-1.5`.
- Requesting `1920x1080` → invalid size; use `1536x1024`.
- Default fetch timeouts → generations can exceed 60s; use 300s.
- Trusting the requested size through a proxy → the Responses translation may return a different resolution than requested (observed: `1536x1024` request → `1254x1254` square). Verify with `file` and crop/retry if the aspect ratio matters.
