import { loadTechTags } from '@novi/core';
import { companies, type Db, replaceCompanyTech, replaceSignals } from '@novi/db';
import { eq, isNotNull } from 'drizzle-orm';
import { log, warn } from '../lib/logger';
import { type RunResult, withRun } from '../lib/run';
import { fetchRepos, type Repo, summarizeRepos } from '../sources/github';

export type EnrichGithubOptions = {
  limit?: number;
  siren?: string;
  fetchRepos?: (org: string) => Promise<Repo[]>;
  now?: Date;
};

export function enrichGithub(db: Db, opts: EnrichGithubOptions): Promise<RunResult> {
  const tags = loadTechTags();
  const fetcher = opts.fetchRepos ?? fetchRepos;
  return withRun(
    db,
    'enrich github',
    { limit: opts.limit ?? null, siren: opts.siren ?? null },
    async (ctx) => {
      const where = opts.siren ? eq(companies.siren, opts.siren) : isNotNull(companies.githubOrg);
      let targets = db
        .select({ siren: companies.siren, name: companies.name, githubOrg: companies.githubOrg })
        .from(companies)
        .where(where)
        .all();
      if (opts.limit !== undefined) targets = targets.slice(0, opts.limit);
      log(`${targets.length} organisations GitHub à lire`);
      for (const t of targets) {
        if (!t.githubOrg) {
          if (opts.siren) warn(`${t.siren} : pas d'organisation GitHub connue`);
          continue;
        }
        ctx.stats.processed += 1;
        try {
          const summary = summarizeRepos(await fetcher(t.githubOrg), tags, opts.now);
          replaceCompanyTech(db, t.siren, 'github', summary.detections);
          replaceSignals(
            db,
            t.siren,
            ['github_active'],
            summary.active
              ? [
                  {
                    kind: 'github_active',
                    value: summary.publicRepos,
                    evidence: `Dernier push le ${summary.lastPushAt?.slice(0, 10)}`,
                  },
                ]
              : [],
          );
          ctx.stats.updated += 1;
          log(
            `${t.name} (${t.githubOrg}) : ${summary.publicRepos} dépôts, ${summary.detections.length} langages${summary.active ? ', actif' : ''}`,
          );
        } catch (err) {
          ctx.error(t.siren, err);
        }
      }
    },
  );
}
