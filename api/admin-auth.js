// api/admin-auth.js
// ─────────────────────────────────────────────────────────────
// Admin authentication endpoint for Hatch Kitchen Dashboard
// POST /api/admin-auth → { password } → { token, expiresAt }
//
// ENV:
//   ADMIN_PASSWORD  → dashboard password (default: HatchAdmin2026)
//   JWT_SECRET      → token signing key (auto-derived if not set)
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'HatchAdmin2026';
const JWT_SECRET = process.env.JWT_SECRET ||
  crypto.createHash('sha256').update(process.env.STRIPE_SECRET_KEY || 'hatch-fallback-secret').digest('hex');
const TOKEN_EXPIRY_MS = 8 * 60 * 60 * 1000; // 8 hours

function createToken() {
  const payload = {
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return { token: `${header}.${body}.${signature}`, expiresAt: payload.exp };
}

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

// Export verifyToken so other admin endpoints can use it
module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { password } = req.body || {};

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password required' });
    }

    // Constant-time comparison to prevent timing attacks
    const passwordBuffer = Buffer.from(password);
    const expectedBuffer = Buffer.from(ADMIN_PASSWORD);
    const isValid =
      passwordBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(passwordBuffer, expectedBuffer);

    if (!isValid) {
      // Brief delay to slow brute-force
      await new Promise((r) => setTimeout(r, 800));
      return res.status(401).json({ error: 'Invalid password' });
    }

    const { token, expiresAt } = createToken();
    return res.status(200).json({ token, expiresAt });
  } catch (err) {
    console.error('[admin-auth]', err.message);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// Attach verifyToken for re-use by other admin endpoints
module.exports.verifyToken = verifyToken;
module.exports.JWT_SECRET = JWT_SECRET;

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
