'use server';

import {
  AssistError,
  analyzeCv,
  createGenerator,
  detectIdentityHints,
  extractPdfText,
  MAX_PDF_BYTES,
} from '@novi/assist';
import { loadTechTags } from '@novi/core';
import { type CoverLetterWithOffer, deleteCoverLetter } from '@novi/db';
import { crawlCompany, geocode } from '@novi/pipeline';
import { revalidatePath } from 'next/cache';
import '@/lib/assist';
import { db, getProfile } from '@/lib/db';
import { generateLetterFor, type LetterRequest } from '@/lib/letters';
import {
  applyCv,
  applyLinkEmployer,
  applyNotes,
  applyProfile,
  applyStatus,
  applyWebsite,
  type ProfileInput,
} from '@/lib/mutations';

type Failure = { ok: false; error: string };

export type ActionResult = { ok: true; message?: string; website?: string } | Failure;

function fail(err: unknown): Failure {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

export async function updateStatus(siren: string, status: string): Promise<ActionResult> {
  try {
    applyStatus(db(), getProfile().id, siren, status);
    revalidatePath(`/entreprises/${siren}`);
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateNotes(siren: string, notes: string): Promise<ActionResult> {
  try {
    applyNotes(db(), getProfile().id, siren, notes);
    revalidatePath(`/entreprises/${siren}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateWebsite(siren: string, website: string): Promise<ActionResult> {
  try {
    const url = applyWebsite(db(), siren, website);
    revalidatePath(`/entreprises/${siren}`);
    return { ok: true, message: 'Site enregistré', website: url };
  } catch (err) {
    return fail(err);
  }
}

/** Délai global de l'action ; le crawl lui-même cesse d'ouvrir des pages bien avant (CRAWL_DEADLINE_MS) pour finir proprement. */
const CRAWL_TIMEOUT_MS = 60_000;
const CRAWL_DEADLINE_MS = 45_000;
const TIMED_OUT = Symbol('timeout');

export async function analyzeWebsite(siren: string): Promise<ActionResult> {
  const refresh = () => {
    revalidatePath(`/entreprises/${siren}`);
    revalidatePath('/');
  };
  const crawl = crawlCompany(db(), siren, { deadlineMs: CRAWL_DEADLINE_MS });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      crawl,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), CRAWL_TIMEOUT_MS);
      }),
    ]);
    if (result === TIMED_OUT) {
      // Le crawl continue et persiste lui-même ses résultats quand il aboutit ; l'utilisateur recharge la page
      // pour les voir. Le revalidatePath tardif n'est qu'un coup de pouce, son échec éventuel est ignoré.
      crawl.then(refresh).catch(() => {});
      return {
        ok: false,
        error: "Délai dépassé (60 s) : l'analyse continue en arrière-plan, rechargez la page dans une minute",
      };
    }
    refresh();
    return {
      ok: true,
      message: `${result.detections.length} technos détectées${result.careersUrl ? ', page carrière trouvée' : ''}`,
    };
  } catch (err) {
    return fail(err);
  } finally {
    clearTimeout(timer);
  }
}

export async function linkEmployer(employerName: string, siren: string): Promise<ActionResult> {
  try {
    const { linked } = applyLinkEmployer(db(), employerName, siren);
    revalidatePath('/employeurs-inconnus');
    revalidatePath(`/entreprises/${siren}`);
    return { ok: true, message: `${linked} offre${linked > 1 ? 's' : ''} rattachée${linked > 1 ? 's' : ''}` };
  } catch (err) {
    return fail(err);
  }
}

export async function geocodeAddress(
  query: string,
): Promise<{ ok: true; label: string; latitude: number; longitude: number } | { ok: false; error: string }> {
  try {
    const r = await geocode(query);
    if (!r) return { ok: false, error: 'Adresse introuvable' };
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateProfile(input: ProfileInput): Promise<ActionResult> {
  try {
    applyProfile(db(), getProfile().id, input);
    revalidatePath('/');
    revalidatePath('/profil');
    return { ok: true, message: 'Profil enregistré' };
  } catch (err) {
    return fail(err);
  }
}

export type UploadCvResult =
  | {
      ok: true;
      filename: string;
      pages: number;
      uploadedAt: string;
      text: string;
      techs: { slug: string; label: string; inProfile: boolean }[];
      nameCandidates: string[];
      hints: { email?: string; phone?: string; links: string[] };
    }
  | Failure;

export async function uploadCv(formData: FormData): Promise<UploadCvResult> {
  try {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Aucun fichier reçu' };
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))
      return { ok: false, error: new AssistError('cv_not_pdf').message };
    if (file.size > MAX_PDF_BYTES) return { ok: false, error: new AssistError('cv_too_large').message };
    const { text, pages } = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
    const tags = loadTechTags();
    const hints = detectIdentityHints(text);
    const profile = getProfile();
    applyCv(db(), profile.id, { filename: file.name, text, pages }, hints);
    const skills = new Set(profile.skills);
    const labels = new Map(tags.map((t) => [t.slug, t.label]));
    const techs = [...new Set(analyzeCv(text, tags).techs.map((d) => d.slug))].map((slug) => ({
      slug,
      label: labels.get(slug) ?? slug,
      inProfile: skills.has(slug),
    }));
    revalidatePath('/profil');
    return {
      ok: true,
      filename: file.name,
      pages,
      // Horodatage tel qu'enregistré par applyCv, pour que l'écran affiche la même valeur qu'après rechargement.
      uploadedAt: getProfile().cvUploadedAt ?? new Date().toISOString(),
      text,
      techs,
      nameCandidates: hints.nameCandidates,
      hints: { email: hints.email, phone: hints.phone, links: hints.links },
    };
  } catch (err) {
    return fail(err);
  }
}

export type GenerateLetterResult = { ok: true; letter: CoverLetterWithOffer; sentPrompt: string } | Failure;

export async function generateLetter(request: LetterRequest): Promise<GenerateLetterResult> {
  try {
    const generator = createGenerator();
    if (!generator) return { ok: false, error: 'Aucun fournisseur LLM configuré (voir .env.example)' };
    const outcome = await generateLetterFor(db(), getProfile(), request, generator);
    revalidatePath(`/entreprises/${request.siren}`);
    return { ok: true, ...outcome };
  } catch (err) {
    // LlmError, AssistError et les refus métier de generateLetterFor (pas de CV, pas de nom, entreprise
    // ou offre inconnue) portent tous un message destiné à l'utilisateur : fail() le transmet tel quel.
    return fail(err);
  }
}

export async function deleteLetter(id: number, siren: string): Promise<ActionResult> {
  try {
    if (!deleteCoverLetter(db(), getProfile().id, id)) return { ok: false, error: 'Lettre introuvable' };
    revalidatePath(`/entreprises/${siren}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
