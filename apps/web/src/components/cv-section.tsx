'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { type UploadCvResult, uploadCv } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';

export type CvInfo = { filename: string; pages: number; uploadedAt: string; text: string } | null;
export type CvTech = { slug: string; label: string; inProfile: boolean };

/** Au-delà de 6 Mo, Next rejette le corps de l'action serveur (413) avant `uploadCv` : on filtre ici. */
const MAX_CV_BYTES = 5 * 1024 * 1024;

export function CvSection({
  busy,
  onPendingChange,
  cv,
  techs,
  skills,
  onAddSkills,
  onImported,
}: {
  /** Le formulaire parent enregistre : l'import attend. */
  busy: boolean;
  /** Signale au parent qu'un import est en cours, pour bloquer l'enregistrement. */
  onPendingChange: (pending: boolean) => void;
  cv: CvInfo;
  techs: CvTech[];
  skills: string[];
  onAddSkills: (slugs: string[]) => void;
  onImported: (result: Extract<UploadCvResult, { ok: true }>) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);
  const fileInput = useRef<HTMLInputElement>(null);
  const inProfile = techs.filter((t) => skills.includes(t.slug));
  const missing = techs.filter((t) => !skills.includes(t.slug));

  return (
    <section className="space-y-2">
      <h2 className="font-medium">CV</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Fichier PDF du CV"
          className="text-sm"
        />
        <Button
          type="button"
          variant="outline"
          disabled={pending || busy}
          onClick={() => {
            setError(null);
            const file = fileInput.current?.files?.[0];
            if (!file) {
              setError('Choisissez un fichier PDF');
              return;
            }
            if (file.size > MAX_CV_BYTES) {
              setError('Le CV dépasse 5 Mo');
              return;
            }
            const data = new FormData();
            data.set('file', file);
            start(async () => {
              const r = await uploadCv(data);
              if (r.ok) onImported(r);
              else setError(r.error);
            });
          }}
        >
          {pending ? 'Import…' : 'Importer'}
        </Button>
        {cv && (
          <span className="text-sm text-muted-foreground">
            {cv.filename} · {cv.pages} page{cv.pages > 1 ? 's' : ''} · importé le {formatDate(cv.uploadedAt)}
          </span>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {cv && (
        <div className="space-y-2 text-sm">
          {inProfile.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Déjà dans le profil</p>
              <div className="flex flex-wrap gap-1">
                {inProfile.map((t) => (
                  <span key={t.slug} className="rounded-full border px-2 py-0.5 text-muted-foreground">
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Détectées dans le CV, absentes du profil ({missing.length})
            </p>
            {missing.length === 0 ? (
              <p className="text-muted-foreground">Rien à ajouter.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                {missing.map((t) => (
                  <button
                    type="button"
                    key={t.slug}
                    onClick={() => onAddSkills([t.slug])}
                    className="rounded-full border border-foreground px-2 py-0.5"
                    title="Ajouter au profil"
                  >
                    {t.label}
                  </button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onAddSkills(missing.map((t) => t.slug))}
                >
                  Tout ajouter au profil
                </Button>
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Les ajouts ne sont enregistrés qu'avec « Enregistrer le profil ».
            </p>
          </div>
          <details>
            <summary className="cursor-pointer text-muted-foreground">Voir le texte extrait</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
              {cv.text}
            </pre>
          </details>
        </div>
      )}
      {!cv && (
        <p className="text-sm text-muted-foreground">
          PDF texte uniquement (pas de scan), 10 pages et 5 Mo au plus. Seul le texte extrait est conservé.
        </p>
      )}
    </section>
  );
}
