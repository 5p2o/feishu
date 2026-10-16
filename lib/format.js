'use strict';

// 这些类型的 content 结构与发送接口一致，可直接透传（需要在 FORWARD_MESSAGE_TYPES 中显式开启）。
const PASS_THROUGH_TYPES = new Set(['interactive', 'share_chat', 'share_user', 'location', 'todo', 'vote']);

const FILE_KEY_TYPES = new Set(['file', 'audio', 'sticker']);

function safeParseJson(text) {
  if (text === undefined || text === null || text === '') return null;
  if (typeof text === 'object') return text;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pick(source, keys) {
  const picked = {};
  for (const key of keys) {
    if (source[key]) picked[key] = source[key];
  }
  return picked;
}

// 文本消息里被 @ 的人以 @_user_1 这类占位符存在，转发前还原成可读的名字。
function humanizeMentions(text, mentions) {
  if (!text || !Array.isArray(mentions)) return text;
  let result = text;
  for (const mention of mentions) {
    const key = mention && mention.key;
    if (!key) continue;
    const label = mention.name ? '@' + mention.name : '';
    result = result.split(key).join(label);
  }
  return result;
}

function buildHeader(config, senderLabel) {
  const parts = [];
  if (config.forwardPrefix) parts.push(config.forwardPrefix);
  if (senderLabel) parts.push('[' + senderLabel + ']');
  return parts.join(' ');
}

function buildForwardPayload({ message, config, senderLabel }) {
  const msgType = message.message_type;
  if (!msgType) return { ok: false, reason: 'missing_message_type' };
  if (msgType === 'system') return { ok: false, reason: 'system_message' };
  if (!config.forwardTypes.includes(msgType)) return { ok: false, reason: 'type_not_enabled:' + msgType };

  const parsed = safeParseJson(message.content);
  if (!parsed) return { ok: false, reason: 'invalid_content' };

  const header = buildHeader(config, senderLabel);

  if (msgType === 'text') {
    const text = humanizeMentions(typeof parsed.text === 'string' ? parsed.text : '', message.mentions);
    return { ok: true, msgType: 'text', content: JSON.stringify({ text: header ? header + '\n' + text : text }) };
  }

  if (msgType === 'post') {
    if (!Array.isArray(parsed.content)) return { ok: false, reason: 'invalid_post_content' };
    const content = { ...parsed };
    content.content = header ? [[{ tag: 'text', text: header }], ...parsed.content] : parsed.content;
    return { ok: true, msgType: 'post', content: JSON.stringify(content) };
  }

  if (msgType === 'image') {
    const content = pick(parsed, ['image_key']);
    if (!content.image_key) return { ok: false, reason: 'missing_image_key' };
    return { ok: true, msgType: 'image', content: JSON.stringify(content) };
  }

  // 同租户内 file_key / image_key 可直接复用，无需重新上传。
  if (FILE_KEY_TYPES.has(msgType)) {
    const content = pick(parsed, ['file_key']);
    if (!content.file_key) return { ok: false, reason: 'missing_file_key' };
    return { ok: true, msgType, content: JSON.stringify(content) };
  }

  if (msgType === 'media') {
    const content = pick(parsed, ['file_key', 'image_key']);
    if (!content.file_key) return { ok: false, reason: 'missing_file_key' };
    return { ok: true, msgType, content: JSON.stringify(content) };
  }

  if (PASS_THROUGH_TYPES.has(msgType)) {
    return { ok: true, msgType, content: JSON.stringify(parsed) };
  }

  return { ok: false, reason: 'unsupported_type:' + msgType };
}

module.exports = {
  PASS_THROUGH_TYPES,
  safeParseJson,
  humanizeMentions,
  buildHeader,
  buildForwardPayload,
};
