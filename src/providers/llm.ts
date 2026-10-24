// ============================================================
// SURETY — LLM abstraction.
//
// One narrow interface: trusted system instructions plus fenced
// untrusted user content in, schema-validated structured JSON
// out. Providers never receive tools, credentials, or payment
// authority; the Zod schema is the contract and every response
// is parsed against it before use.
// ============================================================

import { z } from 'zod';

export interface StructuredRequest<T> {
  /** Trusted instruction text authored by the server. */
  system: string;
  /** Untrusted content. Callers must label it as data, never instructions. */
  user: string;
  /** The contract the response must satisfy. */
  schema: z.ZodType<T>;
  timeoutMs?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  structured<T>(request: StructuredRequest<T>): Promise<T>;
}

/** Shared JSON Schema rendering used by providers that accept one. */
export function jsonSchemaFor<T>(schema: z.ZodType<T>): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

/**
 * Gemini accepts a subset of JSON Schema. Normalize the Zod output:
 * drop keywords Gemini rejects and express nullability with `nullable`.
 */
export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== 'object') return node;
  const source = node as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  let nullable = false;
  if (Array.isArray(source.type)) {
    const types = source.type.map(String);
    nullable = types.includes('null');
    result.type = types.find((t) => t !== 'null') ?? 'string';
  } else if (source.type !== undefined) {
    result.type = source.type;
  }
  if (nullable) result.nullable = true;
  if (source.description !== undefined) result.description = source.description;
  if (Array.isArray(source.enum)) result.enum = source.enum;
  if (Array.isArray(source.required)) result.required = source.required;
  if (source.properties !== undefined)
    result.properties = Object.fromEntries(
      Object.entries(source.properties as Record<string, unknown>).map(([key, value]) => [
        key,
        toGeminiSchema(value),
      ]),
    );
  if (source.items !== undefined) result.items = toGeminiSchema(source.items);
  if (result.properties !== undefined && result.required === undefined)
    result.required = Object.keys(result.properties as Record<string, unknown>);
  return result;
}
