const mockData = require('../../mockData/market-fixtures.json');
const { requireUuidByMockId, upsertAndReturnIds } = require('./lib.js');

async function seedReviewThemes(supabase, analysisUuidByMockId, competitorUuidByMockId) {
  const mockThemes = mockData.reviewThemes.map(theme => ({
    mock_id: theme.mockId,
    mock_analysis_id: theme.mockAnalysisId,
    mock_analysis_competitor_id: theme.mockAnalysisCompetitorId || null,
    sentiment: theme.sentiment,
    summary: theme.summary,
    example_review: theme.exampleReview,
    mentions: theme.mentions
  }));
  const themes = mockThemes.map(({ mock_analysis_id, mock_analysis_competitor_id, ...theme }) => ({
    ...theme,
    analysis_id: requireUuidByMockId(analysisUuidByMockId, mock_analysis_id, 'mock_analysis_id'),
    analysis_competitor_id: mock_analysis_competitor_id
      ? requireUuidByMockId(competitorUuidByMockId, mock_analysis_competitor_id, 'mock_analysis_competitor_id')
      : null
  }));
  const themeUuidByMockId = await upsertAndReturnIds(supabase, 'review_themes', themes);
  const retainedMockIds = new Set(themes.map(theme => theme.mock_id));
  const { data: existingSeedRows, error: lookupError } = await supabase
    .from('review_themes')
    .select('id,mock_id')
    .not('mock_id', 'is', null);
  if (lookupError) throw new Error(`Failed to look up previous mock review themes: ${lookupError.message}`);

  const obsoleteIds = existingSeedRows
    .filter(row => row.mock_id.startsWith('theme_') && !retainedMockIds.has(row.mock_id))
    .map(row => row.id);
  if (obsoleteIds.length) {
    const { error } = await supabase.from('review_themes').delete().in('id', obsoleteIds);
    if (error) throw new Error(`Failed to remove obsolete mock review themes: ${error.message}`);
  }

  return themeUuidByMockId;
}

module.exports = { seedReviewThemes };
