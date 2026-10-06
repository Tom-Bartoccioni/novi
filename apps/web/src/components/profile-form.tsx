'use client';

import { HEADCOUNT_LABELS } from '@novi/core';
import { useMemo, useState, useTransition } from 'react';
import { geocodeAddress, updateProfile } from '@/app/actions';
import { type CvInfo, CvSection, type CvTech } from '@/components/cv-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { splitFullName } from '@/lib/format';

type Tag = { slug: string; label: string; category: string };
type Initial = {
  homeLabel: string;
  homeLatitude: number;
  homeLongitude: number;
  radiusKm: number;
  skills: string[];
  headcountRanges: string[];
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  postalAddress: string;
  links: string[];
  revealFirstName: boolean;
  newOfferDays: number;
  cv: CvInfo;
  cvTechs: CvTech[];
  nameCandidates: string[];
};

/** Tranches proposées : toutes celles du référentiel, sauf « non renseigné » et « 0 salarié ». */
const HEADCOUNT_CODES = Object.keys(HEADCOUNT_LABELS).filter((code) => code !== 'NN' && code !== '00');
const CATEGORY_LABELS: Record<string, string> = {
  language: 'Langages',
  framework: 'Frameworks',
  database: 'Bases de données',
  cloud: 'Cloud',
  tool: 'Outils',
  domain: 'Domaines',
};

export function ProfileForm({ initial, tags }: { initial: Initial; tags: Tag[] }) {
  const [address, setAddress] = useState(initial.homeLabel);
  const [home, setHome] = useState({
    label: initial.homeLabel,
    latitude: initial.homeLatitude,
    longitude: initial.homeLongitude,
  });
  const [radius, setRadius] = useState(initial.radiusKm);
  const [skills, setSkills] = useState<string[]>(initial.skills);
  const [ranges, setRanges] = useState<string[]>(initial.headcountRanges);
  const [identity, setIdentity] = useState({
    firstName: initial.firstName,
    lastName: initial.lastName,
    email: initial.email,
    phone: initial.phone,
    postalAddress: initial.postalAddress,
    links: initial.links.join('\n'),
    revealFirstName: initial.revealFirstName,
  });
  const [newOfferDays, setNewOfferDays] = useState(initial.newOfferDays);
  const [cv, setCv] = useState<CvInfo>(initial.cv);
  const [cvTechs, setCvTechs] = useState<CvTech[]>(initial.cvTechs);
  const [nameCandidates, setNameCandidates] = useState(initial.nameCandidates);
  const setField = (key: keyof typeof identity, value: string | boolean) =>
    setIdentity((prev) => ({ ...prev, [key]: value }));
  const [filter, setFilter] = useState('');
  const [pending, start] = useTransition();
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const map = new Map<string, Tag[]>();
    for (const t of tags) {
      if (f && !t.label.toLowerCase().includes(f) && !skills.includes(t.slug)) continue;
      map.set(t.category, [...(map.get(t.category) ?? []), t]);
    }
    return [...map.entries()];
  }, [tags, filter, skills]);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  /** L'adresse saisie n'a pas encore été localisée : l'enregistrement la géocode d'abord. */
  const addressDirty = address.trim() !== home.label;

  /** Géocode l'adresse saisie ; retourne le point retenu ou null si introuvable (l'ancien point est conservé). */
  const locate = async () => {
    const r = await geocodeAddress(address);
    if (!r.ok) {
      setMessage({ kind: 'error', text: `${r.error}. L'adresse précédente est conservée.` });
      return null;
    }
    const next = { label: r.label, latitude: r.latitude, longitude: r.longitude };
    setHome(next);
    setAddress(r.label);
    setMessage({ kind: 'ok', text: `Localisé : ${r.label}` });
    return next;
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (importing) return;
        start(async () => {
          const point = addressDirty ? await locate() : home;
          if (!point) return;
          const r = await updateProfile({
            homeLabel: point.label,
            homeLatitude: point.latitude,
            homeLongitude: point.longitude,
            radiusKm: radius,
            skills,
            headcountRanges: ranges,
            firstName: identity.firstName,
            lastName: identity.lastName,
            email: identity.email,
            phone: identity.phone,
            postalAddress: identity.postalAddress,
            links: identity.links.split('\n'),
            revealFirstName: identity.revealFirstName,
            newOfferDays,
          });
          setMessage(
            r.ok ? { kind: 'ok', text: r.message ?? 'Enregistré' } : { kind: 'error', text: r.error },
          );
        });
      }}
    >
      <CvSection
        busy={pending}
        onPendingChange={setImporting}
        cv={cv}
        techs={cvTechs}
        skills={skills}
        onAddSkills={(slugs) => setSkills((prev) => [...prev, ...slugs.filter((s) => !prev.includes(s))])}
        onImported={(r) => {
          setCv({ filename: r.filename, pages: r.pages, uploadedAt: r.uploadedAt, text: r.text });
          setCvTechs(r.techs);
          // Comme la page : les candidats ne sont proposés que tant que le nom est vide.
          setNameCandidates(identity.lastName.trim() ? [] : r.nameCandidates);
          // `applyCv` a rempli côté serveur les champs d'identité vides : on les reflète ici,
          // sinon « Enregistrer le profil » les écraserait avec des valeurs vides.
          setIdentity((prev) => ({
            ...prev,
            email: prev.email || r.hints.email || '',
            phone: prev.phone || r.hints.phone || '',
            links: prev.links || r.hints.links.join('\n'),
          }));
          const n = r.techs.length;
          setMessage({
            kind: 'ok',
            text: `CV importé : ${n} techno${n > 1 ? 's' : ''} détectée${n > 1 ? 's' : ''}`,
          });
        }}
      />

      <section className="space-y-2">
        <h2 className="font-medium">Identité</h2>
        <p className="text-sm text-muted-foreground">
          Ces valeurs ne quittent jamais votre machine : elles servent à les masquer dans ce qui est envoyé au
          LLM, puis à les rétablir dans la lettre.
        </p>
        {nameCandidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-muted-foreground">Nom lu dans le CV :</span>
            {[...new Set(nameCandidates)].map((c) => (
              <button
                type="button"
                key={c}
                className="rounded-full border px-2 py-0.5"
                onClick={() => {
                  const { firstName, lastName } = splitFullName(c);
                  setIdentity((prev) => ({ ...prev, firstName, lastName }));
                }}
              >
                Utiliser : {c}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label="Prénom"
            placeholder="Prénom"
            value={identity.firstName}
            onChange={(e) => setField('firstName', e.target.value)}
          />
          <Input
            aria-label="Nom"
            placeholder="Nom"
            value={identity.lastName}
            onChange={(e) => setField('lastName', e.target.value)}
          />
          <Input
            aria-label="E-mail"
            placeholder="E-mail"
            type="email"
            value={identity.email}
            onChange={(e) => setField('email', e.target.value)}
          />
          <Input
            aria-label="Téléphone"
            placeholder="Téléphone"
            value={identity.phone}
            onChange={(e) => setField('phone', e.target.value)}
          />
          <Input
            aria-label="Adresse postale"
            placeholder="Adresse postale"
            className="sm:col-span-2"
            value={identity.postalAddress}
            onChange={(e) => setField('postalAddress', e.target.value)}
          />
          <Textarea
            aria-label="Liens"
            className="sm:col-span-2"
            placeholder="Liens (un par ligne) : LinkedIn, GitHub, site perso"
            value={identity.links}
            onChange={(e) => setField('links', e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={identity.revealFirstName}
            onChange={(e) => setField('revealFirstName', e.target.checked)}
          />
          Laisser passer mon prénom au LLM (lettre au ton plus naturel)
        </label>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Point de départ</h2>
        <div className="flex gap-2">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Adresse ou ville"
          />
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await locate();
              })
            }
          >
            Localiser
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Actuel : {home.label} ({home.latitude.toFixed(4)}, {home.longitude.toFixed(4)})
        </p>
        {addressDirty && (
          <p className="text-sm text-muted-foreground">
            Adresse modifiée : elle sera localisée à l'enregistrement, ou tout de suite avec Localiser.
          </p>
        )}
        <label htmlFor="radius-km" className="flex items-center gap-2 text-sm">
          Rayon
          <Input
            id="radius-km"
            type="number"
            min={1}
            max={200}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-24"
          />
          km
        </label>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Tailles d'entreprise souhaitées</h2>
        <div className="flex flex-wrap gap-1">
          {HEADCOUNT_CODES.map((code) => (
            <button
              type="button"
              key={code}
              onClick={() => toggle(ranges, setRanges, code)}
              className={`rounded-full border px-2 py-0.5 text-sm ${ranges.includes(code) ? 'bg-foreground text-background' : ''}`}
            >
              {HEADCOUNT_LABELS[code]}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Nouveautés</h2>
        <label htmlFor="new-offer-days" className="flex items-center gap-2 text-sm">
          Considérer une offre comme nouvelle pendant
          <Input
            id="new-offer-days"
            type="number"
            min={1}
            max={90}
            value={newOfferDays}
            onChange={(e) => setNewOfferDays(Number(e.target.value))}
            className="w-20"
          />
          jours
        </label>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Compétences ({skills.length})</h2>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrer les technos"
          className="w-64"
        />
        {grouped.map(([category, list]) => (
          <div key={category}>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {CATEGORY_LABELS[category] ?? category}
            </p>
            <div className="flex flex-wrap gap-1">
              {list.map((t) => (
                <button
                  type="button"
                  key={t.slug}
                  onClick={() => toggle(skills, setSkills, t.slug)}
                  className={`rounded-full border px-2 py-0.5 text-sm ${skills.includes(t.slug) ? 'bg-foreground text-background' : ''}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || importing}>
          Enregistrer le profil
        </Button>
        {message && (
          <span
            className={`text-sm ${message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}
