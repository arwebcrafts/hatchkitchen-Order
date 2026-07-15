// api/create-payment-intent.js
// ─────────────────────────────────────────────────────────────
// Vercel Serverless Function — Hatch Kitchen Orders (Camp + Village)
// Creates a Stripe PaymentIntent on the server side (required by Stripe)
//
// ENV VARS required in Vercel dashboard:
//   STRIPE_SECRET_KEY  → Your Stripe secret key (sk_live_... or sk_test_...)
// ─────────────────────────────────────────────────────────────

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  // ── CORS headers (allow your domain + localhost for dev) ──
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      amount,          // integer in cents, e.g. 3200 = $32.00
      currency = 'usd',
      metadata = {}
    } = req.body;

    // Validate amount
    if (!amount || typeof amount !== 'number' || amount < 50) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const isVillage = metadata.source === 'hatch-village-orders' || metadata.order_type === 'village-dinner';

    // Card Element + confirmCardPayment needs payment_method_types: ['card']
    // (automatic_payment_methods is for Payment Element flows)
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method_types: ['card'],
      metadata: {
        source: metadata.source || 'hatch-camp-orders',
        ...flattenMetadata(metadata),
      },
      description: isVillage
        ? `Hatch Kitchen — Meals at the Village (${metadata.week || 'Weekly Dinner'})`
        : `Hatch Kitchen — Camp Lunch Order (${metadata.customer_name || 'parent'})`,
    });

    // Return only the client secret (never the full intent)
    return res.status(200).json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error('[Stripe error]', err.message);
    return res.status(500).json({ error: err.message || 'Payment setup failed' });
  }
};

// Stripe metadata values must be strings (max 500 chars each)
function flattenMetadata(meta) {
  const out = {};
  Object.entries(meta || {}).forEach(([key, val]) => {
    if (val == null || key === 'source') return;
    const str = typeof val === 'string' ? val : String(val);
    out[key] = str.slice(0, 500);
  });
  return out;
}
