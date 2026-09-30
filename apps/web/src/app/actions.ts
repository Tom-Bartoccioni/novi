'use server';

import { crawlCompany, geocode } from '@novi/pipeline';
import { revalidatePath } from 'next/cache';
import { db, getProfile } from '@/lib/db';
import {
  applyLinkEmployer,
  applyNotes,
  applyProfile,
  applyStatus,
  applyWebsite,
  type ProfileInput,
} from '@/lib/mutations';

export type ActionResult = { ok: true; message?: string; website?: string } | { ok: false; error: string };

function fail(err: unknown): ActionResult {
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
      // Le crawl continue : on rafraîchit la page quand il aboutit, sans faire échouer quoi que ce soit.
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
