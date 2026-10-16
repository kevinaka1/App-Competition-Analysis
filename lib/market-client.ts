import type { HistoryEntry, MarketSnapshot, MarketUser, Sentiment } from '@/types/market';

export interface SimilarAppResult {
  name: string;
  appSummary: string;
  appleAppStoreUrl: string | null;
  googlePlayUrl: string | null;
}

export interface SimilarAppsResponse {
  suggestedAppName: string;
  apps: SimilarAppResult[];
}

export interface AppMetadataResult extends SimilarAppResult {
  averageUserRating: number | null;
  reviewCount: number | null;
  errors: Partial<Record<'appleStore' | 'googlePlay', string>>;
}

export interface AppReviewsResult extends SimilarAppResult {
  reviews: Record<Sentiment, Array<{ id: string; score: number; title: string | null; text: string; createdAt: string | null }>>;
  errors: Partial<Record<'appleStore' | 'googlePlay', string>>;
}

export interface ReviewCluster {
  clusterId: number;
  summary: string;
  exampleReview: string;
  mentions: number;
}

export interface CreateAnalysisInput {
  userId: string;
  ideaId?: string;
  description: string;
  suggestedAppName: string;
  apps: AppMetadataResult[];
  reviewThemesByApp: Array<{ appIndex: number; groups: Record<Sentiment, ReviewCluster[]> }>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The API request failed.');
  return body as T;
}

export const marketApi = {
  async listUsers(): Promise<MarketUser[]> {
    return (await request<{ users: MarketUser[] }>('/api/users')).users;
  },
  async listHistory(userId: string): Promise<HistoryEntry[]> {
    const query = new URLSearchParams({ userId });
    return (await request<{ history: HistoryEntry[] }>(`/api/history?${query}`)).history;
  },
  async getSnapshot(analysisId: string): Promise<MarketSnapshot | null> {
    const query = new URLSearchParams({ analysisId });
    return (await request<{ snapshot: MarketSnapshot }>(`/api/snapshot?${query}`)).snapshot;
  },
  async findSimilarApps(appDescription: string): Promise<SimilarAppsResponse> {
    return request<SimilarAppsResponse>('/api/similar-apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appDescription })
    });
  },
  async getAppMetadata(apps: SimilarAppResult[]): Promise<AppMetadataResult[]> {
    const result = await request<{ apps: AppMetadataResult[] }>('/api/app-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apps })
    });
    return result.apps;
  },
  async getReviews(apps: SimilarAppResult[]): Promise<AppReviewsResult[]> {
    const result = await request<{ apps: AppReviewsResult[] }>('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apps })
    });
    return result.apps;
  },
  async clusterReviews(apps: AppReviewsResult[]): Promise<Array<{ appIndex: number; groups: Record<Sentiment, ReviewCluster[]> }>> {
    const result = await request<{ apps: Array<{ appIndex: number; groups: Record<Sentiment, ReviewCluster[]> }> }>('/api/cluster-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apps: apps.map((app, appIndex) => ({
          appIndex,
          reviews: Object.fromEntries(Object.entries(app.reviews).map(([sentiment, reviews]) => [
            sentiment,
            reviews.map((review) => [review.title, review.text].filter(Boolean).join('\n'))
          ]))
        })),
        clustersPerSentiment: 5
      })
    });
    return result.apps;
  },
  async createAnalysis(input: CreateAnalysisInput): Promise<{ ideaId: string; analysisId: string }> {
    return request<{ ideaId: string; analysisId: string }>('/api/analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
  }
};
