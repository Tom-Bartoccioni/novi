import { describe, expect, it } from 'vitest';
import { AssistError } from '../src/errors';
import { extractPdfText, MAX_PDF_BYTES, MAX_PDF_PAGES } from '../src/pdf';

/** PDF 1.4 minimal : une page par texte, police Helvetica, flux non compressé, table xref calculée. */
function makePdf(pageTexts: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pageTexts.map((_, i) => 4 + i * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pageTexts.forEach((text, i) => {
    const contentId = (pageIds[i] as number) + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
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
    expect(result.text).toContain('Developpeur TypeScript React');
    expect(result.text).toContain('Node.js PostgreSQL');
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
    await expect(extractPdfText(big)).rejects.toBeInstanceOf(AssistError);
  });
  it('rejects a non-PDF buffer', async () => {
    await expect(extractPdfText(new TextEncoder().encode('hello'))).rejects.toMatchObject({
      code: 'cv_not_pdf',
    });
  });
});
