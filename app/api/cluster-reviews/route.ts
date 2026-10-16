import { NextRequest, NextResponse } from 'next/server';
import { clusterReviews, summarizeReviewClusters, type ReviewClusterTheme } from '@/lib/reviews/centroids';
import type { Sentiment } from '@/types/market';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SENTIMENTS: Sentiment[] = ['negative', 'average', 'positive'];
const MAX_REVIEWS_PER_SENTIMENT = 500;
const MAX_REVIEW_LENGTH = 5_000;

type AppReviewInput = { appIndex: number; reviews: Record<Sentiment, string[]> };

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

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (typeof payload !== 'object' || payload === null || !('apps' in payload)) {
    return NextResponse.json({ error: 'apps must contain each app and its negative, average, and positive reviews.' }, { status: 400 });
  }

  const body = payload as { apps?: unknown; clustersPerSentiment?: unknown };
  if (!Array.isArray(body.apps) || body.apps.length < 1 || body.apps.length > 10) {
    return NextResponse.json({ error: 'apps must contain between 1 and 10 review sets.' }, { status: 400 });
  }

  const clustersPerSentiment = body.clustersPerSentiment ?? 5;
  if (!Number.isInteger(clustersPerSentiment) || (clustersPerSentiment as number) < 1 || (clustersPerSentiment as number) > 10) {
    return NextResponse.json({ error: 'clustersPerSentiment must be an integer from 1 to 10.' }, { status: 400 });
  }

  const apps: AppReviewInput[] = [];
  for (const [index, item] of body.apps.entries()) {
    if (typeof item !== 'object' || item === null) {
      return NextResponse.json({ error: `apps[${index}] must be an object.` }, { status: 400 });
    }
    const app = item as Record<string, unknown>;
    if (app.appIndex !== index || typeof app.reviews !== 'object' || app.reviews === null) {
      return NextResponse.json({ error: `apps[${index}] must include appIndex ${index} and its reviews.` }, { status: 400 });
    }
    const reviews = app.reviews as Record<string, unknown>;
    for (const sentiment of SENTIMENTS) {
      const group = reviews[sentiment];
      if (!Array.isArray(group) || group.length > MAX_REVIEWS_PER_SENTIMENT || group.some((text) => typeof text !== 'string' || text.length > MAX_REVIEW_LENGTH)) {
        return NextResponse.json({
          error: `apps[${index}].reviews.${sentiment} must be an array of at most ${MAX_REVIEWS_PER_SENTIMENT} strings, each at most ${MAX_REVIEW_LENGTH} characters.`
        }, { status: 400 });
      }
    }
    apps.push({ appIndex: index, reviews: reviews as Record<Sentiment, string[]> });
  }

  try {
    // Keep each app independent and limit concurrent embedding/summary work.
    const result = await mapWithConcurrency(apps, 2, async ({ appIndex, reviews }) => {
      const clusterGroups = await Promise.all(SENTIMENTS.map((sentiment) =>
        clusterReviews(reviews[sentiment], sentiment, clustersPerSentiment as number, appIndex)
      ));
      const summaries = await summarizeReviewClusters(clusterGroups.flat());
      const groups = Object.fromEntries(SENTIMENTS.map((sentiment, index) => [
        sentiment,
        clusterGroups[index].map((cluster) => summaries[`${appIndex}:${sentiment}:${cluster.clusterId}`])
      ])) as Record<Sentiment, ReviewClusterTheme[]>;
      return { appIndex, groups };
    });

    return NextResponse.json({ apps: result, clustersPerSentiment });
  } catch (error) {
    console.error('Could not embed, cluster, and summarize reviews by app.', error);
    return NextResponse.json({ error: 'Could not cluster and summarize reviews. Check the OpenAI API key and try again.' }, { status: 502 });
  }
}
