const mockData = require('../../mockData/market-fixtures.json');
const { upsertAndReturnIds } = require('./lib.js');

async function seedUsers(supabase) {
  const mockUsers = mockData.users.map(user => ({
    mock_id: user.mockId,
    name: user.name,
    email: user.email,
    initials: user.initials
  }));
  return upsertAndReturnIds(supabase, 'users', mockUsers);
}

module.exports = { seedUsers };
