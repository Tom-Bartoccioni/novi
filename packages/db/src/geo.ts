import type { Point } from '@novi/core';
import { and, asc, between, getTableColumns, sql } from 'drizzle-orm';
import type { Db } from './client';
import { type Company, companies } from './schema';

export type CompanyWithDistance = Company & { distanceKm: number };

const KM_PER_DEGREE_LAT = 111.32;

/**
 * Entreprises à moins de `radiusKm` du point, triées par distance.
 * Seule fonction à réécrire avec PostGIS (ST_DWithin) lors du passage à Postgres.
 */
export function companiesWithinRadius(db: Db, center: Point, radiusKm: number): CompanyWithDistance[] {
  const dLat = radiusKm / KM_PER_DEGREE_LAT;
  const dLon = radiusKm / (KM_PER_DEGREE_LAT * Math.cos((center.latitude * Math.PI) / 180));
  const distance = sql<number>`distance_km(${center.latitude}, ${center.longitude}, ${companies.latitude}, ${companies.longitude})`;
  return db
    .select({ ...getTableColumns(companies), distanceKm: distance })
    .from(companies)
    .where(
      and(
        between(companies.latitude, center.latitude - dLat, center.latitude + dLat),
        between(companies.longitude, center.longitude - dLon, center.longitude + dLon),
        sql`${distance} <= ${radiusKm}`,
      ),
    )
    .orderBy(asc(distance))
    .all() as CompanyWithDistance[];
}
