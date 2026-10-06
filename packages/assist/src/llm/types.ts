export type GenerateInput = { system: string; prompt: string; maxTokens: number };
export type GenerateResult = { text: string; model: string };

export interface TextGenerator {
  /** Libellé affichable, par exemple « openai-compatible/gemini-2.5-flash ». */
  readonly label: string;
  generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult>;
}

export const LLM_TIMEOUT_MS = 60_000;
