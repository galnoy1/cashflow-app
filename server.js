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
      try { handleTelegramMessage(JSON.parse(body)); } catch(e) { console.log('Telegram error:', e.message); }
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
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) }
      };
      const pr = https.request(options, pres => { res.writeHead(pres.statusCode, { 'Content-Type': 'application/json' }); pres.pipe(res); });
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
  https.get(url, res => { let d=''; res.on('data', c => d+=c); res.on('end', () => console.log('Webhook:', d)); });
}

function sendTelegram(chatId, text) {
  const sendData = JSON.stringify({ chat_id: chatId, text: text });
  const options = { hostname: 'api.telegram.org', path: '/bot' + TELEGRAM_TOKEN + '/sendMessage', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(sendData) } };
  const req = https.request(options, res => { res.resume(); });
  req.on('error', () => {});
  req.write(sendData); req.end();
}

function sendTelegramWithButton(chatId, text, driveUrl) {
  const waText = driveUrl
    ? 'חשבונית חדשה: ' + driveUrl
    : 'חשבונית חדשה נרשמה בתזרים';
  const waUrl = 'https://wa.me/972553055098?text=' + encodeURIComponent(waText);
  const keyboard = {
    inline_keyboard: [[
      { text: '📤 העבר לרואה חשבון', url: waUrl }
    ]]
  };
  const sendData = JSON.stringify({
    chat_id: chatId,
    text: text,
    reply_markup: keyboard
  });
  const options = { hostname: 'api.telegram.org', path: '/bot' + TELEGRAM_TOKEN + '/sendMessage', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(sendData) } };
  const req = https.request(options, res => { res.resume(); });
  req.on('error', () => {});
  req.write(sendData); req.end();
}

function httpsGetFollow(urlStr) {
  return new Promise((resolve, reject) => {
    function doGet(u, redirects) {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const parsed = new URL(u);
      const options = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET', headers: { 'User-Agent': 'Node.js' } };
      https.request(options, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { doGet(res.headers.location, redirects + 1); return; }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject).end();
    }
    doGet(urlStr, 0);
  });
}

function httpsGetBinary(urlStr) {
  return new Promise((resolve, reject) => {
    function doGet(u, redirects) {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const parsed = new URL(u);
      https.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET' }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { doGet(res.headers.location, redirects + 1); return; }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject).end();
    }
    doGet(urlStr, 0);
  });
}

function httpsPostFollow(urlStr, postData) {
  return new Promise((resolve, reject) => {
    function doPost(u, redirects) {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const parsed = new URL(u);
      const options = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } };
      const req = https.request(options, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location; res.resume();
          httpsGetFollow(loc).then(resolve).catch(reject); return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(postData); req.end();
    }
    doPost(urlStr, 0);
  });
}

async function addToDrive(type, amount, source, cat, invoiceId, fileUrl) {
  if (!DRIVE_URL || !DRIVE_TOKEN) return false;
  try {
    const postData = JSON.stringify({ token: DRIVE_TOKEN, action: 'add', type, amount, source, cat, invoiceId: invoiceId || null, fileUrl: fileUrl || null });
    const result = await httpsPostFollow(DRIVE_URL, postData);
    const parsed = JSON.parse(result);
    if (parsed.duplicate) return 'duplicate';
    return parsed.ok === true;
  } catch(e) { console.log('addToDrive error:', e.message); return false; }
}

async function uploadImageToDrive(imageBuffer, mimeType, fileName) {
  if (!DRIVE_URL || !DRIVE_TOKEN) return null;
  try {
    const base64 = imageBuffer.toString('base64');
    const postData = JSON.stringify({ token: DRIVE_TOKEN, action: 'upload_image', imageBase64: base64, mimeType, fileName });
    const result = await httpsPostFollow(DRIVE_URL, postData);
    const parsed = JSON.parse(result);
    return parsed.ok ? { fileId: parsed.fileId, fileUrl: parsed.fileUrl } : null;
  } catch(e) { console.log('uploadImage error:', e.message); return null; }
}

async function getTelegramFileUrl(fileId) {
  const url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getFile?file_id=' + fileId;
  return new Promise(resolve => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok && parsed.result.file_path) {
            resolve('https://api.telegram.org/file/bot' + TELEGRAM_TOKEN + '/' + parsed.result.file_path);
          } else { resolve(null); }
        } catch(e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function analyzeImageWithClaude(imageBase64, mimeType) {
  const isPDF = mimeType === 'application/pdf';
  const sourceBlock = isPDF
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } };
  
  const postData = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: [
        sourceBlock,
        { type: 'text', text: 'נתח את המסמך הזה (חשבונית/קבלה/תעודת משלוח) וחלץ את המידע הבא בפורמט JSON בלבד ללא טקסט נוסף:\n{"type":"income"/"expense","amount":סכום_מספרי,"source":"שם_ספק_או_לקוח","cat":"קטגוריה","invoiceId":"מספר_חשבונית_אם_קיים","date":"תאריך_YYYY-MM-DD","description":"תיאור_קצר"}\nקטגוריות הכנסה: מכירות, שירותים, עמלות, אחר\nקטגוריות הוצאה: תקשורת, שכ"ד, מזון, ציוד, שיווק, רישיונות, שכר, אחר\nאם לא ברור אם הכנסה או הוצאה, הנח שהוצאה.\nאם הסכום כולל מע"מ, השתמש בסכום הכולל.' }
      ]
    }]
  });
  return new Promise(resolve => {
    const options = { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(postData) } };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content[0].text.replace(/```json|```/g, '').trim();
          resolve(JSON.parse(text));
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(postData); req.end();
  });
}

async function getStateFromDrive() {
  if (!DRIVE_URL || !DRIVE_TOKEN) return null;
  try {
    const fullUrl = DRIVE_URL + '?token=' + encodeURIComponent(DRIVE_TOKEN);
    const result = await httpsGetFollow(fullUrl);
    const parsed = JSON.parse(result);
    if (!parsed.ok) return null;
    return JSON.parse(parsed.payload);
  } catch(e) { return null; }
}

function buildSystemPromptFromState(state) {
  if (!state) return 'אתה יועץ כלכלי לעסקים קטנים בישראל. ענה בעברית, קצר וממוקד.';
  const inc = (state.income || []).filter(i => !i.status || i.status === 'received').reduce((s,i) => s+i.amount, 0);
  const exp = (state.expenses || []).reduce((s,e) => s+e.amount, 0);
  const bal = (state.balance || 0) + inc - exp;
  const pending = (state.income || []).filter(i => i.status === 'pending').reduce((s,i) => s+i.amount, 0);
  const cats = {};
  (state.expenses || []).forEach(e => { cats[e.cat] = (cats[e.cat]||0) + e.amount; });
  const topCat = Object.entries(cats).sort((a,b) => b[1]-a[1]).slice(0,3).map(([k,v]) => k+': ₪'+Math.round(v).toLocaleString('he-IL')).join(', ');
  const today = new Date();
  const upcoming = (state.expenses || []).filter(e => {
    if (e.type === 'variable' && e.chargeDate) { const diff = (new Date(e.chargeDate) - today) / 86400000; return diff >= 0 && diff <= 14; }
    if (e.type === 'fixed' && e.day) { const d1 = new Date(today.getFullYear(), today.getMonth(), e.day); const d = d1 >= today ? d1 : new Date(today.getFullYear(), today.getMonth()+1, e.day); return (d - today) / 86400000 <= 14; }
    return false;
  }).reduce((s,e) => s+e.amount, 0);
  return `אתה יועץ כלכלי מקצועי לעסקים קטנים בישראל. ענה בעברית, קצר וממוקד, עד 3 משפטים.\n\nנתוני העסק:\n- יתרה: ₪${Math.round(bal).toLocaleString('he-IL')}\n- הכנסות: ₪${Math.round(inc).toLocaleString('he-IL')}\n- הוצאות: ₪${Math.round(exp).toLocaleString('he-IL')}\n- רווח: ₪${Math.round(inc-exp).toLocaleString('he-IL')}\n- ממתין לגבייה: ₪${Math.round(pending).toLocaleString('he-IL')}\n- תשלומים ב-14 יום: ₪${Math.round(upcoming).toLocaleString('he-IL')}\n- קטגוריות עיקריות: ${topCat || 'אין עדיין'}`;
}

async function askClaude(question) {
  const state = await getStateFromDrive();
  const systemPrompt = buildSystemPromptFromState(state);
  const postData = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, system: systemPrompt, messages: [{ role: 'user', content: question }] });
  return new Promise(resolve => {
    const options = { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(postData) } };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data).content[0].text); } catch(e) { resolve('שגיאה'); } });
    });
    req.on('error', () => resolve('שגיאת חיבור'));
    req.write(postData); req.end();
  });
}

async function getSummaryFromDrive() {
  if (!DRIVE_URL || !DRIVE_TOKEN) return 'גיבוי לא מוגדר';
  try {
    const fullUrl = DRIVE_URL + '?token=' + encodeURIComponent(DRIVE_TOKEN);
    const result = await httpsGetFollow(fullUrl);
    const parsed = JSON.parse(result);
    if (!parsed.ok) return 'אין נתונים שמורים עדיין';
    const state = JSON.parse(parsed.payload);
    const inc = (state.income || []).reduce((s, i) => s + i.amount, 0);
    const exp = (state.expenses || []).reduce((s, e) => s + e.amount, 0);
    const bal = (state.balance || 0) + inc - exp;
    const pending = (state.income || []).filter(i => i.status === 'pending').reduce((s, i) => s + i.amount, 0);
    let msg = 'סיכום תזרים:\n';
    msg += 'הכנסות: ' + Math.round(inc).toLocaleString('he-IL') + ' ש"ח\n';
    msg += 'הוצאות: ' + Math.round(exp).toLocaleString('he-IL') + ' ש"ח\n';
    msg += 'רווח: ' + Math.round(inc - exp).toLocaleString('he-IL') + ' ש"ח\n';
    msg += 'יתרה: ' + Math.round(bal).toLocaleString('he-IL') + ' ש"ח';
    if (pending > 0) msg += '\nממתין לגבייה: ' + Math.round(pending).toLocaleString('he-IL') + ' ש"ח';
    return msg;
  } catch(e) { return 'שגיאה בטעינת נתונים: ' + e.message; }
}

async function handleTelegramMessage(body) {
  const message = body.message;
  if (!message) return;
  const chatId = message.chat.id;

  // טיפול בתמונה או PDF
  const supportedTypes = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','application/pdf'];
  const isDocument = message.document && supportedTypes.includes(message.document.mime_type);
  if (message.photo || isDocument) {
    sendTelegram(chatId, 'מנתח את המסמך...');
    try {
      let fileId, mimeType = 'image/jpeg', fileName = 'document.jpg';
      if (message.photo) {
        const photos = message.photo;
        fileId = photos[photos.length - 1].file_id;
      } else if (message.document) {
        fileId = message.document.file_id;
        mimeType = message.document.mime_type || 'image/jpeg';
        fileName = message.document.file_name || 'document.jpg';
      }
      const fileUrl = await getTelegramFileUrl(fileId);
      if (!fileUrl) { sendTelegram(chatId, 'שגיאה בהורדת הקובץ'); return; }
      const imageBuffer = await httpsGetBinary(fileUrl);
      const base64 = imageBuffer.toString('base64');
      const uploadResult = await uploadImageToDrive(imageBuffer, mimeType, fileName);
      const analysis = await analyzeImageWithClaude(base64, mimeType);
      if (!analysis || !analysis.amount) {
        sendTelegram(chatId, 'לא הצלחתי לזהות את פרטי המסמך. נסה לצלם בצורה ברורה יותר.');
        return;
      }
      const driveUrl = uploadResult ? uploadResult.fileUrl : null;
      const ok = await addToDrive(analysis.type, analysis.amount, analysis.source, analysis.cat, analysis.invoiceId, driveUrl);
      if (ok === 'duplicate') {
        sendTelegram(chatId, 'מסמך זה כבר נרשם! (מספר חשבונית: ' + analysis.invoiceId + ')');
        return;
      }
      const typeLabel = analysis.type === 'income' ? 'הכנסה' : 'הוצאה';
      let msg = 'המסמך נרשם!\n';
      msg += typeLabel + ': ' + analysis.amount.toLocaleString('he-IL') + ' ש"ח\n';
      msg += 'ספק/לקוח: ' + (analysis.source || 'לא זוהה') + '\n';
      msg += 'קטגוריה: ' + (analysis.cat || 'אחר') + '\n';
      if (analysis.invoiceId) msg += 'מספר חשבונית: ' + analysis.invoiceId + '\n';
      if (driveUrl) msg += 'נשמר בדרייב\n';
      sendTelegramWithButton(chatId, msg, driveUrl);
    } catch(e) {
      console.log('Image error:', e.message);
      sendTelegram(chatId, 'שגיאה בעיבוד התמונה: ' + e.message);
    }
    return;
  }

  if (!message.text) return;
  const text = message.text.trim();

  if (text === '/start' || text === '/help') {
    sendTelegram(chatId,
      'שלום! אני יועץ התזרים שלך\n\n' +
      'פקודות:\n' +
      '/income 1500 לקוח שירותים - הכנסה\n' +
      '/expense 500 פרטנר תקשורת - הוצאה\n' +
      '/summary - סיכום תזרים\n\n' +
      'שלח תמונה של חשבונית/קבלה - אנתח אוטומטית!\n\n' +
      'או שאל כל שאלה על העסק שלך!'
    );
    return;
  }

  if (text.startsWith('/income ')) {
    const parts = text.substring(8).trim().split(' ');
    const amount = parseFloat(parts[0]);
    if (!amount || isNaN(amount)) { sendTelegram(chatId, 'פורמט: /income סכום מקור קטגוריה\nלמשל: /income 1500 לקוח ABC שירותים'); return; }
    const incomeCategories = ['מכירות','שירותים','עמלות','שכירות','ריבית','אחר'];
    const lastWord = parts[parts.length-1];
    let cat = 'מכירות', source;
    if (parts.length > 2 && incomeCategories.includes(lastWord)) { cat = lastWord; source = parts.slice(1, -1).join(' ') || 'לקוח'; }
    else { source = parts.slice(1).join(' ') || 'לקוח'; }
    const ok = await addToDrive('income', amount, source, cat, null, null);
    sendTelegram(chatId, ok ? 'הכנסה נרשמה!\n' + source + ': ' + amount.toLocaleString('he-IL') + ' ש"ח\nקטגוריה: ' + cat : 'שגיאה ברישום');
    return;
  }

  if (text.startsWith('/expense ')) {
    const parts = text.substring(9).trim().split(' ');
    const amount = parseFloat(parts[0]);
    if (!amount || isNaN(amount)) { sendTelegram(chatId, 'פורמט: /expense סכום ספק קטגוריה\nלמשל: /expense 500 פרטנר תקשורת'); return; }
    const expenseCategories = ['תקשורת','שכ"ד','מזון','ציוד','שיווק','רישיונות','שכר','אחר'];
    const lastWord = parts[parts.length-1];
    let cat = 'אחר', vendor;
    if (parts.length > 2 && expenseCategories.includes(lastWord)) { cat = lastWord; vendor = parts.slice(1, -1).join(' ') || 'הוצאה'; }
    else { vendor = parts.slice(1).join(' ') || 'הוצאה'; }
    const ok = await addToDrive('expense', amount, vendor, cat, null, null);
    sendTelegram(chatId, ok ? 'הוצאה נרשמה!\n' + vendor + ': ' + amount.toLocaleString('he-IL') + ' ש"ח\nקטגוריה: ' + cat : 'שגיאה ברישום');
    return;
  }

  if (text === '/summary') {
    const summary = await getSummaryFromDrive();
    sendTelegram(chatId, summary);
    return;
  }

  // ניסיון לזהות הוראת רישום בשפה טבעית
  const parsed = await parseNaturalLanguage(text);
  if (parsed && parsed.action === 'register') {
    const ok = await addToDrive(parsed.type, parsed.amount, parsed.source, parsed.cat, null, null);
    if (ok === 'duplicate') {
      sendTelegram(chatId, 'רישום זה כבר קיים היום!');
    } else if (ok) {
      const typeLabel = parsed.type === 'income' ? 'הכנסה' : 'הוצאה';
      const msg = typeLabel + ' נרשמה!\n' + parsed.source + ': ' + parsed.amount.toLocaleString('he-IL') + ' ש"ח\nקטגוריה: ' + parsed.cat;
      sendTelegram(chatId, msg);
    } else {
      sendTelegram(chatId, 'שגיאה ברישום');
    }
    return;
  }

  // שאלה חופשית
  const reply = await askClaude(text);
  sendTelegram(chatId, reply);
}

async function parseNaturalLanguage(text) {
  const prompt = 'האם ההודעה הבאה היא בקשה לרשום הכנסה או הוצאה לתזרים עסקי? אם כן, חלץ את הפרטים. אם לא (שאלה, שיחה, פקודה אחרת), החזר null.\n\nהודעה: "' + text + '"\n\nענה רק ב-JSON ללא טקסט נוסף. אם רישום: {"action":"register","type":"income"/"expense","amount":סכום,"source":"ספק/לקוח","cat":"קטגוריה"} קטגוריות הוצאה: תקשורת/שכד/מזון/ציוד/שיווק/רישיונות/שכר/אחר. קטגוריות הכנסה: מכירות/שירותים/עמלות/שכירות/אחר. אם לא רישום: null';
  const postData = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }]
  });
  return new Promise(resolve => {
    const options = { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(postData) } };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const resp = JSON.parse(data);
          const txt = resp.content[0].text.replace(/```json|```/g,'').trim();
          if (txt === 'null') { resolve(null); return; }
          resolve(JSON.parse(txt));
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(postData); req.end();
  });
}
