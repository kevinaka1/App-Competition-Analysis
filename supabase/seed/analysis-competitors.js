const mockData = require('../../mockData/market-fixtures.json');
const { requireUuidByMockId, upsertAndReturnIds } = require('./lib.js');

async function seedAnalysisCompetitors(supabase, analysisUuidByMockId) {
  const mockCompetitors = mockData.analysisCompetitors.map(app => ({
    mock_id: app.mockId,
    mock_analysis_id: app.mockAnalysisId,
    app_name: app.appName,
    app_summary: app.appSummary,
    app_url: app.appUrl,
    rating: app.rating,
    match_percent: app.matchPercent
  }));
  const competitors = mockCompetitors.map(({ mock_analysis_id, ...app }) => ({
    ...app,
    analysis_id: requireUuidByMockId(analysisUuidByMockId, mock_analysis_id, 'mock_analysis_id')
  }));
  return upsertAndReturnIds(supabase, 'analysis_competitors', competitors);
}

module.exports = { seedAnalysisCompetitors };
