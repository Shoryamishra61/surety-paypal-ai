// ============================================================
// SURETY — LLM provider adapters.
//
// Gemini (generous free tier, native response schemas) is the
// default; Groq and OpenAI are drop-in alternatives selected by
// environment. All adapters share the same guarantees: one
// request, hard timeout, structured output validated against
// the caller's Zod schema, and fail-closed error handling.
// ============================================================

import { z } from 'zod';
import { LLMProvider, StructuredRequest, jsonSchemaFor, toGeminiSchema } from './llm';

const DEFAULT_TIMEOUT_MS = 20_000;

function failClosed(provider: string, reason: string): never {
  throw new Error(`${provider} request failed (${reason}); no financial action taken`);
}

/** OpenAI Responses API with strict JSON schema enforcement. */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  constructor(
    readonly model: string,
    private apiKey: string,
    private request: typeof fetch = fetch,
  ) {}
  async structured<T>(call: StructuredRequest<T>): Promise<T> {
    const response = await this.request('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(call.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions: call.system,
        input: call.user,
        text: {
          format: {
            type: 'json_schema',
            name: 'surety',
            strict: true,
            schema: jsonSchemaFor(call.schema),
          },
        },
      }),
    });
    if (!response.ok) failClosed(this.name, String(response.status));
    const envelope = z
      .object({
        status: z.literal('completed'),
        output: z.array(
          z.object({
            type: z.string(),
            content: z
              .array(z.object({ type: z.string(), text: z.string().optional() }))
              .optional(),
          }),
        ),
      })
      .parse(await response.json());
    const texts = envelope.output
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text');
    if (texts.length !== 1 || !texts[0].text)
      failClosed(this.name, 'model did not return one structured output');
    return call.schema.parse(JSON.parse(texts[0].text));
  }
}

/** Google Gemini via Generative Language API; free tier, native response schemas. */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  constructor(
    readonly model: string,
    private apiKey: string,
    private request: typeof fetch = fetch,
  ) {}
  async structured<T>(call: StructuredRequest<T>): Promise<T> {
    const response = await this.request(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(call.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: call.system }] },
          contents: [{ role: 'user', parts: [{ text: call.user }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(jsonSchemaFor(call.schema)),
            // Thinking is disabled: this adapter runs one narrow,
            // schema-bound step, and 3.x thinking adds latency without
            // changing a verdict that is made deterministically later.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );
    if (!response.ok) failClosed(this.name, String(response.status));
    const envelope = z
      .object({
        candidates: z.array(
          z.object({
            content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }),
          }),
        ),
      })
      .parse(await response.json());
    const text = envelope.candidates[0]?.content.parts.map((p) => p.text ?? '').join('');
    if (!text) failClosed(this.name, 'empty model output');
    return call.schema.parse(JSON.parse(text));
  }
}

/** Groq OpenAI-compatible endpoint; JSON mode with the schema stated in the system prompt. */
export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  constructor(
    readonly model: string,
    private apiKey: string,
    private request: typeof fetch = fetch,
  ) {}
  async structured<T>(call: StructuredRequest<T>): Promise<T> {
    const response = await this.request('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(call.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${call.system}\n\nRespond with a single JSON object exactly matching this schema:\n${JSON.stringify(jsonSchemaFor(call.schema))}`,
          },
          { role: 'user', content: call.user },
        ],
      }),
    });
    if (!response.ok) failClosed(this.name, String(response.status));
    const envelope = z
      .object({
        choices: z.array(z.object({ message: z.object({ content: z.string() }) })),
      })
      .parse(await response.json());
    const text = envelope.choices[0]?.message.content;
    if (!text) failClosed(this.name, 'empty model output');
    return call.schema.parse(JSON.parse(text));
  }
}

/**
 * Select a provider from the environment.
 * Priority: explicit LLM_PROVIDER, then first configured key:
 * GEMINI_API_KEY (free tier default), GROQ_API_KEY, OPENAI_API_KEY.
 */
export function createLLMProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider | null {
  const model = env.LLM_MODEL;
  const explicit = env.LLM_PROVIDER?.toLowerCase();
  const wanted =
    explicit ??
    (env.GEMINI_API_KEY
      ? 'gemini'
      : env.GROQ_API_KEY
        ? 'groq'
        : env.OPENAI_API_KEY && env.OPENAI_MODEL
          ? 'openai'
          : null);
  if (!wanted) return null;
  if (wanted === 'gemini' && env.GEMINI_API_KEY)
    return new GeminiProvider(model || env.GEMINI_MODEL || 'gemini-3.5-flash', env.GEMINI_API_KEY);
  if (wanted === 'groq' && env.GROQ_API_KEY)
    return new GroqProvider(model || env.GROQ_MODEL || 'llama-3.3-70b-versatile', env.GROQ_API_KEY);
  if (wanted === 'openai' && env.OPENAI_API_KEY && (model || env.OPENAI_MODEL))
    return new OpenAIProvider((model || env.OPENAI_MODEL)!, env.OPENAI_API_KEY);
  return null;
}
