export type GenerateInput = { system: string; prompt: string; maxTokens: number };
export type GenerateResult = { text: string; model: string };

export interface TextGenerator {
  /** Libellé affichable, par exemple « openai-compatible/gemini-2.5-flash ». */
  readonly label: string;
  generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult>;
}

/** Deux minutes : les paliers gratuits connaissent des pics de latence bien au-delà de la minute. */
export const LLM_TIMEOUT_MS = 120_000;
