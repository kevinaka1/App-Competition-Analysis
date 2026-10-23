import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
import { getAuthenticatedProfile } from '@/lib/auth';
import type { ClusterReview } from '@/lib/reviews/centroids';

export const dynamic = 'force-dynamic';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CompetitorInput = {
  name: string;
  appSummary: string;
  appleAppStoreUrl: string | null;
  googlePlayUrl: string | null;
  averageUserRating: number | null;
  reviewCount: number | null;
};

type Sentiment = 'negative' | 'average' | 'positive';
type ReviewThemeInput = { summary: string; exampleReview: string; mentions: number; reviews: ClusterReview[] };
type AppReviewThemesInput = { appIndex: number; groups: Record<Sentiment, ReviewThemeInput[]> };
const SENTIMENTS: Sentiment[] = ['negative', 'average', 'positive'];

function isAppleListing(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'apps.apple.com' && /\/id\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

function isGooglePlayListing(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'play.google.com' && url.pathname === '/store/apps/details' && Boolean(url.searchParams.get('id'));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (typeof payload !== 'object' || payload === null) {
    return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const auth = await getAuthenticatedProfile().catch((error) => {
    console.error('Could not resolve the signed-in user.', error);
    return null;
  });
  if (!auth) return NextResponse.json({ error: 'You must sign in to continue.' }, { status: 401 });
  const userId = auth.profile.id;
  const existingIdeaId = typeof body.ideaId === 'string' ? body.ideaId.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const suggestedAppName = typeof body.suggestedAppName === 'string' ? body.suggestedAppName.trim() : '';
  if (existingIdeaId && !uuidPattern.test(existingIdeaId)) return NextResponse.json({ error: 'ideaId must be a valid UUID.' }, { status: 400 });
  if (description.length < 15 || description.length > 500) {
    return NextResponse.json({ error: 'description must be between 15 and 500 characters.' }, { status: 400 });
  }
  if (!suggestedAppName || suggestedAppName.length > 100) {
    return NextResponse.json({ error: 'A suggested app name of 1 to 100 characters is required.' }, { status: 400 });
  }
  if (!Array.isArray(body.apps) || body.apps.length < 1 || body.apps.length > 10) {
    return NextResponse.json({ error: 'apps must contain between 1 and 10 competitors.' }, { status: 400 });
  }

  if (!Array.isArray(body.reviewThemesByApp) || body.reviewThemesByApp.length !== body.apps.length) {
    return NextResponse.json({ error: 'reviewThemesByApp must provide one set of sentiment themes for each app.' }, { status: 400 });
  }
  const normalizedReviewThemesByApp: AppReviewThemesInput[] = [];
  for (const [appIndex, item] of body.reviewThemesByApp.entries()) {
    if (typeof item !== 'object' || item === null) {
      return NextResponse.json({ error: `reviewThemesByApp[${appIndex}] must be an object.` }, { status: 400 });
    }
    const appThemes = item as Record<string, unknown>;
    if (appThemes.appIndex !== appIndex || typeof appThemes.groups !== 'object' || appThemes.groups === null) {
      return NextResponse.json({ error: `reviewThemesByApp[${appIndex}] must include appIndex ${appIndex} and its sentiment groups.` }, { status: 400 });
    }
    const groups = appThemes.groups as Record<string, unknown>;
    const normalizedGroups = {} as Record<Sentiment, ReviewThemeInput[]>;
    for (const sentiment of SENTIMENTS) {
      const themes = groups[sentiment];
      if (!Array.isArray(themes) || themes.length < 3 || themes.length > 10) {
        return NextResponse.json({ error: `reviewThemesByApp[${appIndex}].groups.${sentiment} must contain between 3 and 10 themes.` }, { status: 400 });
      }
      const normalized: ReviewThemeInput[] = [];
      for (const [themeIndex, themeValue] of themes.entries()) {
        if (typeof themeValue !== 'object' || themeValue === null) {
          return NextResponse.json({ error: `reviewThemesByApp[${appIndex}].groups.${sentiment}[${themeIndex}] must be an object.` }, { status: 400 });
        }
        const theme = themeValue as Record<string, unknown>;
        const summary = typeof theme.summary === 'string' ? theme.summary.trim() : '';
        const exampleReview = typeof theme.exampleReview === 'string' ? theme.exampleReview.trim() : '';
        const mentions = theme.mentions;
        const reviews = theme.reviews;
        if (!summary || summary.split(/\s+/).length > 5 || !exampleReview || exampleReview.length > 5_000) {
          return NextResponse.json({ error: `reviewThemesByApp[${appIndex}].groups.${sentiment}[${themeIndex}] requires a theme phrase of at most 5 words and an example review.` }, { status: 400 });
        }
        if (!Number.isSafeInteger(mentions) || (mentions as number) < 1) {
          return NextResponse.json({ error: `reviewThemesByApp[${appIndex}].groups.${sentiment}[${themeIndex}].mentions must be a positive integer.` }, { status: 400 });
        }
        if (!Array.isArray(reviews) || reviews.length > 50 || reviews.some((review) =>
          typeof review !== 'object' || review === null ||
          typeof review.id !== 'string' || review.id.length > 500 ||
          (review.store !== 'appleStore' && review.store !== 'googlePlay') ||
          typeof review.score !== 'number' || !Number.isFinite(review.score) || review.score < 0.5 || review.score > 5 ||
          (review.title !== null && (typeof review.title !== 'string' || review.title.length > 5_000)) ||
          typeof review.text !== 'string' || !review.text.trim() || review.text.length > 5_000 ||
          (review.createdAt !== null && (typeof review.createdAt !== 'string' || !Number.isFinite(Date.parse(review.createdAt))))
        )) {
          return NextResponse.json({ error: `reviewThemesByApp[${appIndex}].groups.${sentiment}[${themeIndex}].reviews must contain at most 50 valid reviews.` }, { status: 400 });
        }
        normalized.push({ summary, exampleReview, mentions: mentions as number, reviews: reviews as ClusterReview[] });
      }
      normalizedGroups[sentiment] = normalized;
    }
    normalizedReviewThemesByApp.push({ appIndex, groups: normalizedGroups });
  }

  const apps: CompetitorInput[] = [];
  for (const [index, item] of body.apps.entries()) {
    if (typeof item !== 'object' || item === null) {
      return NextResponse.json({ error: `apps[${index}] must be an object.` }, { status: 400 });
    }
    const app = item as Record<string, unknown>;
    const name = typeof app.name === 'string' ? app.name.trim() : '';
    const appSummary = typeof app.appSummary === 'string' ? app.appSummary.trim() : '';
    const appleAppStoreUrl = app.appleAppStoreUrl;
    const googlePlayUrl = app.googlePlayUrl;
    const rating = app.averageUserRating;
    const reviewCount = app.reviewCount;
    if (!name || !appSummary) return NextResponse.json({ error: `apps[${index}] requires a name and appSummary.` }, { status: 400 });
    if (appleAppStoreUrl !== null && !isAppleListing(appleAppStoreUrl)) {
      return NextResponse.json({ error: `apps[${index}].appleAppStoreUrl must be an Apple App Store URL or null.` }, { status: 400 });
    }
    if (googlePlayUrl !== null && !isGooglePlayListing(googlePlayUrl)) {
      return NextResponse.json({ error: `apps[${index}].googlePlayUrl must be a Google Play URL or null.` }, { status: 400 });
    }
    if (!appleAppStoreUrl && !googlePlayUrl) {
      return NextResponse.json({ error: `apps[${index}] must have at least one store URL.` }, { status: 400 });
    }
    if (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0 || rating > 5) {
      return NextResponse.json({ error: `apps[${index}].averageUserRating must be greater than 0 and at most 5.` }, { status: 400 });
    }
    if (reviewCount !== null && (!Number.isSafeInteger(reviewCount) || (reviewCount as number) < 0)) {
      return NextResponse.json({ error: `apps[${index}].reviewCount must be a non-negative integer or null.` }, { status: 400 });
    }
    apps.push({
      name,
      appSummary,
      appleAppStoreUrl: appleAppStoreUrl as string | null,
      googlePlayUrl: googlePlayUrl as string | null,
      averageUserRating: rating as number | null,
      reviewCount: reviewCount as number | null
    });
  }

  const supabase = getSupabase();
  const { data: user, error: userError } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
  if (userError) {
    console.error('Could not verify the selected user for a new analysis.', userError);
    return NextResponse.json({ error: 'Could not verify the selected user.' }, { status: 500 });
  }
  if (!user) return NextResponse.json({ error: 'The selected user was not found.' }, { status: 404 });

  let ideaId: string | null = existingIdeaId || null;
  let createdNewIdea = false;
  if (ideaId) {
    const { data: existingIdea, error: existingIdeaError } = await supabase.from('ideas')
      .select('id').eq('id', ideaId).eq('user_id', userId).maybeSingle();
    if (existingIdeaError) {
      console.error('Could not verify the selected idea for re-analysis.', existingIdeaError);
      return NextResponse.json({ error: 'Could not verify the selected idea.' }, { status: 500 });
    }
    if (!existingIdea) return NextResponse.json({ error: 'The selected idea was not found for this user.' }, { status: 404 });
  }

  let analysisId: string | null = null;
  try {
    if (!ideaId) {
      const { data: idea, error: ideaError } = await supabase.from('ideas').insert({
        user_id: userId,
        name: suggestedAppName,
        description
      }).select('id').single();
      if (ideaError) throw ideaError;
      ideaId = idea.id;
      createdNewIdea = true;
    }

    const reviewCountTotal = normalizedReviewThemesByApp.flatMap(({ groups }) => SENTIMENTS.flatMap((sentiment) => groups[sentiment]))
      .reduce((total, theme) => total + theme.mentions, 0);
    const { data: analysis, error: analysisError } = await supabase.from('analyses').insert({
      idea_id: ideaId,
      similar_app_count: apps.length,
      reviews_scanned_count: Math.min(reviewCountTotal, 2_147_483_647),
      sentiment_group_count: SENTIMENTS.filter((sentiment) => normalizedReviewThemesByApp.some(({ groups }) => groups[sentiment].length > 0)).length
    }).select('id').single();
    if (analysisError) throw analysisError;
    analysisId = analysis.id;

    const competitorResults = await Promise.all(apps.map((app) => supabase.from('analysis_competitors').insert({
      analysis_id: analysis.id,
      app_name: app.name,
      app_summary: app.appSummary,
      app_url: app.appleAppStoreUrl ?? app.googlePlayUrl,
      rating: app.averageUserRating
    }).select('id').single()));
    const competitorIds = competitorResults.map(({ data, error }) => {
      if (error) throw error;
      if (!data) throw new Error('A competitor row was inserted without returning its ID.');
      return data.id as string;
    });

    const reviewRows: Array<Record<string, unknown>> = [];
    const themeRows = normalizedReviewThemesByApp.flatMap(({ appIndex, groups }) => SENTIMENTS.flatMap((sentiment) => groups[sentiment].map((theme) => {
      const themeId = randomUUID();
      theme.reviews.slice(0, 50).forEach((review, index) => reviewRows.push({
        review_theme_id: themeId,
        source_review_id: review.id,
        store: review.store,
        score: review.score,
        title: review.title,
        body: review.text,
        reviewed_at: review.createdAt,
        position: index + 1
      }));
      return {
        id: themeId,
        analysis_id: analysis.id,
        analysis_competitor_id: competitorIds[appIndex],
        sentiment,
        summary: theme.summary,
        example_review: theme.exampleReview,
        mentions: theme.mentions
      };
    })));
    if (themeRows.length) {
      const { error: themesError } = await supabase.from('review_themes').insert(themeRows);
      if (themesError) throw themesError;
    }
    if (reviewRows.length) {
      const { error: reviewsError } = await supabase.from('review_cluster_reviews').insert(reviewRows);
      if (reviewsError) throw reviewsError;
    }

    if (!createdNewIdea) {
      const { error: oldAnalysesError } = await supabase.from('analyses')
        .delete().eq('idea_id', ideaId).neq('id', analysis.id);
      if (oldAnalysesError) throw oldAnalysesError;
    }

    return NextResponse.json({ ideaId, analysisId }, { status: 201 });
  } catch (error) {
    if (createdNewIdea && ideaId) {
      const { error: cleanupError } = await supabase.from('ideas').delete().eq('id', ideaId);
      if (cleanupError) console.error('Could not remove the partial idea after analysis creation failed.', cleanupError);
    } else if (analysisId) {
      const { error: cleanupError } = await supabase.from('analyses').delete().eq('id', analysisId);
      if (cleanupError) console.error('Could not remove the partial re-analysis after competitor creation failed.', cleanupError);
    }
    console.error('Could not save the new market analysis to Supabase.', error);
    return NextResponse.json({ error: 'Could not save this analysis. Please try again.' }, { status: 500 });
  }
}
