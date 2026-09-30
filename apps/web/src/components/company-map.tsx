'use client';

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type { CompanyListItem } from '@/lib/data';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const ON_CLASS = 'novi-marker--on';

export type MapProps = {
  home: { latitude: number; longitude: number; radiusKm: number };
  companies: CompanyListItem[];
  highlighted: string | null;
  onHover: (siren: string | null) => void;
  onSelect: (siren: string) => void;
};

/** MapLibre réécrit `style.transform` du marqueur à chaque déplacement : la mise en avant passe par une classe. */
function setHighlighted(el: HTMLElement, on: boolean) {
  el.classList.toggle(ON_CLASS, on);
  el.style.zIndex = on ? '10' : '1';
}

export function CompanyMap({ home, companies, highlighted, onHover, onSelect }: MapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const highlightedRef = useRef<string | null>(highlighted);

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: STYLE_URL,
      center: [home.longitude, home.latitude],
      zoom: 10,
    });
    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    new maplibregl.Marker({ color: '#111' })
      .setLngLat([home.longitude, home.latitude])
      .setPopup(new maplibregl.Popup().setText('Chez moi'))
      .addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [home.latitude, home.longitude]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const marker of markers.current.values()) marker.remove();
    markers.current.clear();
    for (const c of companies) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'novi-marker';
      el.style.cssText =
        'width:20px;height:20px;padding:0;border:0;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;';
      const dot = document.createElement('span');
      dot.style.cssText =
        'display:block;width:14px;height:14px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.3);';
      dot.style.background = c.recruiting ? '#16a34a' : '#2563eb';
      el.appendChild(dot);
      el.title = `${c.name} · score ${c.score}`;
      el.addEventListener('mouseenter', () => onHover(c.siren));
      el.addEventListener('mouseleave', () => onHover(null));
      el.addEventListener('click', () => onSelect(c.siren));
      setHighlighted(el, c.siren === highlightedRef.current);
      markers.current.set(
        c.siren,
        new maplibregl.Marker({ element: el }).setLngLat([c.longitude, c.latitude]).addTo(m),
      );
    }
  }, [companies, onHover, onSelect]);

  useEffect(() => {
    highlightedRef.current = highlighted;
    for (const [siren, marker] of markers.current) setHighlighted(marker.getElement(), siren === highlighted);
  }, [highlighted]);

  return <div ref={container} className="h-[420px] w-full rounded-lg border lg:h-[calc(100vh-8rem)]" />;
}
