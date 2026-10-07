'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { deleteLetter, generateLetter, updateLetter } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDate } from '@/lib/format';

// Copie structurelle de CoverLetterWithOffer : un composant client n'importe pas @novi/db.
export type LetterSummary = {
  id: number;
  offerId: string | null;
  offerTitle: string | null;
  instruction: string | null;
  content: string;
  model: string;
  createdAt: string;
};

export type LetterAvailability = { ok: true; label: string } | { ok: false; reason: string; href?: string };

type Target = { offerId: string | null; title: string };

/** Téléchargement Word et page d'impression (PDF via le navigateur) d'une lettre enregistrée. */
function ExportLinks({ id }: { id: number }) {
  return (
    <>
      <a href={`/lettres/${id}/docx`} className="text-xs underline">
        Télécharger .docx
      </a>
      <a href={`/lettres/${id}`} target="_blank" rel="noreferrer" className="text-xs underline">
        Imprimer / PDF
      </a>
    </>
  );
}

export function LetterPanel({
  siren,
  offers,
  letters,
  availability,
  maxChars,
}: {
  siren: string;
  offers: { id: string; title: string }[];
  letters: LetterSummary[];
  availability: LetterAvailability;
  /** Longueur maximale demandée au modèle ; au-delà, le compteur passe en rouge. */
  maxChars: number;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState<{ letter: LetterSummary; sentPrompt: string } | null>(null);
  const [content, setContent] = useState('');
  // Initialisé depuis les props : la page est dynamique et remonte le composant à chaque navigation.
  const [history, setHistory] = useState(letters);
  const [showPrompt, setShowPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Élément copié : 'result' pour la lettre affichée, sinon l'id d'une lettre de l'historique.
  const [copied, setCopied] = useState<'result' | number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, start] = useTransition();

  if (!availability.ok) {
    return (
      <p className="text-sm text-muted-foreground">
        {availability.reason}
        {availability.href && (
          <>
            {' '}
            <Link href={availability.href} className="underline">
              Ouvrir le profil
            </Link>
          </>
        )}
      </p>
    );
  }

  // Changer de cible efface la lettre affichée : une lettre spontanée ne doit pas apparaître sous une offre.
  const selectTarget = (next: Target) => {
    if (target?.offerId === next.offerId) return;
    setTarget(next);
    setResult(null);
    setContent('');
    setShowPrompt(false);
    setError(null);
  };

  const run = () => {
    if (!target) return;
    setError(null);
    start(async () => {
      try {
        const r = await generateLetter({ siren, offerId: target.offerId, instruction });
        if (r.ok) {
          setResult({ letter: r.letter, sentPrompt: r.sentPrompt });
          setContent(r.letter.content);
          setHistory((h) => [r.letter, ...h]);
        } else setError(r.error);
      } catch {
        setError('Erreur réseau : réessayez');
      }
    });
  };

  const remove = async (id: number) => {
    setDeletingId(id);
    try {
      const r = await deleteLetter(id, siren);
      if (r.ok) {
        setHistory((h) => h.filter((x) => x.id !== id));
        setError(null);
      } else setError(r.error);
    } catch {
      setError('Erreur réseau : réessayez');
    } finally {
      setDeletingId(null);
    }
  };

  /** Enregistre la relecture faite dans la zone de texte, pour que l'export et l'historique la reflètent. */
  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const r = await updateLetter(result.letter.id, siren, content);
      if (r.ok) {
        const letter = { ...result.letter, content: content.trim() };
        setResult({ ...result, letter });
        setContent(letter.content);
        setHistory((h) => h.map((x) => (x.id === letter.id ? letter : x)));
        setError(null);
      } else setError(r.error);
    } catch {
      setError('Erreur réseau : réessayez');
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string, key: 'result' | number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    } catch {
      setError('Copie impossible : sélectionnez le texte à la main');
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={target && !target.offerId ? 'default' : 'outline'}
          size="sm"
          onClick={() => selectTarget({ offerId: null, title: 'Candidature spontanée' })}
        >
          Lettre spontanée
        </Button>
        {offers.map((o) => (
          <Button
            type="button"
            key={o.id}
            variant={target?.offerId === o.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => selectTarget({ offerId: o.id, title: o.title })}
            title={o.title}
          >
            Lettre : {o.title.length > 40 ? `${o.title.slice(0, 40)}…` : o.title}
          </Button>
        ))}
      </div>
      {target && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="font-medium">{target.title}</p>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="Consigne facultative : « Insister sur mon expérience Rust, ton sobre »"
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={run}>
              {pending ? 'Génération…' : result ? 'Régénérer' : 'Générer'}
            </Button>
            <span className="text-xs text-muted-foreground">via {availability.label}, 5 à 20 s</span>
          </div>
          {result && (
            <div className="space-y-2">
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={18} />
              <p
                className={`text-xs ${content.length > maxChars ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {content.length} / {maxChars} caractères
                {content.length > maxChars ? ' : dépassement, raccourcissez ou régénérez' : ''}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => copy(content, 'result')}>
                  {copied === 'result' ? 'Copié' : 'Copier'}
                </Button>
                {content !== result.letter.content && (
                  <Button type="button" size="sm" variant="outline" disabled={saving} onClick={save}>
                    {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
                  </Button>
                )}
                <ExportLinks id={result.letter.id} />
                <button
                  type="button"
                  className="text-xs underline disabled:opacity-50"
                  onClick={() => setShowPrompt((v) => !v)}
                >
                  {showPrompt ? 'Masquer ce qui a été envoyé' : 'Voir ce qui a été envoyé'}
                </button>
                <span className="text-xs text-muted-foreground">Généré avec {result.letter.model}</span>
              </div>
              {showPrompt && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {result.sentPrompt}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
      {/* Hors du bloc de génération : les erreurs de copie ou de suppression de l'historique restent visibles. */}
      {error && <p className="text-destructive">{error}</p>}
      {history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            Lettres générées ({history.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {history.map((l) => (
              <li key={l.id} className="rounded-md border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {formatDate(l.createdAt)} · {l.offerTitle ?? 'spontanée'} · {l.model}
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      className="underline disabled:opacity-50"
                      onClick={() => copy(l.content, l.id)}
                    >
                      {copied === l.id ? 'Copié' : 'Copier'}
                    </button>
                    <ExportLinks id={l.id} />
                    <button
                      type="button"
                      className="underline disabled:opacity-50"
                      disabled={deletingId !== null}
                      onClick={() => remove(l.id)}
                    >
                      {deletingId === l.id ? 'Suppression…' : 'Supprimer'}
                    </button>
                  </span>
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs">Lire</summary>
                  <pre className="mt-1 whitespace-pre-wrap text-xs">{l.content}</pre>
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
