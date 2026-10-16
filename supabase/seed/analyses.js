const mockData = require('../../mockData/market-fixtures.json');
const { requireUuidByMockId, upsertAndReturnIds } = require('./lib.js');

async function seedAnalyses(supabase, ideaUuidByMockId) {
  const mockAnalyses = mockData.analyses.map(analysis => ({
    mock_id: analysis.mockId,
    mock_idea_id: analysis.mockIdeaId,
    similar_app_count: analysis.similarAppCount,
    reviews_scanned_count: analysis.reviewsScannedCount,
    sentiment_group_count: analysis.sentimentGroupCount,
    created_at: analysis.createdAt
  }));
  const analyses = mockAnalyses.map(({ mock_idea_id, ...analysis }) => ({
    ...analysis,
    idea_id: requireUuidByMockId(ideaUuidByMockId, mock_idea_id, 'mock_idea_id')
  }));
  return upsertAndReturnIds(supabase, 'analyses', analyses);
}

module.exports = { seedAnalyses };
