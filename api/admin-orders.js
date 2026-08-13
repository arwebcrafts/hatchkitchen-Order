// api/admin-orders.js
// ─────────────────────────────────────────────────────────────
// Fetch village orders from Stripe for the admin dashboard
// GET /api/admin-orders?status=all&from=&to=&limit=100
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Authenticate
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { status, from, to, starting_after } = req.query || {};
    const limit = Math.min(Number(req.query.limit) || 100, 100);

    // Build Stripe query params
    const params = { limit };

    // Date filters (Stripe uses Unix timestamps in seconds)
    if (from || to) {
      params.created = {};
      if (from) params.created.gte = Math.floor(new Date(from).getTime() / 1000);
      if (to) params.created.lte = Math.floor(new Date(to).getTime() / 1000) + 86399; // end of day
    }

    if (starting_after) {
      params.starting_after = starting_after;
    }

    // Fetch PaymentIntents from Stripe
    const result = await stripe.paymentIntents.list(params);

    // Filter to village orders only
    const villageOrders = result.data.filter(
      (pi) => pi.metadata && pi.metadata.source === 'hatch-village-orders'
    );

    // Apply status filter
    let filtered = villageOrders;
    if (status && status !== 'all') {
      if (status === 'paid') {
        filtered = villageOrders.filter((pi) => pi.status === 'succeeded');
      } else if (status === 'failed') {
        filtered = villageOrders.filter(
          (pi) => pi.status !== 'succeeded' && pi.status !== 'canceled'
        );
      } else if (status === 'cancelled') {
        filtered = villageOrders.filter((pi) => pi.status === 'canceled');
      } else if (status === 'fulfilled') {
        filtered = villageOrders.filter(
          (pi) => pi.metadata.dashboard_status === 'fulfilled'
        );
      } else if (status === 'new') {
        filtered = villageOrders.filter(
          (pi) =>
            pi.status === 'succeeded' &&
            (!pi.metadata.dashboard_status || pi.metadata.dashboard_status === 'new')
        );
      } else if (status === 'flagged') {
        filtered = villageOrders.filter(
          (pi) => pi.metadata.dashboard_flagged === 'true'
        );
      }
    }

    // Format response
    const orders = await Promise.all(
      filtered.map(async (pi) => {
        let cardLast4 = '';
        let cardBrand = '';
        try {
          if (pi.latest_charge) {
            const charge =
              typeof pi.latest_charge === 'string'
                ? await stripe.charges.retrieve(pi.latest_charge)
                : pi.latest_charge;
            cardLast4 = charge?.payment_method_details?.card?.last4 || '';
            cardBrand = charge?.payment_method_details?.card?.brand || '';
          }
        } catch (_) {
          /* charge may not exist for incomplete intents */
        }

        return {
          id: pi.id,
          amount: (pi.amount_received || pi.amount) / 100,
          currency: (pi.currency || 'usd').toUpperCase(),
          paymentStatus: pi.status,
          dashboardStatus: pi.metadata.dashboard_status || 'new',
          dashboardNotes: pi.metadata.dashboard_notes || '',
          flagged: pi.metadata.dashboard_flagged === 'true',
          created: pi.created, // Unix timestamp
          week: pi.metadata.week || '',
          residentName: pi.metadata.resident_name || '',
          customerName: pi.metadata.customer_name || '',
          customerEmail: pi.metadata.customer_email || '',
          customerPhone: pi.metadata.customer_phone || '',
          allergies: pi.metadata.allergies || '',
          specialRequests: pi.metadata.special_requests || '',
          items: pi.metadata.items || '',
          itemCount: Number(pi.metadata.item_count) || 0,
          raffleEntered: pi.metadata.raffle_entered === 'yes',
          cardLast4,
          cardBrand,
        };
      })
    );

    return res.status(200).json({
      orders,
      hasMore: result.has_more,
      lastId: result.data.length ? result.data[result.data.length - 1].id : null,
    });
  } catch (err) {
    console.error('[admin-orders]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to fetch orders' });
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
