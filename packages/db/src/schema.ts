import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const now = () => new Date().toISOString();

const timestamps = {
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
};

export type Finances = Record<string, { ca: number | null; resultat_net: number | null }>;

export const companies = sqliteTable(
  'companies',
  {
    siren: text('siren').primaryKey(),
    name: text('name').notNull(),
    legalName: text('legal_name').notNull(),
    tradeNames: text('trade_names', { mode: 'json' }).$type<string[]>().notNull().default([]),
    nafCode: text('naf_code').notNull(),
    nafLabel: text('naf_label'),
    headcountRange: text('headcount_range'),
    headcountYear: text('headcount_year'),
    companyCategory: text('company_category'),
    foundedAt: text('founded_at'),
    siretLocal: text('siret_local').notNull(),
    address: text('address'),
    postalCode: text('postal_code'),
    city: text('city'),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    headquartersInZone: integer('headquarters_in_zone', { mode: 'boolean' }).notNull().default(true),
    finances: text('finances', { mode: 'json' }).$type<Finances>(),
    website: text('website'),
    websiteSource: text('website_source', { enum: ['offre', 'osm', 'devinette', 'manuel'] }),
    websiteConfidence: real('website_confidence'),
    careersUrl: text('careers_url'),
    githubOrg: text('github_org'),
    linkedinUrl: text('linkedin_url'),
    description: text('description'),
    lastCrawledAt: text('last_crawled_at'),
    rawSirene: text('raw_sirene', { mode: 'json' }).$type<unknown>(),
    ...timestamps,
  },
  (t) => [index('companies_lat_lon').on(t.latitude, t.longitude), index('companies_naf').on(t.nafCode)],
);

export const techTags = sqliteTable('tech_tags', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  category: text('category').notNull(),
  aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull(),
  contextRequired: text('context_required', { mode: 'json' }).$type<string[]>(),
  ...timestamps,
});

export const companyTech = sqliteTable(
  'company_tech',
  {
    siren: text('siren')
      .notNull()
      .references(() => companies.siren, { onDelete: 'cascade' }),
    tagSlug: text('tag_slug')
      .notNull()
      .references(() => techTags.slug, { onDelete: 'cascade' }),
    source: text('source', { enum: ['offre', 'site', 'github', 'manuel'] }).notNull(),
    confidence: real('confidence').notNull(),
    evidence: text('evidence'),
    detectedAt: text('detected_at').notNull().$defaultFn(now),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.siren, t.tagSlug, t.source] }), index('company_tech_tag').on(t.tagSlug)],
);

export const jobOffers = sqliteTable(
  'job_offers',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull().default('france_travail'),
    siren: text('siren').references(() => companies.siren, { onDelete: 'set null' }),
    employerName: text('employer_name'),
    title: text('title').notNull(),
    description: text('description'),
    url: text('url'),
    contractType: text('contract_type'),
    publishedAt: text('published_at'),
    updatedAtSource: text('updated_at_source'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    city: text('city'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastSeenRunId: integer('last_seen_run_id'),
    raw: text('raw', { mode: 'json' }).$type<unknown>(),
    ...timestamps,
  },
  (t) => [index('job_offers_siren').on(t.siren), index('job_offers_active').on(t.isActive)],
);

export const employerAliases = sqliteTable('employer_aliases', {
  employerNameNormalized: text('employer_name_normalized').primaryKey(),
  siren: text('siren')
    .notNull()
    .references(() => companies.siren, { onDelete: 'cascade' }),
  ...timestamps,
});

export const SIGNAL_KINDS = [
  'recruiting_now',
  'hired_last_12_months',
  'careers_page_found',
  'github_active',
  'revenue_growth',
  'esn_suspected',
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const signals = sqliteTable(
  'signals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siren: text('siren')
      .notNull()
      .references(() => companies.siren, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SIGNAL_KINDS }).notNull(),
    value: real('value'),
    evidence: text('evidence'),
    detectedAt: text('detected_at').notNull().$defaultFn(now),
    ...timestamps,
  },
  (t) => [index('signals_siren_kind').on(t.siren, t.kind)],
);

export const profiles = sqliteTable('profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  homeLabel: text('home_label').notNull(),
  homeLatitude: real('home_latitude').notNull(),
  homeLongitude: real('home_longitude').notNull(),
  radiusKm: real('radius_km').notNull(),
  skills: text('skills', { mode: 'json' }).$type<string[]>().notNull().default([]),
  headcountRanges: text('headcount_ranges', { mode: 'json' }).$type<string[]>().notNull().default([]),
  ...timestamps,
});

export const COMPANY_STATUSES = ['to_review', 'interested', 'contacted', 'rejected', 'ignored'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const companyStatus = sqliteTable(
  'company_status',
  {
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    siren: text('siren')
      .notNull()
      .references(() => companies.siren, { onDelete: 'cascade' }),
    status: text('status', { enum: COMPANY_STATUSES }).notNull().default('to_review'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.profileId, t.siren] })],
);

export type RunStats = {
  processed: number;
  created: number;
  updated: number;
  errors: number;
  [k: string]: number;
};
export type RunError = { siren?: string; message: string };

export const crawlRuns = sqliteTable('crawl_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  command: text('command').notNull(),
  args: text('args', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  startedAt: text('started_at').notNull().$defaultFn(now),
  finishedAt: text('finished_at'),
  stats: text('stats', { mode: 'json' }).$type<RunStats>(),
  errors: text('errors', { mode: 'json' }).$type<RunError[]>().notNull().default([]),
  ...timestamps,
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type JobOffer = typeof jobOffers.$inferSelect;
export type NewJobOffer = typeof jobOffers.$inferInsert;
export type Signal = typeof signals.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type CompanyTechRow = typeof companyTech.$inferSelect;
export type CrawlRun = typeof crawlRuns.$inferSelect;
