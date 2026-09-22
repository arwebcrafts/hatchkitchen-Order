// api/export-csv.js
// ─────────────────────────────────────────────────────────────
// Dedicated backend CSV export for Hatch Kitchen Village Orders
// GET /api/export-csv
//
// Supports:
//   - Authorization: Bearer <token>
//   - Query param: ?token=<token>
//   - Query param: ?pw=HatchAdmin2026 (or ?key=...)
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'HatchAdmin2026';
const JWT_SECRET = process.env.JWT_SECRET ||
  crypto.createHash('sha256').update(process.env.STRIPE_SECRET_KEY || 'hatch-fallback-secret').digest('hex');

function verifyToken(token) {
  try {
    const parts = (token || '').split('.');
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

const MENU_DAY_MAPPING = {
  // Monday Meals
  'rotisserie chicken breast': ['monday'],
  'salmon tacos': ['monday'],
  'buffalo chicken wings': ['monday'],
  'smoked burger': ['monday'],

  // Tuesday Meals
  'rotisserie chicken leg and thigh': ['tuesday'],

  // Wednesday Meals
  'bbq chicken and rice bowl': ['wednesday'],

  // Thursday Meals
  'classic breakfast burrito': ['thursday'],
  'pulled bbq chicken sandwich': ['thursday'],

  // Shabbat Dinner (Friday)
  'shabbat dinner chicken meal': ['shabbat-dinner'],
  'chicken noodle soup': ['shabbat-dinner'],
  'swap chicken for ribeye strips': ['shabbat-dinner'],
  'ribeye': ['shabbat-dinner'],

  // Shabbat Lunch (Saturday)
  'chicken avocado salad': ['shabbat-lunch'],
  'asian chicken wrap': ['shabbat-lunch'],
  'southwest chicken wrap': ['shabbat-lunch'],

  // Multi-day meals
  'cheddar cheese quesadilla': ['tuesday', 'wednesday', 'thursday'],
  'shredded chicken breast and rotini pasta': ['wednesday', 'thursday'],
  'chicken nuggets and tater tots meal': ['monday', 'wednesday', 'thursday'],
  'summer harvest salad': ['tuesday', 'thursday', 'shabbat-lunch'],
  'veggie quinoa power bowl': ['wednesday', 'shabbat-lunch'],
  'chicken avocado wrap': ['tuesday', 'shabbat-lunch'],
  'chicken caesar wrap': ['wednesday', 'shabbat-lunch'],
  'chicken caesar salad': ['tuesday', 'shabbat-lunch'],
  'asian chicken salad': ['tuesday', 'shabbat-lunch'],
  'southwest chicken salad': ['monday', 'shabbat-lunch'],
};

function normalizeMealName(str) {
  return (str || '')
    .toLowerCase()
    .replace(/\s*\(\$\d+(\.\d+)?\s*(extra)?\)/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findDaysForMeal(rawName) {
  const norm = normalizeMealName(rawName);
  for (const [key, days] of Object.entries(MENU_DAY_MAPPING)) {
    if (norm.includes(key) || key.includes(norm)) {
      return days;
    }
  }
  return [];
}

function categorizeOrderMeals(order) {
  const result = {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    'shabbat-dinner': [],
    'shabbat-lunch': [],
    other: [],
  };

  // If explicit day fields already exist on the order object (from new metadata)
  let hasExplicitFields = false;
  if (order.mondayMeals) { result.monday.push(...order.mondayMeals.split('; ').filter(Boolean)); hasExplicitFields = true; }
  if (order.tuesdayMeals) { result.tuesday.push(...order.tuesdayMeals.split('; ').filter(Boolean)); hasExplicitFields = true; }
  if (order.wednesdayMeals) { result.wednesday.push(...order.wednesdayMeals.split('; ').filter(Boolean)); hasExplicitFields = true; }
  if (order.thursdayMeals) { result.thursday.push(...order.thursdayMeals.split('; ').filter(Boolean)); hasExplicitFields = true; }
  if (order.shabbatDinner) { result['shabbat-dinner'].push(...order.shabbatDinner.split('; ').filter(Boolean)); hasExplicitFields = true; }
  if (order.shabbatLunch) { result['shabbat-lunch'].push(...order.shabbatLunch.split('; ').filter(Boolean)); hasExplicitFields = true; }

  if (hasExplicitFields) {
    return formatCategorizedResult(result);
  }

  // Parse items string
  const rawItems = (order.items || '').split('; ').map(s => s.trim()).filter(Boolean);
  const pendingMultiDay = [];

  rawItems.forEach(item => {
    const prefixMatch = item.match(/^(Monday|Tuesday|Wednesday|Thursday|Shabbat Dinner|Shabbat Lunch)(\s+Meals)?[:\-–\]]\s*(.*)$/i);
    if (prefixMatch) {
      const dayPart = prefixMatch[1].toLowerCase().replace(/\s+/g, '-');
      const mealName = prefixMatch[3].trim() || item;
      const key = dayPart.includes('shabbat-dinner') || dayPart === 'friday' ? 'shabbat-dinner'
        : dayPart.includes('shabbat-lunch') || dayPart === 'saturday' ? 'shabbat-lunch'
        : dayPart;
      if (result[key]) {
        result[key].push(mealName);
        return;
      }
    }

    const possibleDays = findDaysForMeal(item);
    if (possibleDays.length === 1) {
      result[possibleDays[0]].push(item);
    } else if (possibleDays.length > 1) {
      pendingMultiDay.push({ item, possibleDays });
    } else {
      result.other.push(item);
    }
  });

  pendingMultiDay.sort((a, b) => a.possibleDays.length - b.possibleDays.length);
  pendingMultiDay.forEach(({ item, possibleDays }) => {
    let chosenDay = possibleDays.find(d => result[d].length === 0);
    if (!chosenDay) {
      chosenDay = possibleDays.reduce((minDay, d) => result[d].length < result[minDay].length ? d : minDay, possibleDays[0]);
    }
    result[chosenDay].push(item);
  });

  return formatCategorizedResult(result);
}

function formatCategorizedResult(result) {
  const monday = result.monday.join('; ');
  const tuesday = result.tuesday.join('; ');
  const wednesday = result.wednesday.join('; ');
  const thursday = result.thursday.join('; ');
  const shabbatDinner = result['shabbat-dinner'].join('; ');
  const shabbatLunch = result['shabbat-lunch'].join('; ');

  const allParts = [];
  if (monday) allParts.push(`Monday Meals: ${monday}`);
  if (tuesday) allParts.push(`Tuesday Meals: ${tuesday}`);
  if (wednesday) allParts.push(`Wednesday Meals: ${wednesday}`);
  if (thursday) allParts.push(`Thursday Meals: ${thursday}`);
  if (shabbatDinner) allParts.push(`Shabbat Dinner: ${shabbatDinner}`);
  if (shabbatLunch) allParts.push(`Shabbat Lunch: ${shabbatLunch}`);
  if (result.other && result.other.length) allParts.push(`Other: ${result.other.join('; ')}`);

  return {
    monday,
    tuesday,
    wednesday,
    thursday,
    shabbatDinner,
    shabbatLunch,
    allItems: allParts.join(' | '),
  };
}

function escapeCsvValue(val) {
  const str = String(val == null ? '' : val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Authenticate via Bearer token, query token, or query password/key
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || req.query.token;
  const pw = req.query.pw || req.query.password || req.query.key;

  const isPwValid = pw && (pw === ADMIN_PASSWORD || pw === 'HatchAdmin2026');
  const isTokenValid = token && verifyToken(token);

  if (!isPwValid && !isTokenValid) {
    return res.status(401).json({ error: 'Unauthorized. Provide token or password.' });
  }

  try {
    const limit = Math.min(Number(req.query.limit) || 100, 100);
    const result = await stripe.paymentIntents.list({ limit });

    const villageOrders = result.data.filter(
      (pi) => pi.metadata && pi.metadata.source === 'hatch-village-orders'
    );

    const headers = [
      'Date',
      'Resident',
      'Contact',
      'Email',
      'Phone',
      'Week',
      'Monday Meals',
      'Tuesday Meals',
      'Wednesday Meals',
      'Thursday Meals',
      'Shabbat Dinner',
      'Shabbat Lunch',
      'All Items',
      'Amount',
      'Payment',
      'Status',
      'Stripe ID'
    ];

    const rows = villageOrders.map(pi => {
      const date = new Date(pi.created * 1000).toLocaleDateString('en-US');
      const orderObj = {
        items: pi.metadata.items || '',
        mondayMeals: pi.metadata.monday_meals || '',
        tuesdayMeals: pi.metadata.tuesday_meals || '',
        wednesdayMeals: pi.metadata.wednesday_meals || '',
        thursdayMeals: pi.metadata.thursday_meals || '',
        shabbatDinner: pi.metadata.shabbat_dinner || '',
        shabbatLunch: pi.metadata.shabbat_lunch || '',
      };
      const cat = categorizeOrderMeals(orderObj);
      const amount = ((pi.amount_received || pi.amount) / 100).toFixed(2);

      return [
        escapeCsvValue(date),
        escapeCsvValue(pi.metadata.resident_name || ''),
        escapeCsvValue(pi.metadata.customer_name || ''),
        escapeCsvValue(pi.metadata.customer_email || ''),
        escapeCsvValue(pi.metadata.customer_phone || ''),
        escapeCsvValue(pi.metadata.week || ''),
        escapeCsvValue(cat.monday),
        escapeCsvValue(cat.tuesday),
        escapeCsvValue(cat.wednesday),
        escapeCsvValue(cat.thursday),
        escapeCsvValue(cat.shabbatDinner),
        escapeCsvValue(cat.shabbatLunch),
        escapeCsvValue(cat.allItems),
        escapeCsvValue(amount),
        escapeCsvValue(pi.status),
        escapeCsvValue(pi.metadata.dashboard_status || 'new'),
        escapeCsvValue(pi.id),
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const filename = `hatch-orders-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('[export-csv]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to export CSV' });
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
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
