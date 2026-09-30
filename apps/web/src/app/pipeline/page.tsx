import { pipelineOverview, type RunWithStatus } from '@/lib/data';
import { db } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const COUNT_LABELS: Record<string, string> = {
  companies: 'Entreprises',
  withWebsite: 'Avec site web',
  crawled: 'Sites analysés',
  techDetections: 'Technos détectées',
  activeOffers: 'Offres actives',
  unmatchedOffers: 'Offres non rattachées',
};

function duration(run: RunWithStatus): string {
  if (run.status === 'running') return 'en cours';
  if (run.status === 'aborted' || !run.finishedAt) return 'interrompu';
  const s = Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Clé stable par erreur : siren et message, suffixés en cas de doublon (la liste n'est jamais réordonnée). */
function keyedErrors(errors: RunWithStatus['errors']) {
  const seen = new Map<string, number>();
  return errors.slice(0, 20).map((e) => {
    const base = `${e.siren ?? ''}:${e.message}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...e, key: n ? `${base}#${n}` : base };
  });
}

export default function PipelinePage() {
  const { runs, counts } = pipelineOverview(db());
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Pipeline</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Object.entries(counts).map(([key, value]) => (
          <div key={key} className="rounded-lg border p-3">
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{COUNT_LABELS[key] ?? key}</p>
          </div>
        ))}
      </div>
      <div>
        <h2 className="mb-2 font-medium">Derniers runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun run. Lancer `pnpm pipeline run all --departement 06`.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Commande</th>
                <th className="py-1 pr-3">Début</th>
                <th className="py-1 pr-3">Durée</th>
                <th className="py-1 pr-3">Statistiques</th>
                <th className="py-1">Erreurs</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="py-1 pr-3 font-mono text-xs">{r.command}</td>
                  <td className="py-1 pr-3">{formatDate(r.startedAt)}</td>
                  <td className="py-1 pr-3">{duration(r)}</td>
                  <td className="py-1 pr-3 font-mono text-xs">
                    {r.stats
                      ? Object.entries(r.stats)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(' ')
                      : '—'}
                  </td>
                  <td className="py-1 text-xs">
                    {r.errors.length === 0 ? (
                      '0'
                    ) : (
                      <details>
                        <summary className="cursor-pointer">{r.errors.length}</summary>
                        <ul className="mt-1 space-y-0.5 text-muted-foreground">
                          {keyedErrors(r.errors).map((e) => (
                            <li key={e.key}>
                              {e.siren ? `${e.siren} : ` : ''}
                              {e.message}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
