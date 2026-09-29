import { type Db, getDefaultProfile, getDb as getSharedDb } from '@novi/db';

export function db(): Db {
  return getSharedDb();
}

export function getProfile() {
  return getDefaultProfile(db());
}
