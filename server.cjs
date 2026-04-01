/**
 * XCP Tools server — static file serving + payment verification
 * Stores claimed payments + upload data in data.json
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3007;
const DATA_FILE = path.join(__dirname, 'data.json');
const PAYMENT_ADDRESS = 'bc1q0wv2d260yge8ravt7mqcjhvmu7wwp0de4yvt40';
const PAYMENT_SATS = 1984;
const ACME_API = 'http://127.0.0.1:3333';

// ── Data persistence ──

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { claimed_txids: {}, sessions: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Mempool.space fetch ──

function fetchJson(fetchUrl) {
  return new Promise((resolve, reject) => {
    const mod = fetchUrl.startsWith('https') ? https : http;
    const req = mod.get(fetchUrl, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 404) return reject(new Error('not_found'));
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Proxy to ACME API ──

function proxyToAcme(req, res) {
  const targetPath = '/v2' + req.url.replace(/^\/api/, '');
  const targetUrl = ACME_API + targetPath;

  const opts = url.parse(targetUrl);
  opts.method = req.method;
  opts.headers = { ...req.headers, host: 'localhost:3333' };
  delete opts.headers['host'];

  const proxy = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxy.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error: ' + e.message }));
  });
  req.pipe(proxy);
}

// ── Static file serving ──

const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'public', 'index.html');
  }
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── Payment verification ──

async function handleVerifyPayment(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { txid, session_data } = JSON.parse(body);

      if (!txid || txid.length !== 64 || !/^[a-fA-F0-9]+$/.test(txid)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid TXID format' }));
        return;
      }

      const data = loadData();

      // Check if already claimed
      if (data.claimed_txids[txid]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'This payment has already been claimed' }));
        return;
      }

      // Fetch TX from mempool.space (mainnet)
      let tx;
      try {
        tx = await fetchJson(`https://mempool.space/api/tx/${txid}`);
      } catch (e) {
        if (e.message === 'not_found') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Transaction not found in mempool or blockchain' }));
          return;
        }
        throw e;
      }

      // Verify output
      const validOutput = (tx.vout || []).some(o =>
        o.scriptpubkey_address === PAYMENT_ADDRESS && o.value >= PAYMENT_SATS
      );

      if (!validOutput) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `TX does not contain payment of ${PAYMENT_SATS} sats to ${PAYMENT_ADDRESS}`
        }));
        return;
      }

      // Claim it — store TXID + session data (uploads, JSON, etc)
      data.claimed_txids[txid] = {
        claimed_at: new Date().toISOString(),
        session_data: session_data || null,
      };
      data.sessions.push({
        txid,
        claimed_at: new Date().toISOString(),
        ...session_data,
      });
      saveData(data);

      console.log(`[XCP Tools] Payment verified: ${txid}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ verified: true, txid }));

    } catch (e) {
      console.error('[XCP Tools] verify-payment error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error: ' + e.message }));
    }
  });
}

// ── Server ──

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/verify-payment' && req.method === 'POST') {
    handleVerifyPayment(req, res);
  } else if (req.url.startsWith('/api/')) {
    proxyToAcme(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`[XCP Tools] Server running on http://localhost:${PORT}`);
  console.log(`[XCP Tools] Payment address: ${PAYMENT_ADDRESS}`);
  console.log(`[XCP Tools] Payment amount: ${PAYMENT_SATS} sats`);
  console.log(`[XCP Tools] Data file: ${DATA_FILE}`);
});
