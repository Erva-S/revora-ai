import { ContextError } from './context-utils.ts';

// Copied from the existing webhook; its transport/model chain stays untouched.
const KNOWN_DEAD_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro']);
const WORKING_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-flash-preview'];
export function modelChain(): string[] {
  const configured = Deno.env.get('GEMINI_MODEL')?.trim();
  return [...new Set([configured && !KNOWN_DEAD_MODELS.has(configured) ? configured : null, ...WORKING_MODELS].filter(Boolean))] as string[];
}
export function embeddingConfig(): { model: string; dims: number } {
  const model = (Deno.env.get('GEMINI_EMBEDDING_MODEL') || 'gemini-embedding-001').replace(/^models\//, '').trim();
  const dims = Number(Deno.env.get('EMBEDDING_DIMS') || '768');
  if (dims !== 768) throw new ContextError('EMBEDDING_DIMS must be 768 for the installed vector schema.');
  if (!/^[a-z0-9.-]+$/i.test(model)) throw new ContextError('Invalid embedding model configuration.');
  return { model, dims };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function geminiRequest(model: string, method: string, body: unknown, deadline: number): Promise<Record<string, any>> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new ContextError('GEMINI_API_KEY is not configured.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ContextError('Gemini request time budget exhausted.');
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(25000, remaining)),
      });
    } catch {
      if (attempt === 2) throw new ContextError('Gemini network request failed.');
      await sleep(Math.min(500 * 2 ** attempt, Math.max(0, deadline - Date.now())));
      continue;
    }
    if (response.ok) {
      try { return await response.json(); } catch { throw new ContextError('Gemini returned invalid JSON.'); }
    }
    // Discard rather than log the provider body (may echo prompt or credentials).
    await response.body?.cancel();
    if (!(response.status === 429 || response.status >= 500) || attempt === 2)
      throw new ContextError(`Gemini ${method} failed (HTTP ${response.status}).`);
    const retryAfter = Number(response.headers.get('retry-after')) * 1000;
    await sleep(Math.min(Math.max(500 * 2 ** attempt, retryAfter || 0), 5000, Math.max(0, deadline - Date.now())));
  }
  throw new ContextError('Gemini request failed.');
}

export async function generateJson(prompt: string): Promise<{ value: unknown; model: string }> {
  const deadline = Date.now() + 100000;
  for (const model of modelChain()) {
    try {
      const payload = await geminiRequest(model, 'generateContent', {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      }, deadline);
      const raw = payload?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('');
      if (!raw) throw new ContextError('Gemini returned no briefing content.');
      return { value: JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()), model };
    } catch { console.warn(`[Context] Text generation failed for model ${model}; trying fallback.`); }
  }
  throw new ContextError('Briefing generation failed for all configured models.');
}

export async function embedTexts(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY', timeBudgetMs = 100000): Promise<number[][]> {
  const { model, dims } = embeddingConfig();
  const result: number[][] = new Array(texts.length);
  const deadline = Date.now() + timeBudgetMs;
  let next = 0;
  // At most two simultaneous requests; each inline batch has at most 100 inputs.
  const worker = async () => {
    while (next < texts.length) {
      const offset = next; next += 100;
      const batch = texts.slice(offset, offset + 100);
      const payload = await geminiRequest(model, 'batchEmbedContents', {
        requests: batch.map((text) => ({ model: `models/${model}`, content: { parts: [{ text }] },
          taskType, outputDimensionality: dims })),
      }, deadline);
      if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== batch.length)
        throw new ContextError('Gemini returned an incomplete embedding batch.');
      payload.embeddings.forEach((embedding: { values?: number[] }, i: number) => {
        const values = embedding.values;
        if (!Array.isArray(values) || values.length !== dims || !values.every((v) => typeof v === 'number' && Number.isFinite(v)))
          throw new ContextError('Gemini returned an invalid embedding vector.');
        const norm = Math.hypot(...values);
        if (!norm) throw new ContextError('Gemini returned a zero embedding vector.');
        // Truncated Gemini embeddings should be normalized before use.
        result[offset + i] = values.map((v) => v / norm);
      });
    }
  };
  await Promise.all([worker(), worker()]);
  return result;
}
