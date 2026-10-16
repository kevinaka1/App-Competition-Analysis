export type Sentiment = 'positive' | 'average' | 'negative';

export interface MarketUser {
  id: string;
  name: string;
  email: string;
  initials: string;
}

export interface HistoryEntry {
  analysisId: string;
  ideaId: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface ReviewTheme {
  id: string;
  name: string;
  example: string;
  mentions: number;
}

export interface Competitor {
  id: string;
  name: string;
  appSummary: string;
  url: string | null;
  rating: number | null;
  similarityPercent: number | null;
  reviewThemes: Record<Sentiment, ReviewTheme[]>;
}

export interface MarketSnapshot {
  idea: {
    id: string;
    userId: string;
    name: string;
    description: string;
    createdAt: string;
  };
  analysis: {
    id: string;
    ideaId: string;
    similarAppCount: number;
    reviewsScannedCount: number;
    sentimentGroupCount: number;
    createdAt: string;
  };
  competitors: Competitor[];
  hasUnassignedReviewThemes: boolean;
  summary: {
    similarAppCount: number;
    reviewsScannedCount: number;
    reviewCountLabel: string;
    sentimentGroupCount: number;
  };
  isDemo: boolean;
}

export interface MarketFixtures {
  users: Array<{ mockId: string; name: string; email: string; initials: string }>;
  ideas: Array<{ mockId: string; mockUserId: string; name: string; description: string; createdAt: string }>;
  analyses: Array<{ mockId: string; mockIdeaId: string; similarAppCount: number; reviewsScannedCount: number; sentimentGroupCount: number; createdAt: string }>;
  analysisCompetitors: Array<{ mockId: string; mockAnalysisId: string; appName: string; appSummary: string; appUrl: string; rating: number; matchPercent: number }>;
  reviewThemes: Array<{ mockId: string; mockAnalysisId: string; mockAnalysisCompetitorId: string; sentiment: Sentiment; summary: string; exampleReview: string; mentions: number }>;
}
