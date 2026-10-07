import { getCoverLetter } from '@novi/db';
import { db, getProfile } from '@/lib/db';
import { buildLetterDocx, contentDisposition, letterFileName } from '@/lib/letter-export';

export const dynamic = 'force-dynamic';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Télécharge une lettre du profil au format Word. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const letterId = Number(id);
  if (!Number.isInteger(letterId)) return new Response('Lettre introuvable', { status: 404 });
  const letter = getCoverLetter(db(), getProfile().id, letterId);
  if (!letter) return new Response('Lettre introuvable', { status: 404 });
  const buffer = await buildLetterDocx(letter.content);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': DOCX_TYPE,
      'content-disposition': contentDisposition(letterFileName(letter.companyName)),
      'cache-control': 'no-store',
    },
  });
}
