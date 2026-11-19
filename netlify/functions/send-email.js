// Netlify Function for the contact form. netlify.toml routes POST /send-email here.
// Set EMAIL_PASS (Gmail App Password) in Netlify: Site configuration > Environment variables.
const { handleContact } = require('../../lib/contact');

exports.handler = async (event) => {
    const headers = { 'Content-Type': 'application/json' };
    const reply = (status, body) => ({ statusCode: status, headers, body: JSON.stringify(body) });

    if (event.httpMethod !== 'POST') {
        return reply(405, { success: false, error: 'Method not allowed.' });
    }

    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    if (raw.length > 20 * 1024) {
        return reply(413, { success: false, error: 'Message is too large.' });
    }

    let body;
    try {
        body = JSON.parse(raw || '{}');
    } catch {
        return reply(400, { success: false, error: 'Invalid request.' });
    }

    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
    const { status, body: out } = await handleContact(body, ip);
    return reply(status, out);
};
