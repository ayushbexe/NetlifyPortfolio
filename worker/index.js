// Cloudflare Worker for www.ayushbthecreator.com.
// - Redirects the bare domain to www.
// - Handles the contact form (POST /send-email) by sending mail through Resend.
// - Serves everything else from the static assets (index.html and Assets/).

const SITE_HOST = 'www.ayushbthecreator.com';
const INBOX = 'ayush@ayushbthecreator.com';
// Must be on a domain verified in Resend.
const FROM = 'Portfolio Contact Form <contact@ayushbthecreator.com>';

const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// In-memory rate limit: max 5 messages per IP per hour.
// It only lasts as long as one Worker instance, so it is a speed bump, not a guarantee.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 5;
const hits = new Map();
function rateLimited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) {
        for (const [k, times] of hits) {
            if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
        }
    }
    return recent.length > RATE_MAX;
}

const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function handleContact(request, env) {
    let body;
    try {
        if (Number(request.headers.get('Content-Length') || 0) > 20000) throw new Error('too large');
        body = await request.json();
    } catch {
        return json(400, { success: false, error: 'Invalid request.' });
    }
    body = body && typeof body === 'object' ? body : {};

    // Honeypot field: real visitors never see it, so a value means a bot. Pretend success.
    if (body.website) return json(200, { success: true });

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!name || !email || !message) {
        return json(400, { success: false, error: 'All fields are required.' });
    }
    if (name.length > 100 || email.length > 200 || message.length > 5000) {
        return json(400, { success: false, error: 'One of the fields is too long.' });
    }
    if (!EMAIL_RE.test(email)) {
        return json(400, { success: false, error: 'Please enter a valid email address.' });
    }
    if (rateLimited(request.headers.get('CF-Connecting-IP') || 'unknown')) {
        return json(429, { success: false, error: 'Too many messages. Please try again later or email me directly.' });
    }

    // The Resend API key is a Worker secret. Never hard-code it.
    if (!env.RESEND_API_KEY) {
        console.warn('RESEND_API_KEY is not set - cannot send contact form email.');
        return json(503, { success: false, error: `The contact form is not set up yet. Please email ${INBOX} directly.` });
    }

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: FROM,
                to: [INBOX],
                reply_to: email,
                subject: `New Portfolio Message from ${name.replace(/[\r\n]+/g, ' ')}`,
                text: `You have received a new message from your portfolio contact form.\n\nName: ${name}\nEmail: ${email}\nMessage:\n${message}`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; background: #0a0a0a; color: #f3f4f6; border-radius: 10px;">
                        <h2 style="color: #39FF14;">New Portfolio Message</h2>
                        <p><strong>Name:</strong> ${safeName}</p>
                        <p><strong>Email:</strong> ${safeEmail}</p>
                        <p><strong>Message:</strong></p>
                        <p style="background: #121212; padding: 15px; border-radius: 5px; border-left: 4px solid #39FF14;">${safeMessage}</p>
                    </div>
                `,
            }),
        });
        if (!res.ok) {
            console.error('Resend error', res.status, await res.text());
            return json(500, { success: false, error: 'Failed to send email. Please try again later or email me directly.' });
        }
        return json(200, { success: true, message: 'Email sent successfully!' });
    } catch (error) {
        console.error('Error sending email:', error);
        return json(500, { success: false, error: 'Failed to send email. Please try again later or email me directly.' });
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Bare domain -> www, keeping the path and query.
        if (url.hostname === 'ayushbthecreator.com') {
            url.hostname = SITE_HOST;
            url.protocol = 'https:';
            return Response.redirect(url.toString(), 301);
        }

        if (url.pathname === '/send-email') {
            if (request.method !== 'POST') return json(405, { success: false, error: 'Method not allowed.' });
            return handleContact(request, env);
        }

        const assetRes = await env.ASSETS.fetch(request);
        const res = new Response(assetRes.body, assetRes);
        res.headers.set('X-Content-Type-Options', 'nosniff');
        res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        if (url.pathname.startsWith('/Assets/') && res.ok) {
            res.headers.set('Cache-Control', 'public, max-age=604800');
        }
        return res;
    },
};
