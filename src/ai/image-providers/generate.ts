import OpenAI from 'openai';
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
// gpt-image-1 always returns b64_json, so we hand the client a
// data:image/png;base64 URL directly. No filesystem writes are involved — this
// keeps the function compatible with Vercel serverless (read-only filesystem).
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
  return { url: `data:image/png;base64,${b64}` };
}
