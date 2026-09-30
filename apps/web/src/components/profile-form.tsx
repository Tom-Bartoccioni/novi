'use client';

import { HEADCOUNT_LABELS } from '@novi/core';
import { useMemo, useState, useTransition } from 'react';
import { geocodeAddress, updateProfile } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Tag = { slug: string; label: string; category: string };
type Initial = {
  homeLabel: string;
  homeLatitude: number;
  homeLongitude: number;
  radiusKm: number;
  skills: string[];
  headcountRanges: string[];
};

const HEADCOUNT_CODES = ['01', '02', '03', '11', '12', '21', '22', '31', '32', '41'];
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
  const [filter, setFilter] = useState('');
  const [pending, start] = useTransition();
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

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateProfile({
            homeLabel: home.label,
            homeLatitude: home.latitude,
            homeLongitude: home.longitude,
            radiusKm: radius,
            skills,
            headcountRanges: ranges,
          });
          setMessage(
            r.ok ? { kind: 'ok', text: r.message ?? 'Enregistré' } : { kind: 'error', text: r.error },
          );
        });
      }}
    >
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
                const r = await geocodeAddress(address);
                if (r.ok) {
                  setHome({ label: r.label, latitude: r.latitude, longitude: r.longitude });
                  setMessage({ kind: 'ok', text: `Localisé : ${r.label}` });
                } else setMessage({ kind: 'error', text: `${r.error}. L'adresse précédente est conservée.` });
              })
            }
          >
            Localiser
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Actuel : {home.label} ({home.latitude.toFixed(4)}, {home.longitude.toFixed(4)})
        </p>
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
        <Button type="submit" disabled={pending}>
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
