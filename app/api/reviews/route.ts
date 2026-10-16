import { NextRequest, NextResponse } from 'next/server';
import gplay, { type Review as GooglePlayReview } from '@mradex77/google-play-scraper';
import { reviews as appleStoreReviews, sort as appleStoreSort, type Review as AppleStoreReview } from '@perttu/app-store-scraper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const REVIEW_LIMIT = 50;
const APPLE_MAX_PAGES = 10;
const GOOGLE_SCORES = [1, 2, 3, 4, 5] as const;
const SENTIMENTS = ['negative', 'average', 'positive'] as const;
type Sentiment = (typeof SENTIMENTS)[number];
type Store = 'appleStore' | 'googlePlay';

type AppInput = {
  name: string;
  appleAppStoreUrl: string | null;
  googlePlayUrl: string | null;
};

type Review = {
  id: string;
  score: number;
  title: string | null;
  text: string;
  createdAt: string | null;
};

type ScrapedReview = Review & { store: Store };
type ReviewGroups = Record<Sentiment, ScrapedReview[]>;
type ResponseReviewGroups = Record<Sentiment, Review[]>;
type AppReviewResult = AppInput & {
  reviews: ResponseReviewGroups;
  errors: Partial<Record<Store, string>>;
};

function appleIdFromUrl(value: string): number | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'apps.apple.com') return null;
    const id = url.pathname.match(/\/id(\d+)(?:\/|$)/)?.[1];
    return id ? Number(id) : null;
  } catch {
    return null;
  }
}

function googlePlayIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'play.google.com' || url.pathname !== '/store/apps/details') return null;
    const id = url.searchParams.get('id');
    console.log(id)
    return id && /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function sentimentForScore(score: number): Sentiment | null {
  if (!Number.isFinite(score) || score < 0.5 || score > 5) return null;
  if (score < 2.5) return 'negative';
  if (score < 4) return 'average';
  if (score >= 4) return 'positive';
  return null;
}

function emptyGroups(): ReviewGroups {
  return { negative: [], average: [], positive: [] };
}

function normalizeAppleReview(review: AppleStoreReview): ScrapedReview | null {
  const text = [review.title, review.text].filter(Boolean).join('\n').trim();
  if (!text || !sentimentForScore(review.score)) return null;
  return {
    id: review.id,
    store: 'appleStore',
    score: review.score,
    title: review.title || null,
    text,
    createdAt: review.updated || null
  };
}

function normalizeGoogleReview(review: GooglePlayReview): ScrapedReview | null {
  const text = [review.title, review.text].filter(Boolean).join('\n').trim();
  if (!text || !sentimentForScore(review.score)) return null;
  return {
    id: review.id,
    store: 'googlePlay',
    score: review.score,
    title: review.title || null,
    text,
    createdAt: review.date || null
  };
}

function stripReviewMetadata(groups: ReviewGroups): ResponseReviewGroups {
  return Object.fromEntries(SENTIMENTS.map((sentiment) => [
    sentiment,
    groups[sentiment].map(({ id, score, title, text, createdAt }) => ({ id, score, title, text, createdAt }))
  ])) as ResponseReviewGroups;
}

function addReview(groups: ReviewGroups, review: ScrapedReview, seenIds: Set<string>) {
  const sentiment = sentimentForScore(review.score);
  if (!sentiment || groups[sentiment].length >= REVIEW_LIMIT) return;
  const key = `${review.store}:${review.id}`;
  if (seenIds.has(key)) return;
  seenIds.add(key);
  groups[sentiment].push(review);
}

function allGroupsFull(groups: ReviewGroups): boolean {
  return SENTIMENTS.every((sentiment) => groups[sentiment].length >= REVIEW_LIMIT);
}

async function fetchAppleReviews(appId: number): Promise<ReviewGroups> {
  const groups = emptyGroups();
  const seenIds = new Set<string>();

  for (let page = 1; page <= APPLE_MAX_PAGES; page += 1) {
    const pageReviews = await appleStoreReviews({
      id: appId,
      country: 'us',
      sort: appleStoreSort.RECENT,
      page,
      requestOptions: { timeout: 15_000, retries: 1 }
    });
    if (pageReviews.length === 0) break;

    const before = seenIds.size;
    for (const rawReview of pageReviews) {
      const review = normalizeAppleReview(rawReview);
      if (review) addReview(groups, review, seenIds);
    }
    if (allGroupsFull(groups) || seenIds.size === before) break;
  }
  return groups;
}

async function fetchGoogleReviews(appId: string): Promise<ReviewGroups> {
  const groups = emptyGroups();
  const reviewsByScore = await Promise.all(GOOGLE_SCORES.map(async (score) => gplay.reviewsAll({
    appId,
    score,
    sort: gplay.sort.NEWEST,
    country: 'us',
    lang: 'en',
    maxReviews: REVIEW_LIMIT,
    throttle: 1,
    requestOptions: { timeoutMs: 15_000, retries: 1 }
  })));
  console.log("got here")
  console.log(reviewsByScore)

  const byScore = new Map<number, ScrapedReview[]>();
  GOOGLE_SCORES.forEach((score, index) => {
    byScore.set(score, reviewsByScore[index].map(normalizeGoogleReview).filter((review): review is ScrapedReview => review !== null));
  });

  // Interleave star ratings within each group so a dominant score does not crowd out the others.
  const scoreSets: Record<Sentiment, number[]> = {
    negative: [1, 2],
    average: [3],
    positive: [4, 5]
  };
  for (const sentiment of SENTIMENTS) {
    const lists = scoreSets[sentiment].map((score) => byScore.get(score) ?? []);
    let index = 0;
    while (groups[sentiment].length < REVIEW_LIMIT && lists.some((list) => list.length > index)) {
      for (const list of lists) {
        const review = list[index];
        if (review && groups[sentiment].length < REVIEW_LIMIT) groups[sentiment].push(review);
      }
      index += 1;
    }
  }
  return groups;
}

function combineGroups(apple: ReviewGroups | null, google: ReviewGroups | null): ReviewGroups {
  const combined = emptyGroups();
  for (const sentiment of SENTIMENTS) {
    const appleReviews = apple?.[sentiment] ?? [];
    const googleReviews = google?.[sentiment] ?? [];
    let appleIndex = 0;
    let googleIndex = 0;

    while (combined[sentiment].length < REVIEW_LIMIT && (appleIndex < appleReviews.length || googleIndex < googleReviews.length)) {
      const appleReview = appleReviews[appleIndex++];
      if (appleReview) combined[sentiment].push(appleReview);
      if (combined[sentiment].length >= REVIEW_LIMIT) break;
      const googleReview = googleReviews[googleIndex++];
      if (googleReview) combined[sentiment].push(googleReview);
    }
  }
  return combined;
}

async function mapWithConcurrency<T, U>(items: T[], concurrency: number, mapper: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

async function fetchAppReviews(app: AppInput): Promise<AppReviewResult> {
  const appleId = app.appleAppStoreUrl ? appleIdFromUrl(app.appleAppStoreUrl) : null;
  const googlePlayId = app.googlePlayUrl ? googlePlayIdFromUrl(app.googlePlayUrl) : null;
  const errors: AppReviewResult['errors'] = {};

  const [appleResult, googleResult] = await Promise.all([
    appleId
      ? fetchAppleReviews(appleId).then((reviews) => ({ reviews })).catch(() => ({ error: 'Could not load Apple App Store reviews.' }))
      : Promise.resolve(null),
    googlePlayId
      ? fetchGoogleReviews(googlePlayId).then((reviews) => ({ reviews })).catch(() => ({ error: 'Could not load Google Play reviews.' }))
      : Promise.resolve(null)
  ]);

  if (appleResult && 'error' in appleResult) errors.appleStore = appleResult.error;
  if (googleResult && 'error' in googleResult) errors.googlePlay = googleResult.error;
  const apple = appleResult && 'reviews' in appleResult ? appleResult.reviews : null;
  const google = googleResult && 'reviews' in googleResult ? googleResult.reviews : null;

  return { ...app, reviews: stripReviewMetadata(combineGroups(apple, google)), errors };
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const candidates = typeof payload === 'object' && payload !== null && 'apps' in payload
    ? (payload as { apps?: unknown }).apps
    : undefined;
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 10) {
    return NextResponse.json({ error: 'apps must contain between 1 and 10 app listings.' }, { status: 400 });
  }

  const apps: AppInput[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (typeof candidate !== 'object' || candidate === null) {
      return NextResponse.json({ error: `apps[${index}] must be an object.` }, { status: 400 });
    }
    const app = candidate as Record<string, unknown>;
    const name = typeof app.name === 'string' ? app.name.trim() : '';
    const appleAppStoreUrl = app.appleAppStoreUrl;
    const googlePlayUrl = app.googlePlayUrl;
    if (!name) return NextResponse.json({ error: `apps[${index}].name is required.` }, { status: 400 });
    if (appleAppStoreUrl !== null && (typeof appleAppStoreUrl !== 'string' || !appleIdFromUrl(appleAppStoreUrl))) {
      return NextResponse.json({ error: `apps[${index}].appleAppStoreUrl must be an Apple App Store listing URL or null.` }, { status: 400 });
    }
    if (googlePlayUrl !== null && (typeof googlePlayUrl !== 'string' || !googlePlayIdFromUrl(googlePlayUrl))) {
      return NextResponse.json({ error: `apps[${index}].googlePlayUrl must be a Google Play listing URL or null.` }, { status: 400 });
    }
    if (!appleAppStoreUrl && !googlePlayUrl) {
      return NextResponse.json({ error: `apps[${index}] must have at least one store listing URL.` }, { status: 400 });
    }
    apps.push({ name, appleAppStoreUrl: appleAppStoreUrl as string | null, googlePlayUrl: googlePlayUrl as string | null });
  }

  const results = await mapWithConcurrency(apps, 3, fetchAppReviews);
  console.log('[reviews API]', JSON.stringify({ apps: results, reviewsPerSentiment: REVIEW_LIMIT }, null, 2));
  return NextResponse.json({ apps: results, reviewsPerSentiment: REVIEW_LIMIT });
}
