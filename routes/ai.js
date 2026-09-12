const router = require('express').Router();
const { scanMenu } = require('../services/ai/menuScanner');

// Base64 data URLs inflate ~33% over binary; this is generous enough for a phone photo
// of a menu page while keeping the whole request in Express's default JSON body limit.
const MAX_IMAGE_CHARS = 8 * 1024 * 1024;

router.post('/menu/scan', async (req, res, next) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'image is required (base64 data URL)' });
    if (image.length > MAX_IMAGE_CHARS) return res.status(413).json({ error: 'Image too large' });

    const result = await scanMenu({ imageBase64: image });
    res.json({ data: { items: result.items, note: result.note }, meta: { provider: result.provider, generated_at: new Date().toISOString() } });
  } catch (err) { next(err); }
});

module.exports = router;
