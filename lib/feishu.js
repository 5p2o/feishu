'use strict';

const crypto = require('node:crypto');

const API_ORIGIN = 'https://open.feishu.cn/open-apis';

// tenant_access_token 缓存在模块作用域，同一个云函数实例内的多次调用可复用。
const tokenCache = new Map();

// 飞书在 token 失效/过期时返回的业务错误码（HTTP 状态码仍是 200）。
const AUTH_ERROR_CODES = new Set([99991661, 99991663, 99991664, 99991668, 99991671, 99991672]);

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

function clearTokenCache() {
  tokenCache.clear();
}

async function requestJson(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { status: response.status, ok: response.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

function isAuthError(result) {
  if (!result) return false;
  if (result.status === 401 || result.status === 403) return true;
  return AUTH_ERROR_CODES.has(result.data && result.data.code);
}

function isApiError(result) {
  if (!result) return true;
  if (!result.ok) return true;
  return Boolean(result.data && result.data.code);
}

function describeError(result) {
  if (!result) return 'unknown error';
  const data = result.data || {};
  return 'http=' + result.status + ' code=' + (data.code ?? 'n/a') + ' msg=' + (data.msg || data.message || '');
}

async function getTenantAccessToken({ fetchImpl, appId, appSecret, timeoutMs = 8000 }) {
  const cached = tokenCache.get(appId);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const result = await requestJson(
    fetchImpl,
    API_ORIGIN + '/auth/v3/tenant_access_token/internal/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
    timeoutMs
  );

  const token = result.data && result.data.tenant_access_token;
  if (!token) {
    throw new Error('获取 tenant_access_token 失败: ' + describeError(result));
  }

  const expireMs = (Number(result.data.expire) || 7200) * 1000;
  const ttlMs = Math.max(expireMs - TOKEN_REFRESH_MARGIN_MS, Math.floor(expireMs * 0.1));
  tokenCache.set(appId, { token, expiresAt: Date.now() + ttlMs });
  return token;
}

async function refreshTenantAccessToken(credentials) {
  tokenCache.delete(credentials.appId);
  return getTenantAccessToken(credentials);
}

async function sendMessage({ fetchImpl, token, receiveId, receiveIdType = 'chat_id', msgType, content, uuid, timeoutMs = 8000 }) {
  const url = API_ORIGIN + '/im/v1/messages?receive_id_type=' + encodeURIComponent(receiveIdType);
  const payload = { receive_id: receiveId, msg_type: msgType, content };
  // uuid 用于幂等：同一条源消息重推时飞书只会投递一次（有效期 1 小时）。
  if (uuid) payload.uuid = uuid;

  return requestJson(
    fetchImpl,
    url,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );
}

async function fetchUserName({ fetchImpl, token, openId, timeoutMs = 5000 }) {
  const url = API_ORIGIN + '/contact/v3/users/' + encodeURIComponent(openId) + '?user_id_type=open_id';
  const result = await requestJson(fetchImpl, url, { method: 'GET', headers: { Authorization: 'Bearer ' + token } }, timeoutMs);
  const user = result.data && result.data.data && result.data.data.user;
  return (user && user.name) || '';
}

async function listChats({ fetchImpl, token, pageSize = 100 }) {
  const chats = [];
  let pageToken = '';
  for (let page = 0; page < 20; page += 1) {
    const url =
      API_ORIGIN +
      '/im/v1/chats?page_size=' +
      pageSize +
      (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '');
    const result = await requestJson(fetchImpl, url, { method: 'GET', headers: { Authorization: 'Bearer ' + token } }, 10000);
    if (isApiError(result)) throw new Error('获取群列表失败: ' + describeError(result));
    const data = result.data.data || {};
    for (const chat of data.items || []) chats.push(chat);
    if (!result.data.data || !result.data.data.has_more || !result.data.data.page_token) break;
    pageToken = result.data.data.page_token;
  }
  return chats;
}

// 飞书官方加解密方案：AES-256-CBC，密钥为 Encrypt Key 的 SHA-256，
// 前 16 字节为 IV，密文使用 PKCS#7 填充。
function decryptEvent(encryptKey, encrypted) {
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const buffer = Buffer.from(encrypted, 'base64');
  if (buffer.length <= 16) throw new Error('加密内容长度异常');

  const iv = buffer.subarray(0, 16);
  const cipherText = buffer.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);

  const pad = decrypted[decrypted.length - 1];
  const plain = pad > 0 && pad <= 16 ? decrypted.subarray(0, decrypted.length - pad) : decrypted;
  return JSON.parse(plain.toString('utf8'));
}

function encryptEvent(encryptKey, payload) {
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

module.exports = {
  API_ORIGIN,
  AUTH_ERROR_CODES,
  clearTokenCache,
  getTenantAccessToken,
  refreshTenantAccessToken,
  sendMessage,
  fetchUserName,
  listChats,
  decryptEvent,
  encryptEvent,
  isApiError,
  isAuthError,
  describeError,
};
