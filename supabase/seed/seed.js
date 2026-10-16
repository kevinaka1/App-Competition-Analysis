const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const { seedUsers } = require('./users.js');
const { seedIdeas } = require('./ideas.js');
const { seedAnalyses } = require('./analyses.js');
const { seedAnalysisCompetitors } = require('./analysis-competitors.js');
const { seedReviewThemes } = require('./review-themes.js');

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY before running the seed. The legacy SUPABASE_SERVICE_ROLE_KEY is also accepted.');
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });

  const userUuidByMockId = await seedUsers(supabase);
  const ideaUuidByMockId = await seedIdeas(supabase, userUuidByMockId);
  const analysisUuidByMockId = await seedAnalyses(supabase, ideaUuidByMockId);
  const competitorUuidByMockId = await seedAnalysisCompetitors(supabase, analysisUuidByMockId);
  const reviewThemeUuidByMockId = await seedReviewThemes(supabase, analysisUuidByMockId, competitorUuidByMockId);

  console.log('Supabase mock seed completed.');
  console.log(`Users: ${userUuidByMockId.size}; ideas: ${ideaUuidByMockId.size}; analyses: ${analysisUuidByMockId.size}; competitors: ${competitorUuidByMockId.size}; review themes: ${reviewThemeUuidByMockId.size}.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
