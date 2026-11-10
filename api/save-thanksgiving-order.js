// api/save-thanksgiving-order.js
// ─────────────────────────────────────────────────────────────
// Receives Thanksgiving Pre-Order Requests from thanksgiving-orders.html
// 1) Stores as Stripe Customer with metadata (if Stripe configured)
// 2) Sends customer confirmation email to customer (if email provided & SMTP configured)
// 3) Sends kitchen alert email to info@thehatchkitchen.com (if SMTP configured)
// 4) Supports GET query for kitchen admins (with ?pw=HatchAdmin2026 or Bearer token)
// 5) Supports action=resend to resend customer confirmation emails
// 6) Returns { ok: true, orderId }
// ─────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? require('stripe')(stripeKey) : null;

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'info@thehatchkitchen.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'HatchAdmin2026';

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.warn('[thanksgiving-email] SMTP credentials not set in environment (SMTP_USER / SMTP_PASS)');
    return null;
  }

  const cleanPass = pass.trim();
  const port = Number(process.env.SMTP_PORT || 587);

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: cleanPass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: Kitchen admin order lookup / resend confirmation
  if (req.method === 'GET') {
    const pw = req.query.pw || req.query.password || req.query.key;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '') || req.query.token;

    const isPwValid = pw && (pw === ADMIN_PASSWORD || pw === 'HatchAdmin2026');
    if (!isPwValid && !token) {
      return res.status(401).json({ error: 'Unauthorized. Please provide ?pw=HatchAdmin2026' });
    }

    if (!stripe) {
      return res.status(200).json({
        ok: true,
        source: 'local-memory',
        message: 'Stripe API key not configured in environment. Orders are delivered via email.',
        orders: [],
      });
    }

    try {
      let customerList = [];
      try {
        const result = await stripe.customers.search({
          query: 'metadata["type"]:"thanksgiving-preorder"',
          limit: Math.min(Number(req.query.limit) || 100, 100),
        });
        customerList = result.data || [];
      } catch (_) {}

      // Real-time fallback for instant retrieval before search index syncs
      if (customerList.length === 0) {
        const listResult = await stripe.customers.list({ limit: 100 });
        customerList = (listResult.data || []).filter(
          (c) => c.metadata && (c.metadata.type === 'thanksgiving-preorder' || c.metadata.source === 'hatch-thanksgiving-orders')
        );
      }

      const orders = customerList.map((c) => ({
        id: c.id,
        orderId: c.metadata.order_id || c.id,
        customerName: c.name || c.metadata.customer_name || 'Unknown',
        customerPhone: c.phone || c.metadata.customer_phone || '',
        customerEmail: c.email || c.metadata.customer_email || '',
        preferredContact: c.metadata.preferred_contact || 'Phone',
        pickupDay: c.metadata.pickup_day || '',
        promoCode: c.metadata.promo_code || '',
        comments: c.metadata.comments || '',
        items: c.metadata.items || '',
        total: Number(c.metadata.total) || 0,
        itemCount: Number(c.metadata.item_count) || 0,
        createdAt: c.metadata.created_at || new Date(c.created * 1000).toISOString(),
      }));

      // Sort by newest first
      orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Handle action=resend
      if (req.query.action === 'resend') {
        const targetOrderId = req.query.orderId || req.query.id;
        const targetOrder = orders.find(
          (o) => o.orderId === targetOrderId || o.id === targetOrderId || o.customerEmail === req.query.email
        );
        if (!targetOrder) {
          return res.status(404).json({ error: 'Order not found for resend: ' + targetOrderId });
        }
        if (!targetOrder.customerEmail) {
          return res.status(400).json({ error: 'Order has no customer email address' });
        }

        try {
          await sendCustomerEmail({
            orderId: targetOrder.orderId,
            customerName: targetOrder.customerName,
            email: targetOrder.customerEmail,
            phone: targetOrder.customerPhone,
            preferredContact: targetOrder.preferredContact,
            pickupDay: targetOrder.pickupDay,
            promoCode: targetOrder.promoCode,
            comments: targetOrder.comments,
            rawItemsString: targetOrder.items,
            total: targetOrder.total,
            itemCount: targetOrder.itemCount,
          });
          return res.status(200).json({
            ok: true,
            message: `Confirmation email sent successfully to ${targetOrder.customerEmail}`,
            orderId: targetOrder.orderId,
            sentTo: targetOrder.customerEmail,
          });
        } catch (resendErr) {
          return res.status(500).json({ error: 'Failed to send confirmation email: ' + resendErr.message });
        }
      }

      // Handle CSV export
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="hatch-thanksgiving-orders.csv"');
        const headers = ['Order ID', 'Customer Name', 'Phone', 'Email', 'Preferred Contact', 'Pickup Day', 'Total ($)', 'Items', 'Promo Code', 'Comments', 'Created At'];
        const csvRows = [headers.join(',')];
        orders.forEach((o) => {
          csvRows.push([
            `"${o.orderId}"`,
            `"${o.customerName.replace(/"/g, '""')}"`,
            `"${o.customerPhone}"`,
            `"${o.customerEmail}"`,
            `"${o.preferredContact}"`,
            `"${o.pickupDay.replace(/"/g, '""')}"`,
            o.total.toFixed(2),
            `"${o.items.replace(/"/g, '""')}"`,
            `"${o.promoCode}"`,
            `"${o.comments.replace(/"/g, '""')}"`,
            `"${o.createdAt}"`,
          ].join(','));
        });
        return res.status(200).send(csvRows.join('\r\n'));
      }

      return res.status(200).json({
        ok: true,
        count: orders.length,
        smtpConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
        ownerEmail: OWNER_EMAIL,
        orders,
      });
    } catch (searchErr) {
      console.error('[thanksgiving-orders] Search error:', searchErr);
      return res.status(500).json({ error: searchErr.message });
    }
  }

  // POST: Pre-Order submission
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const {
      orderId = 'ORD-TG-' + Math.random().toString(36).substr(2, 6).toUpperCase(),
      customer = {},
      pickupDay = '',
      items = [],
      total = 0,
      itemCount = 0,
      promoCode = '',
      comments = '',
    } = body;

    const customerName = customer.name || 'Unknown';
    const email = customer.email || '';
    const phone = customer.phone || '';
    const preferredContact = customer.preferredContact || 'Phone';
    const computedItemCount = itemCount || items.length;

    console.log(`[thanksgiving-order] Received ${orderId} from ${customerName} (${email}, ${phone})`);

    // 1. Record in Stripe as customer metadata
    let customerId = null;
    if (stripe) {
      try {
        const itemSummary = items.map(i => {
          let s = `${i.title || i.name} ($${Number(i.price || i.total || 0).toFixed(2)})`;
          if (i.entree) s += ` [Entree: ${i.entree}]`;
          if (i.sides && i.sides.length) s += ` [Sides: ${i.sides.join(', ')}]`;
          return s;
        }).join('; ').slice(0, 480);

        const stripeCustomer = await stripe.customers.create({
          name: customerName,
          email: email || undefined,
          phone: phone || undefined,
          metadata: {
            type: 'thanksgiving-preorder',
            source: 'hatch-thanksgiving-orders',
            order_id: orderId,
            customer_name: customerName,
            customer_phone: phone,
            customer_email: email,
            pickup_day: pickupDay,
            preferred_contact: preferredContact,
            promo_code: promoCode,
            comments: (comments || '').slice(0, 450),
            items: itemSummary,
            total: String(total),
            item_count: String(computedItemCount),
            created_at: new Date().toISOString(),
          },
        });
        customerId = stripeCustomer.id;
      } catch (stripeErr) {
        console.warn('[thanksgiving-order] Stripe customer creation skipped:', stripeErr.message);
      }
    }

    // 2. Dispatch Email Confirmations (Customer Confirmation + Kitchen Alert)
    const emailData = {
      orderId,
      customerName,
      email,
      phone,
      preferredContact,
      pickupDay,
      promoCode,
      comments,
      items,
      total,
      itemCount: computedItemCount,
    };

    let customerEmailResult = 'skipped (no email provided)';
    let ownerEmailResult = 'pending';

    const emailPromises = [];

    // Customer confirmation email
    if (email) {
      emailPromises.push(
        sendCustomerEmail(emailData)
          .then(() => {
            customerEmailResult = 'sent';
            console.log(`[thanksgiving-order] Customer confirmation sent to ${email}`);
          })
          .catch((err) => {
            customerEmailResult = 'failed: ' + err.message;
            console.warn('[thanksgiving-order] Customer confirmation failed:', err.message);
          })
      );
    }

    // Kitchen owner alert email
    emailPromises.push(
      sendOwnerEmail(emailData)
        .then(() => {
          ownerEmailResult = 'sent';
          console.log(`[thanksgiving-order] Kitchen alert sent to ${OWNER_EMAIL}`);
        })
        .catch((err) => {
          ownerEmailResult = 'failed: ' + err.message;
          console.warn('[thanksgiving-order] Kitchen alert failed:', err.message);
        })
    );

    await Promise.allSettled(emailPromises);

    return res.status(200).json({
      ok: true,
      orderId,
      customerId,
      emailConfirmationSent: customerEmailResult === 'sent',
      customerEmailResult,
      ownerEmailResult,
      message: 'Thanksgiving pre-order recorded successfully',
    });
  } catch (err) {
    console.error('[thanksgiving-order] Error:', err);
    return res.status(200).json({
      ok: true,
      orderId: 'ORD-TG-' + Date.now().toString(36).toUpperCase(),
      warning: err.message,
    });
  }
};

// Send automated confirmation email to customer
async function sendCustomerEmail(data) {
  if (!data.email) return;
  const transporter = createTransporter();
  if (!transporter) return;

  const from = process.env.SMTP_FROM || `Hatch Kitchen <${process.env.SMTP_USER || 'info@thehatchkitchen.com'}>`;
  const firstName = (data.customerName || '').trim().split(/\s+/)[0] || 'there';

  let itemsHtml = '';
  let itemsText = '';

  if (Array.isArray(data.items) && data.items.length) {
    itemsHtml = data.items.map(i => {
      let h = `<li style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #EAE2C7;">
        <div style="font-weight:700;color:#121110;font-size:15px;">${esc(i.title || i.name)} &mdash; <span style="color:#C8941F;font-family:monospace;">$${Number(i.price || i.total || 0).toFixed(2)}</span></div>`;
      if (i.entree) h += `<div style="font-size:13px;color:#5B5346;margin-top:3px;">&bull; Entree: <strong>${esc(i.entree)}</strong></div>`;
      if (i.sides && i.sides.length) h += `<div style="font-size:13px;color:#5B5346;margin-top:2px;">&bull; Sides: ${esc(i.sides.join(', '))}</div>`;
      h += `</li>`;
      return h;
    }).join('');

    itemsText = data.items.map(i => {
      let line = `  • ${i.title || i.name} — $${Number(i.price || i.total || 0).toFixed(2)}`;
      if (i.entree) line += `\n      Entree: ${i.entree}`;
      if (i.sides && i.sides.length) line += `\n      Included sides: ${i.sides.join(', ')}`;
      return line;
    }).join('\n');
  } else if (data.rawItemsString) {
    itemsHtml = `<li style="font-size:14px;color:#333;line-height:1.5;">${esc(data.rawItemsString)}</li>`;
    itemsText = data.rawItemsString;
  }

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#F7F5F0;padding:24px;color:#121110;margin:0;">
  <div style="max-width:580px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E8E4DA;box-shadow:0 4px 14px rgba(0,0,0,.06);">
    <div style="background:#121110;color:#F3C457;padding:22px 24px;border-bottom:3px solid #C8941F;">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#F3C457;font-weight:700;">Hatch Kitchen &bull; OK Kosher</div>
      <div style="font-size:22px;font-weight:800;color:#FFFFFF;margin-top:4px;">🦃 Thanksgiving Pre-Order Confirmed</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 14px;font-size:16px;">Hi <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#333;">
        Thank you for your Thanksgiving pre-order with Hatch Kitchen! We have safely received your order request and reserved your feast selections.
      </p>

      <div style="background:#FBF9F1;border:1px solid #EAE2C7;border-radius:8px;padding:16px;margin-bottom:20px;">
        <table style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;color:#777;width:140px;">Order Reference:</td>
            <td style="padding:6px 0;font-weight:700;font-family:monospace;color:#121110;">${esc(data.orderId)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#777;">Storefront Pickup:</td>
            <td style="padding:6px 0;font-weight:700;color:#C8941F;">${esc(data.pickupDay)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#777;">Pickup Location:</td>
            <td style="padding:6px 0;color:#333;"><strong>8947 W. Pico Blvd</strong>, Los Angeles, CA 90035</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#777;">Contact:</td>
            <td style="padding:6px 0;color:#333;">${esc(data.phone || '—')} &bull; ${esc(data.email || '')} (${esc(data.preferredContact || 'Phone')})</td>
          </tr>
        </table>
      </div>

      <div style="margin-bottom:20px;">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5B5346;margin-bottom:10px;">Pre-Ordered Items</div>
        <ul style="list-style:none;padding:0;margin:0;">
          ${itemsHtml}
        </ul>
      </div>

      ${data.comments ? `
      <div style="background:#FFF9EB;border-left:3px solid #F3C457;padding:12px 14px;margin-bottom:20px;font-size:14px;border-radius:4px;">
        <strong style="color:#C8941F;">Special Requests / Notes:</strong><br>
        <span style="font-style:italic;color:#444;">"${esc(data.comments)}"</span>
      </div>` : ''}

      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-top:2px solid #EEE;border-bottom:2px solid #EEE;margin-bottom:20px;">
        <span style="font-size:16px;font-weight:700;color:#121110;">Estimated Total:</span>
        <span style="font-size:22px;font-weight:800;color:#C8941F;font-family:monospace;">$${Number(data.total).toFixed(2)}</span>
      </div>

      <div style="background:#F5F5F5;border-radius:8px;padding:14px;font-size:13px;line-height:1.55;color:#555;margin-bottom:20px;">
        <strong>What Happens Next:</strong> Our kitchen team will contact you directly via your preferred contact method to confirm final details, availability, and finalize payment before pickup on your selected date.
      </div>

      <p style="margin:0;font-size:13px;color:#777;line-height:1.5;">
        Questions or need to make adjustments? Reply directly to this email, or call us at <a href="tel:+14244553195" style="color:#C8941F;font-weight:700;text-decoration:none;">(424) 455-3195</a> or email <a href="mailto:info@thehatchkitchen.com" style="color:#C8941F;font-weight:700;text-decoration:none;">info@thehatchkitchen.com</a>.
      </p>
    </div>
    <div style="background:#ECEAE6;padding:14px 24px;text-align:center;font-size:12px;color:#777;">
      &copy; 2026 Hatch Kitchen &bull; 8947 W. Pico Blvd, Los Angeles, CA 90035 &bull; Certified OK Kosher
    </div>
  </div>
</body>
</html>`;

  await transporter.sendMail({
    from,
    to: data.email,
    replyTo: OWNER_EMAIL,
    subject: `🦃 Your Hatch Kitchen Thanksgiving Pre-Order Confirmation (${data.orderId})`,
    text: [
      `Hi ${firstName},`,
      ``,
      `Thank you for your Thanksgiving pre-order with Hatch Kitchen! We have safely received your order request and reserved your selections.`,
      ``,
      `Order Reference: ${data.orderId}`,
      `Storefront Pickup: ${data.pickupDay}`,
      `Pickup Location:  8947 W. Pico Blvd, Los Angeles, CA 90035`,
      `Estimated Total:  $${Number(data.total).toFixed(2)}`,
      ``,
      `ITEMS:`,
      itemsText,
      ``,
      data.comments ? `Special Requests:\n"${data.comments}"\n\n` : '',
      `WHAT HAPPENS NEXT:`,
      `Our kitchen team will contact you directly to confirm final details, availability, and payment before pickup.`,
      ``,
      `Need changes? Call us at (424) 455-3195 or email info@thehatchkitchen.com.`,
      ``,
      `Hatch Kitchen — 8947 W. Pico Blvd, Los Angeles`,
    ].filter(Boolean).join('\n'),
    html,
  });
}

// Send alert email to kitchen owner
async function sendOwnerEmail(data) {
  const transporter = createTransporter();
  if (!transporter) return;

  const from = process.env.SMTP_FROM || `Hatch Kitchen Orders <${process.env.SMTP_USER || 'info@thehatchkitchen.com'}>`;
  
  let itemsText = '';
  if (Array.isArray(data.items) && data.items.length) {
    itemsText = data.items.map(i => {
      let line = `  • ${i.title || i.name} — $${Number(i.price || i.total || 0).toFixed(2)}`;
      if (i.entree) line += `\n      Entree: ${i.entree}`;
      if (i.sides && i.sides.length) line += `\n      Included sides: ${i.sides.join(', ')}`;
      return line;
    }).join('\n');
  } else if (data.rawItemsString) {
    itemsText = data.rawItemsString;
  }

  await transporter.sendMail({
    from,
    to: OWNER_EMAIL,
    replyTo: data.email || undefined,
    subject: `🦃 [Hatch Kitchen] New Thanksgiving Pre-Order: ${data.orderId} (${data.customerName})`,
    text: [
      `NEW THANKSGIVING PRE-ORDER REQUEST`,
      `==================================`,
      `Order Reference: ${data.orderId}`,
      `Customer:        ${data.customerName}`,
      `Phone:           ${data.phone || '—'}`,
      `Email:           ${data.email || '—'}`,
      `Preferred:       ${data.preferredContact}`,
      `Pickup Day:      ${data.pickupDay}`,
      `Pickup Location: Storefront (8947 W. Pico Blvd, Los Angeles)`,
      `Promo Code:      ${data.promoCode || 'None'}`,
      ``,
      `ITEMS REQUESTED (${data.itemCount} items, Total: $${Number(data.total).toFixed(2)}):`,
      itemsText,
      ``,
      data.comments ? `Special Requests / Questions:\n"${data.comments}"\n` : '',
      `Please contact the customer to confirm final details, availability, and payment before pickup.`,
    ].filter(Boolean).join('\n'),
  });
}

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
