'use strict';

const crypto = require('node:crypto');
const {
  getTenantAccessToken,
  refreshTenantAccessToken,
  sendMessage,
  fetchUserName,
  isApiError,
  isAuthError,
  describeError,
} = require('./feishu');
const { buildForwardPayload } = require('./format');
const log = require('./log');

const senderNameCache = new Map();
const SENDER_NAME_CACHE_LIMIT = 500;

function clearSenderNameCache() {
  senderNameCache.clear();
}

function buildUuid(sourceId, chatId) {
  return crypto.createHash('sha1').update(sourceId + '|' + chatId).digest('hex');
}

// 返回过滤原因；返回空字符串表示可以转发。
function checkFilters(event, config) {
  const message = event.message;

  if (config.targetChatIds.length === 0) return 'no_target_chat';

  // 目标群里的消息不再转发，否则会和转发产生的消息互相触发，形成死循环。
  if (config.targetChatIds.includes(message.chat_id)) return 'source_chat_is_target';

  if (config.sourceChatIds.length > 0 && !config.sourceChatIds.includes(message.chat_id)) {
    return 'source_chat_not_allowed';
  }

  if (message.chat_type === 'p2p' && !config.forwardP2p) return 'private_chat_disabled';

  const senderType = event.sender && event.sender.sender_type;
  if (senderType && senderType !== 'user' && !config.forwardBotMessages) return 'bot_sender_ignored';

  return '';
}

async function resolveSenderLabel({ event, config, token, fetchImpl, timeoutMs }) {
  const sender = event.sender || {};
  if (sender.sender_type !== 'user') {
    const appId = sender.sender_id && sender.sender_id.app_id;
    return appId ? '机器人 ' + appId : '机器人';
  }
  if (!config.showSenderName) return '';

  const openId = sender.sender_id && sender.sender_id.open_id;
  if (!openId) return '';
  if (senderNameCache.has(openId)) return senderNameCache.get(openId);

  try {
    const name = await fetchUserName({ fetchImpl, token, openId, timeoutMs });
    if (name) {
      if (senderNameCache.size >= SENDER_NAME_CACHE_LIMIT) senderNameCache.clear();
      senderNameCache.set(openId, name);
      return name;
    }
  } catch (err) {
    log.warn('获取发送者姓名失败，已忽略昵称', { openId, error: String(err && err.message) });
  }
  return '';
}

async function sendToChat({ credentials, chatId, payload, uuid }) {
  let token = await getTenantAccessToken(credentials);
  let result = await sendMessage({
    fetchImpl: credentials.fetchImpl,
    token,
    receiveId: chatId,
    msgType: payload.msgType,
    content: payload.content,
    uuid,
    timeoutMs: credentials.timeoutMs,
  });

  if (isApiError(result) && isAuthError(result)) {
    log.warn('tenant_access_token 失效，刷新后重试一次');
    token = await refreshTenantAccessToken(credentials);
    result = await sendMessage({
      fetchImpl: credentials.fetchImpl,
      token,
      receiveId: chatId,
      msgType: payload.msgType,
      content: payload.content,
      uuid,
      timeoutMs: credentials.timeoutMs,
    });
  }

  if (isApiError(result)) {
    return { chatId, ok: false, error: describeError(result), data: result.data };
  }
  return { chatId, ok: true, messageId: result.data && result.data.data && result.data.data.message_id };
}

async function notifyUnsupported({ credentials, config, reason, uuid }) {
  const notice = { msgType: 'text', content: JSON.stringify({ text: '（该消息类型暂未开启转发：' + reason + '）' }) };
  for (const chatId of config.targetChatIds) {
    try {
      await sendToChat({ credentials, chatId, payload: notice, uuid: buildUuid(uuid, chatId) });
    } catch (err) {
      log.warn('发送未支持类型提示失败', { chatId, error: String(err && err.message) });
    }
  }
}

async function forwardEvent({ event, config, deps = {} }) {
  const fetchImpl = deps.fetchImpl;
  const credentials = {
    fetchImpl,
    appId: config.appId,
    appSecret: config.appSecret,
    timeoutMs: config.requestTimeoutMs,
  };

  const message = event && event.message;
  if (!message || !message.chat_id) return { status: 'skipped', reason: 'no_message' };

  const filterReason = checkFilters(event, config);
  if (filterReason) return { status: 'skipped', reason: filterReason };

  const sourceId = event.event_id || message.message_id || String(Date.now());
  const token = await getTenantAccessToken(credentials);
  const senderLabel = await resolveSenderLabel({
    event,
    config,
    token,
    fetchImpl,
    timeoutMs: Math.min(config.requestTimeoutMs, 5000),
  });

  const payload = buildForwardPayload({ message, config, senderLabel });
  if (!payload.ok) {
    if (config.notifyUnsupported && payload.reason !== 'system_message') {
      await notifyUnsupported({ credentials, config, reason: payload.reason, uuid: sourceId });
    }
    return { status: 'skipped', reason: payload.reason };
  }

  const results = [];
  for (const chatId of config.targetChatIds) {
    try {
      results.push(await sendToChat({ credentials, chatId, payload, uuid: buildUuid(sourceId, chatId) }));
    } catch (err) {
      results.push({ chatId, ok: false, error: String(err && err.message) });
    }
  }

  const failed = results.filter((item) => !item.ok);
  if (failed.length > 0) {
    log.error('转发失败', { chatIds: failed.map((item) => item.chatId), errors: failed.map((item) => item.error) });
    return { status: 'failed', results };
  }

  log.info('转发成功', { msgType: payload.msgType, targets: config.targetChatIds.length });
  return { status: 'forwarded', results };
}

module.exports = { forwardEvent, checkFilters, buildUuid, clearSenderNameCache };
