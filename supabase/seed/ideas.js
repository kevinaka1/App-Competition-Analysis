const mockData = require('../../mockData/market-fixtures.json');
const { requireUuidByMockId, upsertAndReturnIds } = require('./lib.js');

async function seedIdeas(supabase, userUuidByMockId) {
  const mockIdeas = mockData.ideas.map(idea => ({
    mock_id: idea.mockId,
    mock_user_id: idea.mockUserId,
    name: idea.name,
    description: idea.description,
    created_at: idea.createdAt
  }));
  const ideas = mockIdeas.map(({ mock_user_id, ...idea }) => ({
    ...idea,
    user_id: requireUuidByMockId(userUuidByMockId, mock_user_id, 'mock_user_id')
  }));
  return upsertAndReturnIds(supabase, 'ideas', ideas);
}

module.exports = { seedIdeas };
