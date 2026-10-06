import { describe, expect, it } from 'vitest';
import { cleanPdfText, extractPdfText, MAX_PDF_BYTES, MAX_PDF_PAGES } from '../src/pdf';

const RESOURCES = '/Resources << /Font << /F1 3 0 R >> >>';

/**
 * PDF 1.4 minimal : une page par texte, police Helvetica, flux non compressé, table xref calculée.
 * Les textes doivent être en ASCII (ni encodage ni police embarquée).
 */
function makePdf(pageTexts: string[]): Uint8Array {
  const objects: string[] = [];
  const kids = pageTexts.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pageTexts.forEach((text, i) => {
    const pageId = 4 + i * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ${RESOURCES} /Contents ${pageId + 1} 0 R >>`,
    );
    const escaped = text.replace(/[()\\]/g, (c) => `\\${c}`);
    const stream = `BT /F1 12 Tf 50 780 Td (${escaped}) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

describe('extractPdfText', () => {
  it('extracts and merges the text of every page', async () => {
    const pdf = makePdf(['Developpeur TypeScript React', 'Experience Node.js PostgreSQL']);
    const result = await extractPdfText(pdf);
    expect(result.pages).toBe(2);
    expect(result.text).toBe('Developpeur TypeScript React\nExperience Node.js PostgreSQL');
  });
  it('leaves the input buffer intact', async () => {
    const pdf = makePdf(['Developpeur TypeScript React', 'Experience Node.js PostgreSQL']);
    const length = pdf.byteLength;
    await extractPdfText(pdf);
    expect(pdf.byteLength).toBe(length);
  });
  it('rejects a PDF without text', async () => {
    await expect(extractPdfText(makePdf(['']))).rejects.toMatchObject({ code: 'cv_no_text' });
  });
  it('rejects more than MAX_PDF_PAGES pages', async () => {
    const pages = Array.from({ length: MAX_PDF_PAGES + 1 }, (_, i) => `Page ${i}`);
    await expect(extractPdfText(makePdf(pages))).rejects.toMatchObject({ code: 'cv_too_large' });
  });
  it('rejects a file above MAX_PDF_BYTES before parsing', async () => {
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    big.set(new TextEncoder().encode('%PDF-1.4\n'));
    await expect(extractPdfText(big)).rejects.toMatchObject({ code: 'cv_too_large' });
  });
  it('rejects a non-PDF buffer', async () => {
    await expect(extractPdfText(new TextEncoder().encode('hello'))).rejects.toMatchObject({
      code: 'cv_not_pdf',
    });
  });
  it('rejects a corrupt PDF with cv_not_pdf', async () => {
    await expect(extractPdfText(new TextEncoder().encode('%PDF-1.4\ngarbage'))).rejects.toMatchObject({
      code: 'cv_not_pdf',
    });
  });
});

describe('cleanPdfText', () => {
  it('normalizes line endings and collapses blank runs', () => {
    expect(cleanPdfText('a \r\n\r\n\r\n\r\nb c')).toBe('a\n\nb c');
  });
  it('turns Unicode spaces and tabs into a single space', () => {
    expect(cleanPdfText('a\u00a0\u202f\tb')).toBe('a b');
  });
});
