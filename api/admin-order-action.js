// api/admin-order-action.js
// ─────────────────────────────────────────────────────────────
// Update order status / notes via Stripe PaymentIntent metadata
// POST /api/admin-order-action
//   { intentId, action, data }
//   actions: mark-fulfilled, mark-new, mark-cancelled, add-note, flag, unflag
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Authenticate
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { intentId, action, data } = req.body || {};

    if (!intentId || typeof intentId !== 'string') {
      return res.status(400).json({ error: 'Missing intentId' });
    }
    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'Missing action' });
    }

    // Fetch current intent to preserve existing metadata
    const intent = await stripe.paymentIntents.retrieve(intentId);
    const meta = { ...(intent.metadata || {}) };

    switch (action) {
      case 'mark-fulfilled':
        meta.dashboard_status = 'fulfilled';
        meta.dashboard_fulfilled_at = new Date().toISOString();
        break;

      case 'mark-new':
        meta.dashboard_status = 'new';
        delete meta.dashboard_fulfilled_at;
        break;

      case 'mark-cancelled':
        meta.dashboard_status = 'cancelled';
        meta.dashboard_cancelled_at = new Date().toISOString();
        break;

      case 'add-note': {
        const note = (data && data.note) ? String(data.note).slice(0, 450) : '';
        const existingNotes = meta.dashboard_notes || '';
        const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const newEntry = `[${timestamp}] ${note}`;
        // Stripe metadata values max 500 chars, so truncate
        meta.dashboard_notes = existingNotes
          ? `${newEntry}\n${existingNotes}`.slice(0, 500)
          : newEntry.slice(0, 500);
        break;
      }

      case 'flag':
        meta.dashboard_flagged = 'true';
        break;

      case 'unflag':
        meta.dashboard_flagged = 'false';
        break;

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    // Update Stripe PaymentIntent metadata
    await stripe.paymentIntents.update(intentId, { metadata: meta });

    return res.status(200).json({ ok: true, action, intentId });
  } catch (err) {
    console.error('[admin-order-action]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to update order' });
  }
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
