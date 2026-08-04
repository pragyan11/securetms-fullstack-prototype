const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const geocodeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

router.get('/search', geocodeLimiter, async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query) {
      return res.status(400).json({ message: 'Missing query parameter "q"' });
    }

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(req.query.limit || 5));
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'SpeedX/1.0 (contact: support@speedx.com)',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ message: 'Geocoding provider error' });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: 'Geocoding failed', error: err.message });
  }
});

module.exports = router;
