'use client';

import { useRef, useState, useTransition } from 'react';
import { analyzeWebsite, updateNotes, updateStatus, updateWebsite } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/** Même ordre que COMPANY_STATUSES de @novi/db, qu'un composant client ne peut pas importer (better-sqlite3). */
const LABELS: Record<string, string> = {
  to_review: 'À voir',
  interested: 'Intéressée',
  contacted: 'Contactée',
  rejected: 'Refusée',
  ignored: 'Ignorée',
};
const COMPANY_STATUSES = Object.keys(LABELS);

/** Contrôlé ; la page le monte avec `key={status}` pour resynchroniser la valeur après un rafraîchissement serveur. */
export function StatusSelect({ siren, status }: { siren: string; status: string }) {
  const [value, setValue] = useState(status);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const previous = value;
          setValue(next);
          start(async () => {
            const r = await updateStatus(siren, next);
            if (r.ok) setError(null);
            else {
              setValue(previous);
              setError(r.error);
            }
          });
        }}
      >
        {COMPANY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LABELS[s]}
          </option>
        ))}
      </select>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}

export function NotesField({ siren, notes }: { siren: string; notes: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (
    <div className="space-y-1">
      <Textarea
        defaultValue={notes}
        placeholder="Notes personnelles (contact, impressions, relances…)"
        rows={5}
        onChange={(e) => {
          const value = e.target.value;
          setState('saving');
          clearTimeout(timer.current);
          timer.current = setTimeout(async () => {
            const r = await updateNotes(siren, value);
            if (r.ok) setState('saved');
            else {
              setState('error');
              setError(r.error);
            }
          }, 600);
        }}
      />
      <p className="text-xs text-muted-foreground">
        {state === 'saving' && 'Enregistrement…'}
        {state === 'saved' && 'Enregistré'}
        {state === 'error' && <span className="text-destructive">{error}</span>}
      </p>
    </div>
  );
}

export function WebsiteField({
  siren,
  website,
  canAnalyze,
}: {
  siren: string;
  website: string | null;
  canAnalyze: boolean;
}) {
  const [saved, setSaved] = useState(canAnalyze && website ? website : '');
  const [value, setValue] = useState(website ?? '');
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // On n'analyse que le site enregistré : une saisie non sauvegardée désactive le bouton.
  const canRun = saved !== '' && value.trim() === saved;
  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await updateWebsite(siren, value);
            if (r.ok) {
              const url = r.website ?? value.trim();
              setValue(url);
              setSaved(url);
              setMessage({ kind: 'ok', text: r.message ?? 'Site enregistré' });
            } else {
              setMessage({ kind: 'error', text: r.error });
            }
          });
        }}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://exemple.fr"
          className="h-9"
        />
        <Button type="submit" variant="outline" disabled={pending || !value.trim()}>
          Enregistrer
        </Button>
        <Button
          type="button"
          disabled={pending || !canRun}
          onClick={() =>
            start(async () => {
              setMessage({ kind: 'ok', text: 'Analyse en cours (jusqu’à 60 s)…' });
              const r = await analyzeWebsite(siren);
              setMessage(
                r.ok
                  ? { kind: 'ok', text: r.message ?? 'Analyse terminée' }
                  : { kind: 'error', text: r.error },
              );
            })
          }
        >
          Analyser le site
        </Button>
      </form>
      {message && (
        <p className={`text-sm ${message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
