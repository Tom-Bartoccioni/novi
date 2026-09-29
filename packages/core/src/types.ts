export type TechCategory = 'language' | 'framework' | 'database' | 'cloud' | 'tool' | 'domain';

export type TechTag = {
  slug: string;
  label: string;
  category: TechCategory;
  aliases: string[];
  contextRequired?: string[];
  fingerprints?: string[];
};

export type Detection = {
  slug: string;
  evidence: string;
  confidence: number;
};

export type DetectionSource = 'offre' | 'site' | 'github' | 'manuel';

export type ScoreProfile = {
  skills: string[];
  radiusKm: number;
  headcountRanges: string[];
};

export type ScoreCompany = {
  headcountRange: string | null;
  techs: { slug: string; confidence: number }[];
  /** Pour chaque offre active, les slugs de technos détectées dans l'offre. */
  activeOffers: { techSlugs: string[] }[];
  signals: { kind: string; value: number | null }[];
};

export type ScoreLine = { label: string; points: number };

export type ScoreResult = { score: number; lines: ScoreLine[] };
