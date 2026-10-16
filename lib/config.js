'use strict';

const DEFAULT_FORWARD_TYPES = ['text', 'post', 'image', 'file', 'audio', 'media', 'sticker'];

function readString(env, name, fallback) {
  const raw = env[name];
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  return value || fallback;
}

function readList(env, name, fallback) {
  const raw = readString(env, name, '');
  if (!raw) return fallback;
  return raw
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBoolean(env, name, fallback) {
  const raw = readString(env, name, '');
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function readNumber(env, name, fallback) {
  const raw = readString(env, name, '');
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createConfig(env = {}) {
  return {
    appId: readString(env, 'FEISHU_APP_ID', ''),
    appSecret: readString(env, 'FEISHU_APP_SECRET', ''),
    verificationToken: readString(env, 'FEISHU_VERIFICATION_TOKEN', ''),
    encryptKey: readString(env, 'FEISHU_ENCRYPT_KEY', ''),
    targetChatIds: readList(env, 'TARGET_CHAT_ID', []),
    sourceChatIds: readList(env, 'SOURCE_CHAT_ID', []),
    forwardTypes: readList(env, 'FORWARD_MESSAGE_TYPES', DEFAULT_FORWARD_TYPES),
    forwardPrefix: readString(env, 'FORWARD_PREFIX', ''),
    showSenderName: readBoolean(env, 'SHOW_SENDER_NAME', false),
    forwardBotMessages: readBoolean(env, 'FORWARD_BOT_MESSAGES', false),
    forwardP2p: readBoolean(env, 'FORWARD_P2P', false),
    notifyUnsupported: readBoolean(env, 'NOTIFY_UNSUPPORTED', false),
    requestTimeoutMs: readNumber(env, 'REQUEST_TIMEOUT_MS', 8000),
    forwardSoftTimeoutMs: readNumber(env, 'FORWARD_SOFT_TIMEOUT_MS', 2500),
  };
}

module.exports = { createConfig, DEFAULT_FORWARD_TYPES };
