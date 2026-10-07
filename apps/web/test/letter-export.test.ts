import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildLetterDocx, contentDisposition, letterFileName, letterParagraphs } from '@/lib/letter-export';

/** Lit `word/document.xml` d'un .docx (zip) sans dépendance : parcourt les en-têtes locaux de fichiers. */
function documentXml(zip: Buffer): string {
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const compressed = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const data = zip.subarray(start, start + compressed);
    if (name === 'word/document.xml') {
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    offset = start + compressed;
  }
  throw new Error('word/document.xml introuvable');
}

describe('letterFileName', () => {
  it('builds « Lettre - Nom Entreprise.docx » without forbidden characters', () => {
    expect(letterFileName('CLEEVEN SE')).toBe('Lettre - CLEEVEN SE.docx');
    expect(letterFileName('Cliken / Web: "x"?')).toBe('Lettre - Cliken Web x.docx');
    expect(letterFileName('   ')).toBe('Lettre - Entreprise.docx');
    expect(letterFileName('Société Générale', 'pdf')).toBe('Lettre - Société Générale.pdf');
    expect(letterFileName('a'.repeat(200)).length).toBeLessThan(100);
  });
});

describe('letterParagraphs', () => {
  it('splits on blank lines and keeps single line breaks inside a block', () => {
    const text =
      'Jean Dupont\r\n06 12 34 56 78\n\nNice, le 7 octobre 2026\n\n\nMadame, Monsieur,\n\n\n\nCordialement,\nJean  ';
    expect(letterParagraphs(text)).toEqual([
      ['Jean Dupont', '06 12 34 56 78'],
      ['Nice, le 7 octobre 2026'],
      ['Madame, Monsieur,'],
      ['Cordialement,', 'Jean'],
    ]);
  });
  it('ignores empty input', () => {
    expect(letterParagraphs('  \n\n ')).toEqual([]);
  });
});

describe('buildLetterDocx', () => {
  it('produces a Word document with every paragraph and the requested styling', async () => {
    const buffer = await buildLetterDocx('Jean Dupont\n06 12 34 56 78\n\nMadame, Monsieur,\n\nCordialement');
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const xml = documentXml(buffer);
    expect(xml).toContain('Jean Dupont');
    expect(xml).toContain('06 12 34 56 78');
    expect(xml).toContain('Madame, Monsieur,');
    expect(xml).toContain('Cordialement');
    expect(xml).toContain('<w:br/>');
    expect(xml).toMatch(/w:top="1440"/);
    expect(xml).not.toMatch(/w:color="(?!000000|auto)/);
  });
});

describe('contentDisposition', () => {
  it('gives an ASCII fallback and a UTF-8 form', () => {
    expect(contentDisposition('Lettre - Société.docx')).toBe(
      `attachment; filename="Lettre - Soci_t_.docx"; filename*=UTF-8''Lettre%20-%20Soci%C3%A9t%C3%A9.docx`,
    );
  });
});
