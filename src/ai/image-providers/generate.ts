import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

// gpt-image-1 is the working model for this API key (dall-e-3/dall-e-2 no longer
// exist on the endpoint). It is served by POST /v1/images/generations and always
// returns base64-encoded PNGs (response_format is not supported for this model).
const MODEL = 'gpt-image-1';

// gpt-image-1 supports 1024x1024, 1024x1536 (portrait) and 1536x1024 (landscape).
const SIZES: Record<string, string> = {
  '2:3': '1024x1536',
  '1:1': '1024x1024',
  '4:3': '1536x1024',
  '16:9': '1536x1024',
};

// Generated PNGs are written here and served by serve.ts at /generated/<id>.png
// (a real HTTPS URL on the published site; OpenAI only hands back b64_json).
const GENERATED_DIR = path.join(process.cwd(), '.run', 'generated');
const MAX_FILES = 300;

export async function generateImage(prompt: string, aspectRatio: string): Promise<{ url: string }> {
  const ratio = aspectRatio as '2:3' | '1:1' | '4:3' | '16:9';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[image-generation] OPENAI_API_KEY is not configured');

  const client = new OpenAI({ apiKey });
  const response = await client.images.generate({
    model: MODEL,
    prompt,
    size: SIZES[ratio] ?? '1024x1024',
    quality: 'medium',
    n: 1,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('[image-generation] OpenAI returned no image data');

  const png = Buffer.from(b64, 'base64');
  await mkdir(GENERATED_DIR, { recursive: true });
  const id = randomUUID();
  await writeFile(path.join(GENERATED_DIR, `${id}.png`), png);
  await trimOldFiles();

  return { url: `/generated/${id}.png` };
}

/** Keeps disk usage bounded: removes the oldest PNGs once the cap is exceeded. */
async function trimOldFiles(): Promise<void> {
  try {
    const files = (await readdir(GENERATED_DIR)).filter((f) => f.endsWith('.png')).sort();
    for (let i = 0; i < files.length - MAX_FILES; i++) {
      await unlink(path.join(GENERATED_DIR, files[i])).catch(() => {});
    }
  } catch {
    // Cleanup is best-effort; never fail generation because of it.
  }
}
