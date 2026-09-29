import type { ScoreResult } from '@novi/core';

export function ScoreLines({ score }: { score: ScoreResult }) {
  return (
    <div>
      <p className="text-3xl font-semibold tabular-nums">{score.score}</p>
      {score.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun critère ne s'applique.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {score.lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-4">
              <span>{l.label}</span>
              <span className={`tabular-nums ${l.points < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                {l.points > 0 ? '+' : ''}
                {l.points}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
