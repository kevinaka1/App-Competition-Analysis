import gplay from '@mradex77/google-play-scraper';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type AppInput = {
  name: string;
  appSummary: string;
  appleAppStoreUrl: string | null;
  googlePlayUrl: string | null;
};

type StoreMetadata = {
  averageUserRating: number | null;
  userRatingCount: number | null;
};

type AppMetadata = AppInput & {
  averageUserRating: number | null;
  reviewCount: number | null;
  errors: Partial<Record<'appleStore' | 'googlePlay', string>>;
};

function getAppleId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'apps.apple.com') return null;
    return url.pathname.match(/\/id(\d+)(?:\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function getGooglePlayId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'play.google.com' || url.pathname !== '/store/apps/details') return null;
    const appId = url.searchParams.get('id');
    return appId && /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(appId) ? appId : null;
  } catch {
    return null;
  }
}

async function fetchAppleMetadata(appId: string): Promise<StoreMetadata> {
  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', appId);
  url.searchParams.set('country', 'us');

  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Apple lookup returned ${response.status}.`);
  const payload = await response.json() as {
    results?: Array<{ trackId?: number; averageUserRating?: number; userRatingCount?: number }>;
  };
  const result = payload.results?.find((item) => String(item.trackId) === appId);
  if (!result) throw new Error('No Apple App Store listing was found for this ID.');

  return {
    averageUserRating: typeof result.averageUserRating === 'number' ? result.averageUserRating : null,
    userRatingCount: typeof result.userRatingCount === 'number' ? result.userRatingCount : null
  };
}

async function fetchGooglePlayMetadata(appId: string): Promise<StoreMetadata> {
  const result = await gplay.app({ appId, lang: 'en', country: 'us' });
  return {
    averageUserRating: typeof result.score === 'number' ? result.score : null,
    userRatingCount: typeof result.ratings === 'number' ? result.ratings : null
  };
}

async function loadAppMetadata(app: AppInput): Promise<AppMetadata> {
  const appleId = app.appleAppStoreUrl ? getAppleId(app.appleAppStoreUrl) : null;
  const googlePlayId = app.googlePlayUrl ? getGooglePlayId(app.googlePlayUrl) : null;
  const errors: AppMetadata['errors'] = {};

  const [appleResult, googleResult] = await Promise.all([
    appleId ? fetchAppleMetadata(appleId).then((data) => ({ data })).catch(() => ({ error: 'Could not load Apple App Store metadata.' })) : Promise.resolve(null),
    googlePlayId ? fetchGooglePlayMetadata(googlePlayId).then((data) => ({ data })).catch(() => ({ error: 'Could not load Google Play metadata.' })) : Promise.resolve(null)
  ]);

  if (appleResult && 'error' in appleResult) errors.appleStore = appleResult.error;
  if (googleResult && 'error' in googleResult) errors.googlePlay = googleResult.error;
  const apple = appleResult && 'data' in appleResult ? appleResult.data : null;
  const googlePlay = googleResult && 'data' in googleResult ? googleResult.data : null;

  const ratings = [apple?.averageUserRating, googlePlay?.averageUserRating]
    .filter((value): value is number => typeof value === 'number');
  const counts = [apple?.userRatingCount, googlePlay?.userRatingCount]
    .filter((value): value is number => typeof value === 'number');

  return {
    ...app,
    averageUserRating: ratings.length ? Math.max(...ratings) : null,
    reviewCount: counts.length ? Math.round(counts.reduce((sum, count) => sum + count, 0) / counts.length) : null,
    errors
  };
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const apps = typeof payload === 'object' && payload !== null && 'apps' in payload
    ? (payload as { apps?: unknown }).apps
    : undefined;
  if (!Array.isArray(apps) || apps.length < 1 || apps.length > 10) {
    return NextResponse.json({ error: 'apps must contain between 1 and 10 app listings.' }, { status: 400 });
  }

  const validatedApps: AppInput[] = [];
  for (const [index, candidate] of apps.entries()) {
    if (typeof candidate !== 'object' || candidate === null) {
      return NextResponse.json({ error: `apps[${index}] must be an object.` }, { status: 400 });
    }
    const item = candidate as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const appSummary = typeof item.appSummary === 'string' ? item.appSummary.trim() : '';
    const appleAppStoreUrl = item.appleAppStoreUrl;
    const googlePlayUrl = item.googlePlayUrl;

    if (!name) return NextResponse.json({ error: `apps[${index}].name is required.` }, { status: 400 });
    if (!appSummary || appSummary.split(/\s+/).length > 5) {
      return NextResponse.json({ error: `apps[${index}].appSummary must be a short phrase of 1 to 5 words.` }, { status: 400 });
    }
    if (appleAppStoreUrl !== null && typeof appleAppStoreUrl !== 'string') {
      return NextResponse.json({ error: `apps[${index}].appleAppStoreUrl must be a URL or null.` }, { status: 400 });
    }
    if (googlePlayUrl !== null && typeof googlePlayUrl !== 'string') {
      return NextResponse.json({ error: `apps[${index}].googlePlayUrl must be a URL or null.` }, { status: 400 });
    }

    const appleUrl = appleAppStoreUrl as string | null;
    const googleUrl = googlePlayUrl as string | null;
    if (appleUrl && !getAppleId(appleUrl)) {
      return NextResponse.json({ error: `apps[${index}].appleAppStoreUrl must be an Apple listing URL with an iTunes ID.` }, { status: 400 });
    }
    if (googleUrl && !getGooglePlayId(googleUrl)) {
      return NextResponse.json({ error: `apps[${index}].googlePlayUrl must be a Google Play listing URL with a package ID.` }, { status: 400 });
    }
    if (!appleUrl && !googleUrl) {
      return NextResponse.json({ error: `apps[${index}] must include at least one store listing URL.` }, { status: 400 });
    }

    validatedApps.push({ name, appSummary, appleAppStoreUrl: appleUrl, googlePlayUrl: googleUrl });
  }

  const results = await Promise.all(validatedApps.map(loadAppMetadata));
  return NextResponse.json({ apps: results });
}
