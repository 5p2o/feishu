'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createConfig } = require('../lib/config');
const { clearTokenCache, encryptEvent } = require('../lib/feishu');
const { clearSenderNameCache } = require('../lib/forward');
const { createHandler } = require('../api/webhook');
const { createMockFetch, createRes, makeMessageEvent, tokenRoute } = require('./helpers');

const CONFIG = createConfig({
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  FEISHU_VERIFICATION_TOKEN: 'vt_1',
  TARGET_CHAT_ID: 'oc_target',
});

function setup(routes) {
  clearTokenCache();
  clearSenderNameCache();
  const fetchImpl = createMockFetch([tokenRoute].concat(routes || []));
  return { fetchImpl, handler: createHandler({ config: CONFIG, fetchImpl }) };
}

async function post(handler, body) {
  const res = createRes();
  await handler({ method: 'POST', body }, res);
  return res;
}

test('非 POST 请求返回 405', async () => {
  const { handler } = setup();
  const res = createRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('url_verification 原样返回 challenge', async () => {
  const { handler } = setup();
  const res = await post(handler, { type: 'url_verification', challenge: 'test123', token: 'vt_1' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { challenge: 'test123' });
});

test('url_verification 的 token 不匹配时返回 403', async () => {
  const { handler } = setup();
  const res = await post(handler, { type: 'url_verification', challenge: 'test123', token: 'wrong' });
  assert.equal(res.statusCode, 403);
});

test('加密事件：解密后照常处理', async () => {
  const encryptKey = 'encrypt-key';
  const config = createConfig({
    FEISHU_APP_ID: 'cli_test',
    FEISHU_APP_SECRET: 'secret',
    FEISHU_VERIFICATION_TOKEN: 'vt_1',
    FEISHU_ENCRYPT_KEY: encryptKey,
    TARGET_CHAT_ID: 'oc_target',
  });
  clearTokenCache();
  const fetchImpl = createMockFetch([tokenRoute]);
  const handler = createHandler({ config, fetchImpl });

  const challenge = await post(handler, { encrypt: encryptEvent(encryptKey, { type: 'url_verification', challenge: 'c1', token: 'vt_1' }) });
  assert.deepEqual(challenge.payload, { challenge: 'c1' });

  await post(handler, { encrypt: encryptEvent(encryptKey, makeMessageEvent()) });
  assert.equal(fetchImpl.sentMessages().length, 1);
});

test('缺少 Encrypt Key 时无法解密加密事件', async () => {
  const { handler } = setup();
  const res = await post(handler, { encrypt: 'anything' });
  assert.equal(res.statusCode, 400);
});

test('文本消息按预期转发到目标群', async () => {
  const { handler, fetchImpl } = setup();
  const res = await post(handler, makeMessageEvent());

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { code: 0 });

  const sends = fetchImpl.sentMessages();
  assert.equal(sends.length, 1);
  assert.match(sends[0].url, /receive_id_type=chat_id/);
  assert.equal(sends[0].headers.Authorization, 'Bearer token-1');
  assert.equal(sends[0].body.receive_id, 'oc_target');
  assert.equal(sends[0].body.msg_type, 'text');
  assert.deepEqual(JSON.parse(sends[0].body.content), { text: '大家好' });
  assert.match(sends[0].body.uuid, /^[0-9a-f]{40}$/);
});

test('tenant_access_token 在多次事件间复用', async () => {
  const { handler, fetchImpl } = setup();
  await post(handler, makeMessageEvent());
  await post(handler, makeMessageEvent({ message: { message_id: 'om_source_2' } }));

  const tokenCalls = fetchImpl.calls.filter((call) => call.url.includes('tenant_access_token'));
  assert.equal(tokenCalls.length, 1);
  assert.equal(fetchImpl.sentMessages().length, 2);
});

test('来源是目标群时不再转发，避免死循环', async () => {
  const { handler, fetchImpl } = setup();
  await post(handler, makeMessageEvent({ message: { chat_id: 'oc_target', content: JSON.stringify({ text: '目标群里的消息' }) } }));
  assert.equal(fetchImpl.sentMessages().length, 0);
});

test('SOURCE_CHAT_ID 白名单之外的群不转发', async () => {
  clearTokenCache();
  const config = createConfig({
    FEISHU_APP_ID: 'cli_test',
    FEISHU_APP_SECRET: 'secret',
    FEISHU_VERIFICATION_TOKEN: 'vt_1',
    TARGET_CHAT_ID: 'oc_target',
    SOURCE_CHAT_ID: 'oc_allowed',
  });
  const fetchImpl = createMockFetch([tokenRoute]);
  const handler = createHandler({ config, fetchImpl });

  await post(handler, makeMessageEvent());
  assert.equal(fetchImpl.sentMessages().length, 0);

  await post(handler, makeMessageEvent({ message: { chat_id: 'oc_allowed' } }));
  assert.equal(fetchImpl.sentMessages().length, 1);
});

test('其他机器人发送的消息默认忽略', async () => {
  const { handler, fetchImpl } = setup();
  const event = makeMessageEvent();
  event.event.sender = { sender_type: 'app', sender_id: { app_id: 'cli_other' } };
  await post(handler, event);
  assert.equal(fetchImpl.sentMessages().length, 0);
});

test('单聊消息默认不转发', async () => {
  const { handler, fetchImpl } = setup();
  await post(handler, makeMessageEvent({ message: { chat_id: 'oc_p2p', chat_type: 'p2p' } }));
  assert.equal(fetchImpl.sentMessages().length, 0);
});

test('Verification Token 不匹配的事件不转发', async () => {
  const { handler, fetchImpl } = setup();
  const event = makeMessageEvent();
  event.header.token = 'wrong-token';
  const res = await post(handler, event);
  assert.equal(res.statusCode, 200);
  assert.equal(fetchImpl.sentMessages().length, 0);
});

test('非消息事件被忽略', async () => {
  const { handler, fetchImpl } = setup();
  const res = await post(handler, { schema: '2.0', header: { event_type: 'im.chat.updated_v1', token: 'vt_1' } });
  assert.equal(res.statusCode, 200);
  assert.equal(fetchImpl.calls.length, 0);
});

test('图片消息以 image 类型转发', async () => {
  const { handler, fetchImpl } = setup();
  await post(handler, makeMessageEvent({ message: { message_type: 'image', content: JSON.stringify({ image_key: 'img_1' }) } }));
  const sends = fetchImpl.sentMessages();
  assert.equal(sends[0].body.msg_type, 'image');
  assert.deepEqual(JSON.parse(sends[0].body.content), { image_key: 'img_1' });
});

test('token 失效时刷新后重试一次', async () => {
  let sendCount = 0;
  const sendRoute = {
    match: (call) => call.url.includes('/im/v1/messages'),
    respond: () => {
      sendCount += 1;
      if (sendCount === 1) return { status: 200, body: { code: 99991663, msg: 'tenant_access_token not exist' } };
      return { status: 200, body: { code: 0, data: { message_id: 'om_ok' } } };
    },
  };
  const { handler, fetchImpl } = setup([sendRoute]);

  await post(handler, makeMessageEvent());

  const tokenCalls = fetchImpl.calls.filter((call) => call.url.includes('tenant_access_token'));
  assert.equal(tokenCalls.length, 2);
  assert.equal(fetchImpl.sentMessages().length, 2);
});

test('发送接口报错时仍返回 200，避免飞书重推', async () => {
  const sendRoute = {
    match: (call) => call.url.includes('/im/v1/messages'),
    respond: () => ({ status: 200, body: { code: 230002, msg: 'Bot is not in the chat' } }),
  };
  const { handler } = setup([sendRoute]);
  const res = await post(handler, makeMessageEvent());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { code: 0 });
});

test('开启 SHOW_SENDER_NAME 时带上发送者姓名', async () => {
  clearTokenCache();
  const config = createConfig({
    FEISHU_APP_ID: 'cli_test',
    FEISHU_APP_SECRET: 'secret',
    FEISHU_VERIFICATION_TOKEN: 'vt_1',
    TARGET_CHAT_ID: 'oc_target',
    SHOW_SENDER_NAME: 'true',
  });
  const userRoute = {
    match: (call) => call.url.includes('/contact/v3/users/'),
    respond: () => ({ status: 200, body: { code: 0, data: { user: { name: '张三' } } } }),
  };
  const fetchImpl = createMockFetch([tokenRoute, userRoute]);
  const handler = createHandler({ config, fetchImpl });

  await post(handler, makeMessageEvent());

  const sends = fetchImpl.sentMessages();
  assert.deepEqual(JSON.parse(sends[0].body.content), { text: '[张三]\n大家好' });
});
