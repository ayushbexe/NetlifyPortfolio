// Shared contact-form logic, used by server.js for local development. The live site uses worker/index.js on Cloudflare.
const nodemailer = require('nodemailer');

const INBOX = 'ayush@ayushbthecreator.com';

const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// Simple in-memory rate limit: max 5 messages per IP per hour.
// On Netlify this only lasts as long as one warm function instance, so it is a speed bump, not a guarantee.
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

let transporter;
function getTransporter(pass) {
    if (!transporter) {
        transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: INBOX, pass } });
    }
    return transporter;
}

// Returns { status, body } so any server can send it.
async function handleContact(body, ip) {
    body = body || {};

    // Honeypot field: real visitors never see it, so a value means a bot. Pretend success.
    if (body.website) return { status: 200, body: { success: true } };

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!name || !email || !message) {
        return { status: 400, body: { success: false, error: 'All fields are required.' } };
    }
    if (name.length > 100 || email.length > 200 || message.length > 5000) {
        return { status: 400, body: { success: false, error: 'One of the fields is too long.' } };
    }
    if (!EMAIL_RE.test(email)) {
        return { status: 400, body: { success: false, error: 'Please enter a valid email address.' } };
    }
    if (rateLimited(ip || 'unknown')) {
        return { status: 429, body: { success: false, error: 'Too many messages. Please try again later or email me directly.' } };
    }

    // Gmail App Password comes only from the EMAIL_PASS environment variable. Never hard-code it.
    const pass = process.env.EMAIL_PASS;
    if (!pass) {
        console.warn('[warn] EMAIL_PASS is not set - cannot send contact form email.');
        return { status: 503, body: { success: false, error: `The contact form is not set up yet. Please email ${INBOX} directly.` } };
    }

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

    try {
        await getTransporter(pass).sendMail({
            // Gmail only sends as the authenticated account; the visitor goes in Reply-To.
            from: `"Portfolio Contact Form" <${INBOX}>`,
            to: INBOX,
            replyTo: { name, address: email },
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
            `
        });
        return { status: 200, body: { success: true, message: 'Email sent successfully!' } };
    } catch (error) {
        console.error('Error sending email:', error);
        return { status: 500, body: { success: false, error: 'Failed to send email. Please try again later or email me directly.' } };
    }
}

module.exports = { handleContact };
