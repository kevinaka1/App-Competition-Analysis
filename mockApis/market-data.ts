import marketFixtures from '@/mockData/market-fixtures.json';
import type { HistoryEntry, MarketFixtures, MarketSnapshot, MarketUser, ReviewTheme, Sentiment } from '@/types/market';

const mockDatabase = marketFixtures as MarketFixtures;

function inferCategory(description: string): string {
  if (/meal|food|recipe|cook|fridge|grocery|diet|nutrition/i.test(description)) return 'meal';
  if (/budget|money|finance|spend|bank|saving/i.test(description)) return 'budget';
  if (/fitness|workout|run|exercise|gym|training/i.test(description)) return 'fitness';
  return 'general';
}

function reviewCountLabel(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(count);
}

function findIdea(id: string) {
  return mockDatabase.ideas.find((idea) => idea.mockId === id);
}

function toSnapshot(analysis: MarketFixtures['analyses'][number], override?: { userId: string; description: string }): MarketSnapshot | null {
  const storedIdea = findIdea(analysis.mockIdeaId);
  if (!storedIdea) return null;

  const themeRows = mockDatabase.reviewThemes
    .filter((row) => row.mockAnalysisId === analysis.mockId && row.mockAnalysisCompetitorId)
    .sort((a, b) => b.mentions - a.mentions);
  const hasUnassignedReviewThemes = mockDatabase.reviewThemes.some((row) => row.mockAnalysisId === analysis.mockId && !row.mockAnalysisCompetitorId);
  const competitors = mockDatabase.analysisCompetitors
    .filter((row) => row.mockAnalysisId === analysis.mockId)
    .map((row) => {
      const reviewThemes: Record<Sentiment, ReviewTheme[]> = { positive: [], average: [], negative: [] };
      themeRows.filter((theme) => theme.mockAnalysisCompetitorId === row.mockId)
        .forEach((theme) => reviewThemes[theme.sentiment].push({ id: theme.mockId, name: theme.summary, example: theme.exampleReview, mentions: theme.mentions }));
      return { id: row.mockId, name: row.appName, appSummary: row.appSummary, url: row.appUrl, rating: row.rating, similarityPercent: row.matchPercent, reviewThemes };
    });

  return {
    idea: {
      id: storedIdea.mockId,
      userId: override?.userId ?? storedIdea.mockUserId,
      name: override ? override.description.slice(0, 52) : storedIdea.name,
      description: override?.description ?? storedIdea.description,
      createdAt: storedIdea.createdAt
    },
    analysis: {
      id: analysis.mockId,
      ideaId: analysis.mockIdeaId,
      similarAppCount: analysis.similarAppCount,
      reviewsScannedCount: analysis.reviewsScannedCount,
      sentimentGroupCount: analysis.sentimentGroupCount,
      createdAt: analysis.createdAt
    },
    competitors,
    hasUnassignedReviewThemes,
    summary: {
      similarAppCount: analysis.similarAppCount,
      reviewsScannedCount: analysis.reviewsScannedCount,
      reviewCountLabel: reviewCountLabel(analysis.reviewsScannedCount),
      sentimentGroupCount: analysis.sentimentGroupCount
    },
    isDemo: true
  };
}

export const marketData = {
  async listUsers(): Promise<MarketUser[]> {
    return mockDatabase.users.map((user) => ({ id: user.mockId, name: user.name, email: user.email, initials: user.initials }));
  },

  async listHistory(userId: string): Promise<HistoryEntry[]> {
    const ideaIds = new Set(mockDatabase.ideas.filter((idea) => idea.mockUserId === userId).map((idea) => idea.mockId));
    return mockDatabase.analyses
      .filter((analysis) => ideaIds.has(analysis.mockIdeaId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((analysis) => {
        const idea = findIdea(analysis.mockIdeaId);
        return idea ? [{ analysisId: analysis.mockId, ideaId: idea.mockId, name: idea.name, description: idea.description, createdAt: analysis.createdAt }] : [];
      });
  },

  async getSnapshot(analysisId: string): Promise<MarketSnapshot | null> {
    const analysis = mockDatabase.analyses.find((row) => row.mockId === analysisId);
    return analysis ? toSnapshot(analysis) : null;
  },

  async getSampleAnalysis(userId: string, description: string): Promise<MarketSnapshot> {
    const category = inferCategory(description);
    const analysis = mockDatabase.analyses.find((row) => {
      const idea = findIdea(row.mockIdeaId);
      return idea && inferCategory(idea.description) === category;
    }) ?? mockDatabase.analyses[0];
    if (!analysis) throw new Error('No sample analysis is available for the demo.');
    const snapshot = toSnapshot(analysis, { userId, description });
    if (!snapshot) throw new Error('The sample analysis has no linked idea.');
    return snapshot;
  }
};
