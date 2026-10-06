import { AssistError, LlmError } from '../errors';

/** Un espace ou un saut de ligne ferait échouer l'en-tête, et le message d'erreur recopierait la clé. */
export function assertValidApiKey(apiKey: string): void {
  if (/[^\x21-\x7e]/.test(apiKey)) {
    throw new AssistError(
      'llm_misconfigured',
      'LLM_API_KEY contient des caractères invalides (espace, saut de ligne ?)',
    );
  }
}

/**
 * Annulation par l'appelant, signalée avec le code `timeout` : un appelant qui réessaie
 * sur `timeout` doit d'abord vérifier son propre `signal.aborted`.
 */
export function cancelledError(): LlmError {
  return new LlmError('timeout', { message: 'Génération annulée' });
}

export function timeoutError(timeoutMs: number): LlmError {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return new LlmError('timeout', { message: `Délai dépassé (${seconds} s) en attendant le fournisseur LLM` });
}

/** Valeur d'un en-tête `retry-after` en secondes, ou `undefined` si elle est absente ou illisible. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** Premier `code` textuel (`ECONNREFUSED`…) parmi les causes ; le SDK Anthropic l'enveloppe deux fois. */
function causeCode(err: unknown): string | undefined {
  let cause = err instanceof Error ? err.cause : undefined;
  for (let depth = 0; depth < 3 && cause && typeof cause === 'object'; depth++) {
    const { code } = cause as { code?: unknown };
    if (typeof code === 'string') return code;
    cause = (cause as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Fournisseur injoignable ; la clé est retirée du message si une bibliothèque réseau l'y recopie. */
export function unreachableError(err: unknown, apiKey: string): LlmError {
  let detail = err instanceof Error ? err.message : String(err);
  const code = causeCode(err);
  if (code) detail += ` (${code})`;
  if (apiKey) detail = detail.split(apiKey).join('…');
  return new LlmError('http', { message: `Fournisseur LLM injoignable : ${detail}` });
}
