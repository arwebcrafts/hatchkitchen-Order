// api/admin-abandoned.js
// ─────────────────────────────────────────────────────────────
// Fetch abandoned village orders from Stripe Customers
// GET /api/admin-abandoned?limit=50
//
// Also supports:
//   POST /api/admin-abandoned { action: 'mark-followed-up', customerId }
//   POST /api/admin-abandoned { action: 'delete', customerId }
//
// Requires: Authorization: Bearer <token>
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const JWT_SECRET = process.env.JWT_SECRET ||
  crypto.createHash('sha256').update(process.env.STRIPE_SECRET_KEY || 'hatch-fallback-secret').digest('hex');

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expected = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (signature !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Authenticate
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // GET — list abandoned orders
  if (req.method === 'GET') {
    try {
      const result = await stripe.customers.search({
        query: 'metadata["type"]:"abandoned-village-order"',
        limit: Math.min(Number(req.query.limit) || 50, 100),
      });

      const abandoned = result.data.map((c) => ({
        id: c.id,
        residentName: c.metadata.resident_name || c.name || '',
        contactName: c.metadata.contact_name || '',
        contactEmail: c.metadata.contact_email || c.email || '',
        contactPhone: c.metadata.contact_phone || c.phone || '',
        residentPhone: c.metadata.resident_phone || '',
        allergies: c.metadata.allergies || '',
        specialRequests: c.metadata.special_requests || '',
        week: c.metadata.week || '',
        items: c.metadata.items || '',
        total: Number(c.metadata.total) || 0,
        itemCount: Number(c.metadata.item_count) || 0,
        stepReached: Number(c.metadata.step_reached) || 1,
        abandonedAt: c.metadata.abandoned_at || new Date(c.created * 1000).toISOString(),
        followedUp: c.metadata.followed_up === 'true',
        created: c.created,
      }));

      // Sort by most recent first
      abandoned.sort((a, b) => b.created - a.created);

      return res.status(200).json({ abandoned, hasMore: result.has_more });
    } catch (err) {
      console.error('[admin-abandoned GET]', err.message);
      return res.status(500).json({ error: err.message || 'Failed to fetch abandoned orders' });
    }
  }

  // POST — actions on abandoned orders
  if (req.method === 'POST') {
    try {
      const { action, customerId } = req.body || {};

      if (!customerId || typeof customerId !== 'string') {
        return res.status(400).json({ error: 'Missing customerId' });
      }

      if (action === 'mark-followed-up') {
        await stripe.customers.update(customerId, {
          metadata: { followed_up: 'true', followed_up_at: new Date().toISOString() },
        });
        return res.status(200).json({ ok: true });
      }

      if (action === 'mark-not-followed-up') {
        await stripe.customers.update(customerId, {
          metadata: { followed_up: 'false' },
        });
        return res.status(200).json({ ok: true });
      }

      if (action === 'delete') {
        await stripe.customers.del(customerId);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    } catch (err) {
      console.error('[admin-abandoned POST]', err.message);
      return res.status(500).json({ error: err.message || 'Failed to update abandoned order' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

function setCors(req, res) {
  const allowedOrigins = [
    'https://www.thehatchkitchen.com',
    'https://thehatchkitchen.com',
    'https://hatch-the-village.netlify.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'http://localhost:5500',
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
