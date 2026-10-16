'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createConfig } = require('../lib/config');
const { buildForwardPayload, humanizeMentions } = require('../lib/format');

function configWith(extra = {}) {
  return createConfig(
    Object.assign(
      {
        FEISHU_APP_ID: 'cli_test',
        FEISHU_APP_SECRET: 'secret',
        TARGET_CHAT_ID: 'oc_target',
      },
      extra
    )
  );
}

test('文本消息：还原 @ 占位符', () => {
  const text = humanizeMentions('@_user_1 请看下这个', [{ key: '@_user_1', name: '张三' }]);
  assert.equal(text, '@张三 请看下这个');
});

test('文本消息：拼接前缀与发送者', () => {
  const payload = buildForwardPayload({
    message: { message_type: 'text', content: JSON.stringify({ text: '大家好' }) },
    config: configWith({ FORWARD_PREFIX: '[源群]' }),
    senderLabel: '张三',
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.msgType, 'text');
  assert.equal(JSON.parse(payload.content).text, '[源群] [张三]\n大家好');
});

test('文本消息：不带前缀时原样转发', () => {
  const payload = buildForwardPayload({
    message: { message_type: 'text', content: JSON.stringify({ text: '大家好' }) },
    config: configWith(),
    senderLabel: '',
  });
  assert.equal(JSON.parse(payload.content).text, '大家好');
});

test('富文本消息：在首行插入来源信息', () => {
  const payload = buildForwardPayload({
    message: {
      message_type: 'post',
      content: JSON.stringify({ title: '标题', content: [[{ tag: 'text', text: '正文' }]] }),
    },
    config: configWith({ FORWARD_PREFIX: '[源群]' }),
    senderLabel: '李四',
  });
  const content = JSON.parse(payload.content);
  assert.equal(payload.msgType, 'post');
  assert.equal(content.title, '标题');
  assert.deepEqual(content.content[0], [{ tag: 'text', text: '[源群] [李四]' }]);
  assert.deepEqual(content.content[1], [{ tag: 'text', text: '正文' }]);
});

test('图片消息：只保留 image_key', () => {
  const payload = buildForwardPayload({
    message: { message_type: 'image', content: JSON.stringify({ image_key: 'img_1' }) },
    config: configWith(),
    senderLabel: '',
  });
  assert.equal(payload.msgType, 'image');
  assert.deepEqual(JSON.parse(payload.content), { image_key: 'img_1' });
});

test('文件消息：只保留 file_key', () => {
  const payload = buildForwardPayload({
    message: { message_type: 'file', content: JSON.stringify({ file_key: 'file_1', file_name: '报告.pdf' }) },
    config: configWith(),
    senderLabel: '',
  });
  assert.equal(payload.msgType, 'file');
  assert.deepEqual(JSON.parse(payload.content), { file_key: 'file_1' });
});

test('system 消息不转发', () => {
  const payload = buildForwardPayload({
    message: { message_type: 'system', content: JSON.stringify({}) },
    config: configWith(),
    senderLabel: '',
  });
  assert.equal(payload.ok, false);
  assert.equal(payload.reason, 'system_message');
});

test('未开启的消息类型不转发', () => {
  const payload = buildForwardPayload({
    message: { message_type: 'interactive', content: JSON.stringify({ elements: [] }) },
    config: configWith(),
    senderLabel: '',
  });
  assert.equal(payload.ok, false);
  assert.equal(payload.reason, 'type_not_enabled:interactive');
});

test('透传类型：显式开启后原样转发卡片', () => {
  const card = { elements: [{ tag: 'div', text: { tag: 'plain_text', content: 'hi' } }] };
  const payload = buildForwardPayload({
    message: { message_type: 'interactive', content: JSON.stringify(card) },
    config: configWith({ FORWARD_MESSAGE_TYPES: 'text,interactive' }),
    senderLabel: '',
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.msgType, 'interactive');
  assert.deepEqual(JSON.parse(payload.content), card);
});

test('content 不是合法 JSON 时不转发', () => {
  const payload = buildForwardPayload({
    message: { message_type: 'text', content: 'not-json' },
    config: configWith(),
    senderLabel: '',
  });
  assert.equal(payload.ok, false);
  assert.equal(payload.reason, 'invalid_content');
});
