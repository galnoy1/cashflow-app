const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const RENDER_URL = process.env.RENDER_URL || '';
const DRIVE_URL = process.env.DRIVE_URL || '';
const DRIVE_TOKEN = process.env.DRIVE_TOKEN || '';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'POST' && req.url === '/telegram') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { handleTelegramMessage(JSON.parse(body)); } catch(e) {}
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
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(filePath)] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('שרת רץ על http://localhost:' + PORT);
  if (!API_KEY) console.log('ANTHROPIC_API_KEY לא מוגדר!');
  else console.log('API Key מוגדר');
  setTelegramWebhook();
});

function setTelegramWebhook() {
  if (!TELEGRAM_TOKEN || !RENDER_URL) return;
  const url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/setWebhook?url=' + RENDER_URL + '/telegram';
  https.get(url, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log('Telegram webhook:', data));
  });
}

function sendTelegram(chatId, text) {
  const sendData = JSON.stringify({ chat_id: chatId, text: text });
  const options = {
    hostname: 'api.telegram.org',
    path: '/bot' + TELEGRAM_TOKEN + '/sendMessage',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(sendData) }
  };
  const req = https.request(options, res => { res.resume(); });
  req.on('error', function() {});
  req.write(sendData);
  req.end();
}

async function addToDrive(type, amount, source) {
  if (!DRIVE_URL || !DRIVE_TOKEN) return false;
  const postData = JSON.stringify({ token: DRIVE_TOKEN, action: 'add', type: type, amount: amount, source: source });
  return new Promise(function(resolve) {
    const url = new URL(DRIVE_URL);
    const options = {
      hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(data).ok); } catch(e) { resolve(false); }
      });
    });
    req.on('error', function() { resolve(false); });
    req.write(postData);
    req.end();
  });
}

async function getSummaryFromDrive() {
  if (!DRIVE_URL || !DRIVE_TOKEN) return 'גיבוי לא מוגדר';
  return new Promise(function(resolve) {
    const fullUrl = DRIVE_URL + '?token=' + encodeURIComponent(DRIVE_TOKEN);
    https.get(fullUrl, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.ok) { resolve('אין נתונים שמורים עדיין'); return; }
          const state = JSON.parse(parsed.payload);
          const inc = (state.income || []).reduce(function(s, i) { return s + i.amount; }, 0);
          const exp = (state.expenses || []).reduce(function(s, e) { return s + e.amount; }, 0);
          const bal = (state.balance || 0) + inc - exp;
          const pending = (state.income || []).filter(function(i) { return i.status === 'pending'; }).reduce(function(s, i) { return s + i.amount; }, 0);
          let msg = 'סיכום תזרים:\n';
          msg += 'הכנסות: ' + Math.round(inc).toLocaleString('he-IL') + ' ₪\n';
          msg += 'הוצאות: ' + Math.round(exp).toLocaleString('he-IL') + ' ₪\n';
          msg += 'רווח: ' + Math.round(inc - exp).toLocaleString('he-IL') + ' ₪\n';
          msg += 'יתרה: ' + Math.round(bal).toLocaleString('he-IL') + ' ₪';
          if (pending > 0) msg += '\nממתין לגבייה: ' + Math.round(pending).toLocaleString('he-IL') + ' ₪';
          resolve(msg);
        } catch(e) { resolve('שגיאה בטעינת נתונים'); }
      });
    }).on('error', function() { resolve('שגיאת חיבור לדרייב'); });
  });
}

async function askClaude(question) {
  const postData = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: 'אתה יועץ כלכלי לעסקים קטנים בישראל. ענה בעברית, קצר וממוקד. עד 3 משפטים.',
    messages: [{ role: 'user', content: question }]
  });
  return new Promise(function(resolve) {
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content && parsed.content[0] ? parsed.content[0].text : 'שגיאה');
        } catch(e) { resolve('שגיאה בעיבוד התשובה'); }
      });
    });
    req.on('error', function() { resolve('שגיאת חיבור'); });
    req.write(postData);
    req.end();
  });
}

async function handleTelegramMessage(body) {
  const message = body.message;
  if (!message || !message.text) return;
  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text === '/start' || text === '/help') {
    sendTelegram(chatId,
      'שלום! אני יועץ התזרים שלך\n\n' +
      'פקודות:\n' +
      '/income 1500 לקוח ABC - רשום הכנסה\n' +
      '/expense 500 ספק חומרים - רשום הוצאה\n' +
      '/summary - סיכום תזרים\n\n' +
      'או שאל כל שאלה חופשית!'
    );
    return;
  }

  if (text.startsWith('/income ')) {
    const rest = text.substring(8).trim();
    const parts = rest.split(' ');
    const amount = parseFloat(parts[0]);
    const source = parts.slice(1).join(' ') || 'לקוח';
    if (!amount || isNaN(amount)) {
      sendTelegram(chatId, 'פורמט: /income סכום מקור\nלמשל: /income 1500 לקוח ABC');
      return;
    }
    const ok = await addToDrive('income', amount, source);
    sendTelegram(chatId, ok ? 'הכנסה נרשמה! ' + source + ': ' + amount.toLocaleString('he-IL') + ' ₪' : 'שגיאה ברישום - בדוק חיבור גיבוי');
    return;
  }

  if (text.startsWith('/expense ')) {
    const rest = text.substring(9).trim();
    const parts = rest.split(' ');
    const amount = parseFloat(parts[0]);
    const vendor = parts.slice(1).join(' ') || 'הוצאה';
    if (!amount || isNaN(amount)) {
      sendTelegram(chatId, 'פורמט: /expense סכום תיאור\nלמשל: /expense 500 ספק חומרים');
      return;
    }
    const ok = await addToDrive('expense', amount, vendor);
    sendTelegram(chatId, ok ? 'הוצאה נרשמה! ' + vendor + ': ' + amount.toLocaleString('he-IL') + ' ₪' : 'שגיאה ברישום - בדוק חיבור גיבוי');
    return;
  }

  if (text === '/summary') {
    const summary = await getSummaryFromDrive();
    sendTelegram(chatId, summary);
    return;
  }

  const reply = await askClaude(text);
  sendTelegram(chatId, reply);
}
