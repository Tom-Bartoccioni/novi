import { Document, Packer, Paragraph, TextRun } from 'docx';

/** Marges « normales » de Word : 2,54 cm, soit 1440 twips. */
const PAGE_MARGIN_TWIPS = 1440;
/** Corps en 11 points (l'unité de `docx` est le demi-point). */
const BODY_SIZE_HALF_POINTS = 22;
/** Espace après chaque paragraphe, en twips (environ 6 points). */
const PARAGRAPH_SPACING_TWIPS = 120;
/** Police système courante ; la machine qui ouvre le fichier la remplace si besoin. */
const BODY_FONT = 'Arial';
const FILE_NAME_MAX = 80;

/** « Lettre - Nom Entreprise » sans les caractères interdits dans un nom de fichier Windows ou macOS. */
export function letterFileName(companyName: string, extension: 'docx' | 'pdf' = 'docx'): string {
  const clean = companyName
    .replace(/[\\/:*?"<>|]/g, ' ')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: les caractères de contrôle sont interdits dans un nom de fichier
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FILE_NAME_MAX)
    .trim();
  return `Lettre - ${clean || 'Entreprise'}.${extension}`;
}

/**
 * Découpe le texte en paragraphes : une ligne vide sépare deux paragraphes, un simple retour à la ligne
 * à l'intérieur d'un bloc (en-tête, signature) devient un saut de ligne dans le même paragraphe.
 */
export function letterParagraphs(content: string): string[][] {
  return content
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.split('\n').map((line) => line.trimEnd()))
    .filter((lines) => lines.some((l) => l.trim().length > 0));
}

/** Document Word sobre : police système, 11 points, marges normales, aucune couleur. */
export async function buildLetterDocx(content: string): Promise<Buffer> {
  const paragraphs = letterParagraphs(content).map(
    (lines) =>
      new Paragraph({
        spacing: { after: PARAGRAPH_SPACING_TWIPS },
        children: lines.map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : 0 })),
      }),
  );
  const doc = new Document({
    styles: { default: { document: { run: { font: BODY_FONT, size: BODY_SIZE_HALF_POINTS } } } },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: PAGE_MARGIN_TWIPS,
              right: PAGE_MARGIN_TWIPS,
              bottom: PAGE_MARGIN_TWIPS,
              left: PAGE_MARGIN_TWIPS,
            },
          },
        },
        children: paragraphs,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** En-tête `Content-Disposition` avec repli ASCII et forme UTF-8 (RFC 5987) pour les accents. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
