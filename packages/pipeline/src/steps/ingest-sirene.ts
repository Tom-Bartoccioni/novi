import { loadIngestConfig } from '@novi/core';
import { companies, type Db } from '@novi/db';
import { eq } from 'drizzle-orm';
import { log } from '../lib/logger';
import { type RunResult, withRun } from '../lib/run';
import {
  hasLocalEstablishment,
  iterateSearch,
  type SearchResult,
  toCompanyRow,
} from '../sources/recherche-entreprises';

export type IngestSireneOptions = {
  departement: string;
  limit?: number;
  /** Injectable pour les tests : par défaut, parcourt toutes les combinaisons NAF × tranche. */
  iterate?: () => AsyncIterable<SearchResult>;
};

async function* iterateAll(departement: string, nafCodes: string[], headcountRanges: string[]) {
  for (const nafCode of nafCodes) {
    for (const headcountRange of headcountRanges) {
      log(`SIRENE ${departement} NAF ${nafCode} tranche ${headcountRange}`);
      yield* iterateSearch({ departement, nafCode, headcountRange });
    }
  }
}

export function ingestSirene(db: Db, opts: IngestSireneOptions): Promise<RunResult> {
  const config = loadIngestConfig();
  const iterate =
    opts.iterate ?? (() => iterateAll(opts.departement, config.nafCodes, config.headcountRanges));
  return withRun(
    db,
    'ingest sirene',
    { departement: opts.departement, limit: opts.limit ?? null },
    async (ctx) => {
      ctx.stats.skipped = 0;
      ctx.stats.skippedNoLocal = 0;
      ctx.stats.skippedNoCoords = 0;
      for await (const result of iterate()) {
        if (opts.limit !== undefined && ctx.stats.processed >= opts.limit) break;
        ctx.stats.processed += 1;
        try {
          const row = toCompanyRow(result, opts.departement, config.nafLabels);
          if (!row) {
            ctx.stats.skipped += 1;
            // Soit rien dans le département, soit des établissements sans coordonnées exploitables.
            if (hasLocalEstablishment(result, opts.departement)) ctx.stats.skippedNoCoords += 1;
            else ctx.stats.skippedNoLocal += 1;
            continue;
          }
          const exists = db
            .select({ siren: companies.siren })
            .from(companies)
            .where(eq(companies.siren, row.siren))
            .get();
          if (exists) {
            const { siren: _siren, ...update } = row;
            db.update(companies).set(update).where(eq(companies.siren, row.siren)).run();
            ctx.stats.updated += 1;
          } else {
            db.insert(companies).values(row).run();
            ctx.stats.created += 1;
          }
        } catch (err) {
          ctx.error(result.siren, err);
        }
      }
    },
  );
}
