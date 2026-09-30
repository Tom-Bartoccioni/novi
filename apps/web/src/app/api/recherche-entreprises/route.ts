import { NextResponse } from 'next/server';
import { searchCompaniesByName } from '@/lib/data';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  return NextResponse.json(searchCompaniesByName(db(), q));
}
