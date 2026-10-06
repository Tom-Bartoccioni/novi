import { extractText, getDocumentProxy } from 'unpdf';
import { AssistError } from './errors';

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
const MIN_TEXT_LENGTH = 50;

function isPdf(data: Uint8Array): boolean {
  return data.length >= 5 && String.fromCharCode(...data.subarray(0, 5)) === '%PDF-';
}

/** Réduit les espaces insécables, les espaces multiples et les sauts de ligne en rafale. */
export function cleanPdfText(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
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
  } catch {
    throw new AssistError('cv_not_pdf');
  }
  if (pdf.numPages > MAX_PDF_PAGES) throw new AssistError('cv_too_large');
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const cleaned = cleanPdfText(text);
  if (cleaned.length < MIN_TEXT_LENGTH) throw new AssistError('cv_no_text');
  return { text: cleaned, pages: totalPages };
}
