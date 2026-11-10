// api/admin-orders.js
// ─────────────────────────────────────────────────────────────
// Fetch orders from Stripe for the admin dashboard (Village & Thanksgiving)
// GET /api/admin-orders?status=all&from=&to=&limit=100&type=all
//
// Requires: Authorization: Bearer <token> or ?pw=HatchAdmin2026
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? require('stripe')(stripeKey) : null;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'HatchAdmin2026';
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
  const token = authHeader.replace(/^Bearer\s+/i, '') || req.query.token;
  const pw = req.query.pw || req.query.password || req.query.key;
  const isPwValid = pw && (pw === 'HatchAdmin2026' || pw === ADMIN_PASSWORD);
  const isTokenValid = token && verifyToken(token);
  if (!isPwValid && !isTokenValid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.query.format === 'csv') {
    return require('./export-csv.js')(req, res);
  }

  if (!stripe) {
    return res.status(200).json({
      orders: [],
      hasMore: false,
      lastId: null,
      message: 'Stripe API key not configured in environment.',
    });
  }

  try {
    const { status, from, to, starting_after, type = 'all' } = req.query || {};
    const limit = Math.min(Number(req.query.limit) || 100, 100);

    let allOrders = [];

    // 1. Fetch Village PaymentIntents from Stripe (unless type === 'thanksgiving')
    if (type !== 'thanksgiving') {
      const params = { limit };
      if (from || to) {
        params.created = {};
        if (from) params.created.gte = Math.floor(new Date(from).getTime() / 1000);
        if (to) params.created.lte = Math.floor(new Date(to).getTime() / 1000) + 86399;
      }
      if (starting_after) params.starting_after = starting_after;

      try {
        const result = await stripe.paymentIntents.list(params);
        const villageOrders = (result.data || []).filter(
          (pi) => pi.metadata && pi.metadata.source === 'hatch-village-orders'
        );

        let filteredVillage = villageOrders;
        if (status && status !== 'all') {
          if (status === 'paid') filteredVillage = villageOrders.filter((pi) => pi.status === 'succeeded');
          else if (status === 'failed') filteredVillage = villageOrders.filter((pi) => pi.status !== 'succeeded' && pi.status !== 'canceled');
          else if (status === 'cancelled') filteredVillage = villageOrders.filter((pi) => pi.status === 'canceled');
          else if (status === 'fulfilled') filteredVillage = villageOrders.filter((pi) => pi.metadata.dashboard_status === 'fulfilled');
          else if (status === 'new') filteredVillage = villageOrders.filter((pi) => pi.status === 'succeeded' && (!pi.metadata.dashboard_status || pi.metadata.dashboard_status === 'new'));
          else if (status === 'flagged') filteredVillage = villageOrders.filter((pi) => pi.metadata.dashboard_flagged === 'true');
        }

        const formattedVillage = await Promise.all(
          filteredVillage.map(async (pi) => {
            let cardLast4 = '';
            let cardBrand = '';
            try {
              if (pi.latest_charge) {
                const charge = typeof pi.latest_charge === 'string'
                  ? await stripe.charges.retrieve(pi.latest_charge)
                  : pi.latest_charge;
                cardLast4 = charge?.payment_method_details?.card?.last4 || '';
                cardBrand = charge?.payment_method_details?.card?.brand || '';
              }
            } catch (_) {}

            return {
              id: pi.id,
              orderType: 'village',
              amount: (pi.amount_received || pi.amount) / 100,
              currency: (pi.currency || 'usd').toUpperCase(),
              paymentStatus: pi.status,
              dashboardStatus: pi.metadata.dashboard_status || 'new',
              dashboardNotes: pi.metadata.dashboard_notes || '',
              flagged: pi.metadata.dashboard_flagged === 'true',
              created: pi.created,
              week: pi.metadata.week || '',
              residentName: pi.metadata.resident_name || '',
              customerName: pi.metadata.customer_name || '',
              customerEmail: pi.metadata.customer_email || '',
              customerPhone: pi.metadata.customer_phone || '',
              allergies: pi.metadata.allergies || '',
              specialRequests: pi.metadata.special_requests || '',
              items: pi.metadata.items || '',
              mondayMeals: pi.metadata.monday_meals || '',
              tuesdayMeals: pi.metadata.tuesday_meals || '',
              wednesdayMeals: pi.metadata.wednesday_meals || '',
              thursdayMeals: pi.metadata.thursday_meals || '',
              shabbatDinner: pi.metadata.shabbat_dinner || '',
              shabbatLunch: pi.metadata.shabbat_lunch || '',
              itemCount: Number(pi.metadata.item_count) || 0,
              raffleEntered: pi.metadata.raffle_entered === 'yes',
              cardLast4,
              cardBrand,
            };
          })
        );

        allOrders.push(...formattedVillage);
      } catch (piErr) {
        console.warn('[admin-orders] PaymentIntents fetch error:', piErr.message);
      }
    }

    // 2. Fetch Thanksgiving Pre-Orders from Stripe Customers (unless type === 'village')
    if (type !== 'village') {
      try {
        let tgCustomers = [];
        try {
          const searchRes = await stripe.customers.search({
            query: 'metadata["type"]:"thanksgiving-preorder"',
            limit: 100,
          });
          tgCustomers = searchRes.data || [];
        } catch (_) {}

        if (tgCustomers.length === 0) {
          const listRes = await stripe.customers.list({ limit: 100 });
          tgCustomers = (listRes.data || []).filter(
            (c) => c.metadata && (c.metadata.type === 'thanksgiving-preorder' || c.metadata.source === 'hatch-thanksgiving-orders')
          );
        }

        const formattedTg = tgCustomers.map((c) => {
          const createdUnix = Math.floor(new Date(c.metadata?.created_at || (c.created * 1000)).getTime() / 1000);
          return {
            id: c.metadata?.order_id || c.id,
            stripeCustomerId: c.id,
            orderType: 'thanksgiving',
            amount: Number(c.metadata?.total) || 0,
            currency: 'USD',
            paymentStatus: 'succeeded', // Pre-orders marked succeeded/valid
            dashboardStatus: c.metadata?.dashboard_status || 'new',
            dashboardNotes: c.metadata?.comments || '',
            flagged: false,
            created: createdUnix,
            week: c.metadata?.pickup_day || 'Thanksgiving Pickup',
            residentName: c.name || c.metadata?.customer_name || 'Thanksgiving Pre-Order',
            customerName: c.name || c.metadata?.customer_name || '',
            customerEmail: c.email || c.metadata?.customer_email || '',
            customerPhone: c.phone || c.metadata?.customer_phone || '',
            allergies: '',
            specialRequests: c.metadata?.comments || '',
            items: c.metadata?.items || '',
            itemCount: Number(c.metadata?.item_count) || 1,
            raffleEntered: false,
            pickupDay: c.metadata?.pickup_day || '',
            promoCode: c.metadata?.promo_code || '',
            cardLast4: '',
            cardBrand: '',
          };
        });

        // Apply filters to Thanksgiving orders
        let filteredTg = formattedTg;
        if (status && status !== 'all') {
          if (status === 'fulfilled') filteredTg = formattedTg.filter((o) => o.dashboardStatus === 'fulfilled');
          else if (status === 'new') filteredTg = formattedTg.filter((o) => !o.dashboardStatus || o.dashboardStatus === 'new');
          else if (status === 'cancelled') filteredTg = formattedTg.filter((o) => o.dashboardStatus === 'cancelled');
          else if (status === 'failed') filteredTg = [];
        }

        if (from) {
          const fromUnix = Math.floor(new Date(from).getTime() / 1000);
          filteredTg = filteredTg.filter((o) => o.created >= fromUnix);
        }
        if (to) {
          const toUnix = Math.floor(new Date(to).getTime() / 1000) + 86399;
          filteredTg = filteredTg.filter((o) => o.created <= toUnix);
        }

        allOrders.push(...filteredTg);
      } catch (tgErr) {
        console.warn('[admin-orders] Thanksgiving customers fetch error:', tgErr.message);
      }
    }

    // Sort all orders newest first
    allOrders.sort((a, b) => b.created - a.created);

    return res.status(200).json({
      orders: allOrders,
      hasMore: false,
      lastId: allOrders.length ? allOrders[allOrders.length - 1].id : null,
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
