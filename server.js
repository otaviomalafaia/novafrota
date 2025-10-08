#!/usr/bin/env node
/**
 * Simple GDPR-aware lead capture API for NovaFrota.
 *
 * Features:
 * - POST /api/leads       Save a lead (email + consent metadata)
 * - GET  /api/leads       Export stored leads (requires ADMIN_API_TOKEN)
 * - DELETE /api/leads/:id Delete a stored lead (requires ADMIN_API_TOKEN)
 *
 * Data is persisted in data/leads.json as an array of objects.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || '';

async function ensureDataStore() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.access(LEADS_FILE);
  } catch {
    await fs.writeFile(LEADS_FILE, '[]', 'utf8');
  }
}

async function readLeads() {
  await ensureDataStore();
  const raw = await fs.readFile(LEADS_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLeads(entries) {
  await ensureDataStore();
  const payload = JSON.stringify(entries, null, 2);
  await fs.writeFile(LEADS_FILE, payload, 'utf8');
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function sendNoContent(res, status = 204) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end();
}

function isAdminRequest(req) {
  if (!ADMIN_API_TOKEN) {
    return false;
  }
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return false;
  }
  const token = header.slice(7).trim();
  return token === ADMIN_API_TOKEN;
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function validateLead(payload) {
  const errors = [];
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const consent = payload.consent === true;
  const consentTimestamp = typeof payload.consentTimestamp === 'string' ? payload.consentTimestamp : '';
  const userAgent = typeof payload.userAgent === 'string' ? payload.userAgent : '';

  if (!email) {
    errors.push('Email é obrigatório.');
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.push('Email inválido.');
    }
  }

  if (!consent) {
    errors.push('O consentimento explícito é obrigatório.');
  }

  if (!consentTimestamp) {
    errors.push('Timestamp de consentimento é obrigatório.');
  }

  return {
    errors,
    lead: {
      id: crypto.randomUUID(),
      email,
      consent,
      consentTimestamp,
      userAgent,
      ipHash: null,
      collectedAt: new Date().toISOString(),
    },
  };
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

async function handlePostLead(req, res) {
  try {
    const body = await parseJsonBody(req);
    const { errors, lead } = validateLead(body);

    if (errors.length > 0) {
      sendJson(res, 400, { ok: false, errors });
      return;
    }

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '0.0.0.0';
    lead.ipHash = hashIp(ip);

    const leads = await readLeads();
    leads.push(lead);
    await writeLeads(leads);

    sendJson(res, 202, { ok: true, id: lead.id });
  } catch (error) {
    if (error.message === 'INVALID_JSON') {
      sendJson(res, 400, { ok: false, errors: ['JSON inválido.'] });
      return;
    }
    console.error('Erro ao guardar lead:', error);
    sendJson(res, 500, { ok: false, errors: ['Erro interno.'] });
  }
}

async function handleGetLeads(req, res) {
  if (!ADMIN_API_TOKEN) {
    sendJson(res, 503, { ok: false, error: 'ADMIN_API_TOKEN não definido no servidor.' });
    return;
  }

  if (!isAdminRequest(req)) {
    sendJson(res, 401, { ok: false, error: 'Não autorizado.' });
    return;
  }

  const leads = await readLeads();
  sendJson(res, 200, { ok: true, data: leads });
}

async function handleDeleteLead(req, res, id) {
  if (!ADMIN_API_TOKEN) {
    sendJson(res, 503, { ok: false, error: 'ADMIN_API_TOKEN não definido no servidor.' });
    return;
  }

  if (!isAdminRequest(req)) {
    sendJson(res, 401, { ok: false, error: 'Não autorizado.' });
    return;
  }

  const leads = await readLeads();
  const index = leads.findIndex((entry) => entry.id === id || entry.email === id);
  if (index === -1) {
    sendJson(res, 404, { ok: false, error: 'Registo não encontrado.' });
    return;
  }

  leads.splice(index, 1);
  await writeLeads(leads);
  sendNoContent(res, 204);
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (method === 'OPTIONS') {
    sendNoContent(res, 204);
    return;
  }

  if (url === '/api/leads' && method === 'POST') {
    await handlePostLead(req, res);
    return;
  }

  if (url === '/api/leads' && method === 'GET') {
    await handleGetLeads(req, res);
    return;
  }

  if (url?.startsWith('/api/leads/') && method === 'DELETE') {
    const id = decodeURIComponent(url.split('/').at(-1));
    await handleDeleteLead(req, res, id);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Rota não encontrada.' });
});

server.listen(PORT, HOST, () => {
  console.log(`NovaFrota API disponível em http://${HOST}:${PORT}`);
  if (!ADMIN_API_TOKEN) {
    console.warn('⚠️  ADMIN_API_TOKEN não definido. Operações administrativas serão bloqueadas.');
  }
});
