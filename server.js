const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
if (req.method === 'POST' && req.url === '/telegram') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      handleTelegramMessage(JSON.parse(body));
      res.writeHead(200); res.end('OK');
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/claude') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const options = {
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const pr = https.request(options, pres => {
        res.writeHead(pres.statusCode, { 'Content-Type': 'application/json' });
        pres.pipe(res);
      });
      pr.on('error', e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      pr.write(body); pr.end();
    });
    return;
  }

  const filePath = path.join(__dirname, req.url === '/' ? 'cashflow_with_ai.html' : req.url.split('?')[0]);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' }[path.extname(filePath)] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});
// Telegram Bot
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const RENDER_URL = process.env.RENDER_URL || '';

async function setTelegramWebhook() {
  if (!TELEGRAM_TOKEN || !RENDER_URL) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${RENDER_URL}/telegram`;
  https.get(url, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log('Telegram webhook:', data));
  });
}

async function handleTelegramMessage(body) {
  const message = body.message;
  if (!message || !message.text) return;
  const chatId = message.chat.id;
  const text = message.text;

  const systemPrompt = `אתה יועץ כלכלי לעסק קטן. ענה בעברית, קצר וממוקד.`;

  let reply = '';
  try {
    const postData = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }]
    });
    reply = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || 'שגיאה');
        });
      });
      req.on('error', reject);
      req.write(postData); req.end();
    });
  } catch(e) { reply = 'שגיאה בעיבוד הבקשה'; }

  const sendUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const sendData = JSON.stringify({ chat_id: chatId, text: reply });
  const sendOptions = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(sendData) }
  };
  const sendReq = https.request(sendOptions);
  sendReq.write(sendData); sendReq.end();
}
server.listen(PORT, () => {
  setTelegramWebhook();
  console.log('✓ שרת רץ על http://localhost:' + PORT);
  if (!API_KEY) console.log('⚠  ANTHROPIC_API_KEY לא מוגדר!');
  else console.log('✓ API Key מוגדר');
});
