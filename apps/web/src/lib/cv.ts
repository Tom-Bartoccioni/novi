import { analyzeCv } from '@novi/assist';
import { loadTechTags } from '@novi/core';

export type CvTechView = { slug: string; label: string; inProfile: boolean };

/** Technos détectées dans le texte du CV (une par slug), avec leur libellé et leur présence dans le profil. */
export function cvTechsFor(text: string, skills: string[]): CvTechView[] {
  const tags = loadTechTags();
  const labels = new Map(tags.map((t) => [t.slug, t.label]));
  const owned = new Set(skills);
  return [...new Set(analyzeCv(text, tags).techs.map((d) => d.slug))].map((slug) => ({
    slug,
    label: labels.get(slug) ?? slug,
    inProfile: owned.has(slug),
  }));
}
