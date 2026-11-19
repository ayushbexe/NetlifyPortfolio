// Local development server: `npm start`, then open http://localhost:3000.
// The live site runs on Netlify instead (see netlify.toml and netlify/functions/send-email.js).
const express = require('express');
const path = require('path');
const { handleContact } = require('./lib/contact');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.EMAIL_PASS) {
    console.warn('[warn] EMAIL_PASS is not set - the contact form will return an error until it is.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// Only serve the public site files - never server.js, package.json, node_modules or backups.
app.use('/Assets', express.static(path.join(__dirname, 'Assets'), { maxAge: '7d' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/send-email', async (req, res) => {
    const { status, body } = await handleContact(req.body, req.ip);
    res.status(status).json(body);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
