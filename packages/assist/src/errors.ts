export type AssistErrorCode = 'cv_not_pdf' | 'cv_too_large' | 'cv_no_text' | 'llm_misconfigured';

const ASSIST_MESSAGES: Record<AssistErrorCode, string> = {
  cv_not_pdf: "Ce fichier n'est pas un PDF",
  cv_too_large: 'Le CV dépasse la limite (5 Mo ou 10 pages)',
  cv_no_text: 'Aucun texte trouvé : le PDF semble être une image',
  llm_misconfigured: 'Fournisseur LLM mal configuré (voir .env.example)',
};

export class AssistError extends Error {
  readonly code: AssistErrorCode;
  constructor(code: AssistErrorCode, message?: string) {
    super(message ?? ASSIST_MESSAGES[code]);
    this.name = 'AssistError';
    this.code = code;
  }
}

export type LlmErrorCode = 'unauthorized' | 'rate_limited' | 'timeout' | 'bad_response' | 'refused' | 'http';

function llmMessage(code: LlmErrorCode, retryAfterSeconds?: number, status?: number): string {
  switch (code) {
    case 'unauthorized':
      return 'Clé LLM refusée (401/403) : vérifier LLM_API_KEY';
    case 'rate_limited':
      return retryAfterSeconds
        ? `Quota du fournisseur LLM atteint : réessayez dans ${retryAfterSeconds} secondes`
        : 'Quota du fournisseur LLM atteint : réessayez dans quelques minutes';
    case 'timeout':
      return 'Délai dépassé (60 s) en attendant le fournisseur LLM';
    case 'bad_response':
      return 'Réponse inattendue du fournisseur LLM';
    case 'refused':
      return 'Le modèle a refusé de répondre à cette demande';
    case 'http':
      return `Erreur HTTP ${status ?? ''} du fournisseur LLM`.trim();
  }
}

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly retryAfterSeconds?: number;
  readonly status?: number;
  constructor(
    code: LlmErrorCode,
    opts: { retryAfterSeconds?: number; status?: number; message?: string } = {},
  ) {
    super(opts.message ?? llmMessage(code, opts.retryAfterSeconds, opts.status));
    this.name = 'LlmError';
    this.code = code;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.status = opts.status;
  }
}
