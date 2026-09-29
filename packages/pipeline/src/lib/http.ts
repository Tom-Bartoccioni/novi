export const USER_AGENT = 'NoviBot/0.1 (+https://github.com/novi; contact@simwego.com)';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} sur ${url}`);
  }
}

export type FetchOptions = {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'HEAD' | 'POST';
  body?: string;
  maxBytes?: number;
  /** Signal d'annulation fourni par l'appelant ; sinon un délai timeoutMs est appliqué à la réponse. */
  signal?: AbortSignal;
};

export async function fetchWithTimeout(url: string, opts: FetchOptions = {}): Promise<Response> {
  const controller = opts.signal ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000) : null;
  try {
    return await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'user-agent': USER_AGENT, ...opts.headers },
      body: opts.body,
      redirect: 'follow',
      signal: opts.signal ?? controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOptions = {},
): Promise<{ data: T; response: Response }> {
  const response = await fetchWithTimeout(url, {
    ...opts,
    headers: { accept: 'application/json', ...opts.headers },
  });
  if (!response.ok && response.status !== 206) throw new HttpError(response.status, url);
  if (response.status === 204) return { data: null as T, response };
  return { data: (await response.json()) as T, response };
}

export type TextPage = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  contentType: string;
};

/** GET d'une page texte/HTML, lue en flux et tronquée à maxBytes, en-têtes en minuscules. Le délai couvre aussi la lecture du corps. */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<TextPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const response = await fetchWithTimeout(url, { ...opts, signal: controller.signal });
    const contentType = response.headers.get('content-type') ?? '';
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const body = (await readUpTo(response, opts.maxBytes ?? 2_000_000)).toString('utf8');
    return { url: response.url || url, status: response.status, headers, body, contentType };
  } finally {
    clearTimeout(timer);
  }
}

/** Lit le corps en flux et s'arrête dès que maxBytes est atteint, sans télécharger le reste. */
async function readUpTo(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
  } finally {
    if (received >= maxBytes) await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}
