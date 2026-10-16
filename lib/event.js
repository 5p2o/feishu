'use strict';

const { decryptEvent } = require('./feishu');

function toPlainObject(rawBody) {
  if (!rawBody) return {};
  if (Buffer.isBuffer(rawBody)) rawBody = rawBody.toString('utf8');
  if (typeof rawBody === 'string') {
    const trimmed = rawBody.trim();
    if (!trimmed) return {};
    return JSON.parse(trimmed);
  }
  if (typeof rawBody === 'object') return rawBody;
  throw new Error('无法识别的请求体类型');
}

// 飞书开启 Encrypt Key 后，回调体为 { encrypt: 'base64(AES-256-CBC)' }，
// 解密成功即证明请求来自持有该密钥的飞书服务器。
function parseEventPayload(rawBody, encryptKey) {
  const body = toPlainObject(rawBody);
  if (!body.encrypt) return body;
  if (!encryptKey) {
    throw new Error('收到加密事件，但未配置 FEISHU_ENCRYPT_KEY');
  }
  return decryptEvent(encryptKey, body.encrypt);
}

// 事件 v2.0 的 token 在 header 里，url_verification 的 token 在顶层。
function readVerificationToken(body) {
  if (!body) return '';
  if (body.header && typeof body.header.token === 'string') return body.header.token;
  if (typeof body.token === 'string') return body.token;
  return '';
}

function isChallengeRequest(body) {
  return Boolean(body) && body.type === 'url_verification';
}

function checkVerificationToken(body, config) {
  if (!config.verificationToken) return { ok: true, reason: 'not_configured' };
  const token = readVerificationToken(body);
  if (!token) return { ok: true, reason: 'token_absent' };
  if (token === config.verificationToken) return { ok: true, reason: 'matched' };
  return { ok: false, reason: 'mismatched' };
}

module.exports = {
  parseEventPayload,
  readVerificationToken,
  isChallengeRequest,
  checkVerificationToken,
};
