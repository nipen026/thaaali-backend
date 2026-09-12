// The single place that knows which AI provider is active. Every feature in services/ai/
// calls withAI({ mock, live }) exactly once — swapping providers later means writing the
// `live` half per feature and flipping AI_PROVIDER, never touching routes or the frontend.
const AI_PROVIDER = process.env.AI_PROVIDER || 'mock';

async function withAI({ mock, live }) {
  if (AI_PROVIDER !== 'anthropic') {
    return { ...(await mock()), provider: 'mock' };
  }
  try {
    return { ...(await live()), provider: 'anthropic' };
  } catch (err) {
    console.error('[ai] live call failed, falling back to mock:', err.message);
    return { ...(await mock()), provider: 'mock', fallback: true };
  }
}

module.exports = { AI_PROVIDER, withAI };
