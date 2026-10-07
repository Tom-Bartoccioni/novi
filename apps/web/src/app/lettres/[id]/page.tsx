import { getCoverLetter } from '@novi/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/print-button';
import { db, getProfile } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { letterParagraphs } from '@/lib/letter-export';

export const dynamic = 'force-dynamic';

const LINE_BREAK = String.fromCharCode(10);

/**
 * Page d'impression d'une lettre : mise en page sobre, barre d'outils masquée à l'impression
 * (classe `print:hidden`), le navigateur propose « Enregistrer au format PDF ».
 */
export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const letterId = Number(id);
  if (!Number.isInteger(letterId)) notFound();
  const letter = getCoverLetter(db(), getProfile().id, letterId);
  if (!letter) notFound();
  const paragraphs = letterParagraphs(letter.content);

  return (
    <div className="mx-auto max-w-[17cm] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm print:hidden">
        <Link href={`/entreprises/${letter.siren}`} className="text-muted-foreground hover:underline">
          ← {letter.companyName}
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {letter.offerTitle ?? 'Candidature spontanée'} · {formatDate(letter.createdAt)}
          </span>
          <a href={`/lettres/${letter.id}/docx`} className="text-xs underline">
            Télécharger .docx
          </a>
          <PrintButton />
        </div>
      </div>
      <article className="letter-print space-y-3 text-[11pt] leading-relaxed">
        {paragraphs.map((lines) => {
          // Les paragraphes n'ont pas d'identifiant et la liste est figée : leur texte sert de clé.
          const text = lines.join(LINE_BREAK);
          return (
            <p key={text} className="whitespace-pre-line">
              {text}
            </p>
          );
        })}
      </article>
    </div>
  );
}
