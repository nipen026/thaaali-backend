const { withAI } = require('./client');

// Mock extraction: deliberately ignores the actual uploaded image content (this is a stub,
// not real OCR/vision) and returns a fixed, plausible set of extracted items for review.
// Each item carries a `confidence` so the UI can be honest that this needs a human check,
// rather than presenting fabricated certainty.
const MOCK_EXTRACTED_ITEMS = [
  { name: 'Paneer Tikka', category_name: 'Starters', price: 260, type: 'veg', spice: 'medium', confidence: 0.91 },
  { name: 'Chicken 65', category_name: 'Starters', price: 280, type: 'non_veg', spice: 'hot', confidence: 0.88 },
  { name: 'Malai Kofta', category_name: 'Main Course', price: 300, type: 'veg', spice: 'mild', confidence: 0.83 },
  { name: 'Chicken Curry', category_name: 'Main Course', price: 340, type: 'non_veg', spice: 'medium', confidence: 0.86 },
  { name: 'Tandoori Roti', category_name: 'Breads', price: 35, type: 'veg', spice: 'none', confidence: 0.95 },
  { name: 'Jeera Rice', category_name: 'Rice & Biryani', price: 180, type: 'veg', spice: 'none', confidence: 0.92 },
  { name: 'Gulab Jamun', category_name: 'Desserts', price: 110, type: 'veg', spice: 'none', confidence: 0.9 },
  { name: 'Sweet Lassi', category_name: 'Beverages', price: 100, type: 'veg', spice: 'none', confidence: 0.94 },
];

async function mockScan() {
  return {
    items: MOCK_EXTRACTED_ITEMS,
    note: 'This is a demo extraction — review every item and price before saving. Real menu scanning will use an AI vision model once one is configured.',
  };
}

async function liveScan({ imageBase64 }) {
  // Not implemented yet — flipping AI_PROVIDER=anthropic without a real vision call here
  // will throw, and withAI() falls back to the mock automatically.
  throw new Error('Live menu scanning is not implemented yet');
  // eslint-disable-next-line no-unused-vars
  void imageBase64;
}

async function scanMenu({ imageBase64 }) {
  return withAI({
    mock: () => mockScan(),
    live: () => liveScan({ imageBase64 }),
  });
}

module.exports = { scanMenu };
