import { extractText, getDocumentProxy } from 'unpdf';
import { AssistError } from './errors';

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
const MIN_TEXT_LENGTH = 50;

/**
 * Erreurs pdf.js qui signalent un fichier illisible. Les erreurs levées côté worker arrivent
 * renommées : `FormatError` devient `UnknownErrorException`, et pdf.js 5 regroupe
 * `MissingPDFException` et `UnexpectedResponseException` dans `ResponseException`.
 */
const PDF_ERROR_NAMES = new Set([
  'InvalidPDFException',
  'PasswordException',
  'MissingPDFException',
  'FormatError',
  'UnexpectedResponseException',
  'ResponseException',
  'UnknownErrorException',
]);

/** Traduit une erreur de lecture pdf.js en `cv_not_pdf`, relance toute autre erreur. */
function toPdfError(err: unknown): unknown {
  const name = err instanceof Error ? err.name : undefined;
  return name && PDF_ERROR_NAMES.has(name) ? new AssistError('cv_not_pdf') : err;
}

/** En-tête exigé à l'octet 0, volontairement : on attend un CV exporté proprement, pas un PDF arbitraire. */
function isPdf(data: Uint8Array): boolean {
  return data.length >= 5 && String.fromCharCode(...data.subarray(0, 5)) === '%PDF-';
}

/** Ramène tous les blancs Unicode hors saut de ligne à une espace et limite les sauts de ligne en rafale. */
export function cleanPdfText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdfText(data: Uint8Array): Promise<{ text: string; pages: number }> {
  if (data.byteLength > MAX_PDF_BYTES) throw new AssistError('cv_too_large');
  if (!isPdf(data)) throw new AssistError('cv_not_pdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js transfère (détache) le tampon reçu : on lui passe une copie pour laisser `data` intact.
    pdf = await getDocumentProxy(data.slice());
  } catch (err) {
    throw toPdfError(err);
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new AssistError('cv_too_large');
    let extracted: { totalPages: number; text: string };
    try {
      extracted = await extractText(pdf, { mergePages: true });
    } catch (err) {
      throw toPdfError(err);
    }
    const cleaned = cleanPdfText(extracted.text);
    if (cleaned.length < MIN_TEXT_LENGTH) throw new AssistError('cv_no_text');
    return { text: cleaned, pages: extracted.totalPages };
  } finally {
    // `pdf.destroy()` n'existe pas dans le pdf.js d'unpdf 1.8 : c'est la tâche de chargement qui libère tout.
    await pdf.loadingTask.destroy();
  }
}
