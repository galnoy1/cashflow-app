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
  const text = message.text.trim();

  // פקודות הזנת נתונים
  // הכנסה: /income 1000 לקוח ABC
  if (text.startsWith('/income')) {
    const parts = text.split(' ');
    const amount = parseFloat(parts[1]);
    const source = parts.slice(2).join(' ') || 'לקוח';
    if (!amount) { sendTelegram(chatId, 'פורמט: /income סכום מקור\nלמשל: /income 1500 לקוח ABC'); return; }
    await addToGoogleDrive('income', amount, source);
    sendTelegram(chatId, `✅ הכנסה נרשמה!\n💰 ${source}: ₪${amount.toLocaleString('he-IL')}`);
    return;
  }

  // הוצאה: /expense 500 ספק חומרים
  if (text.startsWith('/expense')) {
    const parts = text.split(' ');
    const amount = parseFloat(parts[1]);
    const vendor = parts.slice(2).join(' ') || 'הוצאה';
    if (!amount) { sendTelegram(chatId, 'פורמט: /expense סכום תיאור\nלמשל: /expense 500 ספק חומרים'); return; }
    await addToGoogleDrive('expense', amount, vendor);
    sendTelegram(chatId, `✅ הוצאה נרשמה!\n💸 ${vendor}: ₪${amount.toLocaleString('he-IL')}`);
    return;
  }

  // סיכום: /summary
  if (text === '/summary') {
    const summary = await getGoogleDriveSummary();
    sendTelegram(chatId, summary);
    return;
  }

  // עזרה: /help
  if (text === '/help' || text === '/start') {
    sendTelegram(chatId, `שלום! אני יועץ התזרים שלך 💼\n\nפקודות:\n/income 1500 לקוח ABC — רשום הכנסה\n/expense 500 ספק — רשום הוצאה\n/summary — סיכום תזרים\n\nאו שאל כל שאלה חופשית!`);
    return;
  }

  // שאלה חופשית — AI
  const systemPrompt = `אתה יועץ כלכלי לעסק קטן. ענה בעברית, קצר וממוקד. עד 3 משפטים.`;
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
  sendTelegram(chatId, reply);
}

function sendTelegram(chatId, text) {
  const sendData = JSON.stringify({ chat_id: chatId, text });
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(sendData) }
  };
  const req = https.request(options);
  req.write(sendData); req.end();
}

async function addToGoogleDrive(type, amount, source) {
  const DRIVE_URL = process.env.DRIVE_URL || '';
  const DRIVE_TOKEN = process.env.DRIVE_TOKEN || '';
  if (!DRIVE_URL || !DRIVE_TOKEN) return;
  
  const postData = JSON.stringify({ token: DRIVE_TOKEN, action: 'add', type, amount, source });
  return new Promise((resolve) => {
    const url = new URL(DRIVE_URL);
    const options = {
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options, res => {
      res.on('data', () => {}); res.on('end', resolve);
    });
    req.on('error', resolve);
    req.write(postData); req.end();
  });
}

async function getGoogleDriveSummary() {
  const DRIVE_URL = process.env.DRIVE_URL || '';
  const DRIVE_TOKEN = process.env.DRIVE_TOKEN || '';
  if (!DRIVE_URL || !DRIVE_TOKEN) return 'גיבוי לא מוגדר';
  
  return new Promise((resolve) => {
    const url = new URL(DRIVE_URL + '?token=' + encodeURIComponent(DRIVE_TOKEN));
    https.get(url.href, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.ok) { resolve('אין נתונים שמורים עדיין'); return; }
          const state = JSON.parse(parsed.payload);
          const inc = state.income.reduce((s,i) => s+i.amount, 0);
          const exp = state.expenses.reduce((s,e) => s+e.amount, 0);
          const bal = (state.balance||0) + inc - exp;
          resolve(`📊 סיכום תזרים:\n💰 הכנסות: ₪${Math.round(inc).toLocaleString('he-IL')}\n💸 הוצאות: ₪${Math.round(exp).toLocaleString('he-IL')}\n📈 רווח: ₪${Math.round(inc-exp).toLocaleString('he-IL')}\n🏦 יתרה: ₪${Math.round(bal).toLocaleString('he-IL')}`);
        } catch(e) { resolve('שגיאה בטעינת נתונים'); }
      });
    }).on('error', () => resolve('שגיאת חיבור'));
  });
}
  console.log('✓ שרת רץ על http://localhost:' + PORT);
  if (!API_KEY) console.log('⚠  ANTHROPIC_API_KEY לא מוגדר!');
  else console.log('✓ API Key מוגדר');
});
