'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const { ExpenseService, CATEGORIES } = require('./service');
const { SPLIT_TYPES } = require('./split');
const { AppError } = require('./errors');

const MAX_BODY_BYTES = 100 * 1024;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (tooLarge) return; // keep draining the socket but stop buffering
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large', 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new AppError('INVALID_JSON', 'Request body must be a JSON object', 400));
        }
        resolve(parsed);
      } catch {
        reject(new AppError('INVALID_JSON', 'Request body is not valid JSON', 400));
      }
    });
    req.on('error', reject);
  });
}

/** Build the route table. Each route: method, regex for the path, handler(service, params, body). */
function buildRoutes() {
  const route = (method, pattern, handler, status = 200) => ({
    method,
    regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
    handler,
    status,
  });
  return [
    route('GET', '/api/health', () => ({ status: 'ok' })),
    route('GET', '/api/meta', () => ({ splitTypes: SPLIT_TYPES, categories: CATEGORIES })),
    route('POST', '/api/groups', (s, p, b) => s.createGroup(b), 201),
    route('GET', '/api/groups/:gid', (s, p) => s.getGroup(p.gid)),
    route('POST', '/api/groups/:gid/members', (s, p, b) => s.addMember(p.gid, b.name), 201),
    route('GET', '/api/groups/:gid/expenses', (s, p) => s.listExpenses(p.gid)),
    route('POST', '/api/groups/:gid/expenses', (s, p, b) => s.addExpense(p.gid, b), 201),
    route('DELETE', '/api/groups/:gid/expenses/:eid', (s, p) => s.deleteExpense(p.gid, p.eid)),
    route('GET', '/api/groups/:gid/settlements', (s, p) => s.listSettlements(p.gid)),
    route('POST', '/api/groups/:gid/settlements', (s, p, b) => s.addSettlement(p.gid, b), 201),
    route('GET', '/api/groups/:gid/balances', (s, p) => s.getBalances(p.gid)),
  ];
}

/**
 * Create the HTTP server. Pass an existing service (e.g. with an in-memory DB for tests).
 */
function createServer(service) {
  const routes = buildRoutes();

  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');

      if (!pathname.startsWith('/api/')) {
        if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
          const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(html);
        }
        return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
      }

      const matching = routes.filter((r) => r.regex.test(pathname));
      if (matching.length === 0) {
        return send(res, 404, { error: { code: 'NOT_FOUND', message: 'No such endpoint' } });
      }
      const match = matching.find((r) => r.method === req.method);
      if (!match) {
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} is not allowed here` } });
      }

      const params = pathname.match(match.regex).groups || {};
      const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : {};
      const result = match.handler(service, params, body);
      return send(res, match.status, result);
    } catch (err) {
      if (err instanceof AppError) {
        return send(res, err.status, { error: { code: err.code, message: err.message } });
      }
      console.error(err);
      return send(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'expense-splitter.db');
  const service = new ExpenseService(openDb(dbPath));
  createServer(service).listen(port, () => {
    console.log(`Expense Splitter running at http://localhost:${port}`);
  });
}

module.exports = { createServer };
