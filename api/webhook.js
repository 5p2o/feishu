'use strict';

const { createConfig } = require('../lib/config');
const { parseEventPayload, isChallengeRequest, checkVerificationToken } = require('../lib/event');
const { forwardEvent } = require('../lib/forward');
const log = require('../lib/log');

const MESSAGE_EVENT_TYPE = 'im.message.receive_v1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleRequest(req, res, deps = {}) {
  const config = deps.config || createConfig(process.env);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;

  if (req.method !== 'POST') {
    return res.status(405).json({ code: 1, msg: 'Method Not Allowed' });
  }

  if (!config.appId || !config.appSecret) {
    log.error('缺少环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET');
    return res.status(500).json({ code: 1, msg: 'server not configured' });
  }

  let body;
  try {
    body = parseEventPayload(req.body, config.encryptKey);
  } catch (err) {
    log.error('解析请求体失败', { error: String(err && err.message) });
    return res.status(400).json({ code: 1, msg: 'invalid payload' });
  }

  // 一、地址验证：原样返回 challenge（飞书要求 1 秒内响应，否则保存地址失败）
  if (isChallengeRequest(body)) {
    const check = checkVerificationToken(body, config);
    if (!check.ok) {
      log.warn('url_verification 的 Verification Token 不匹配，请检查 FEISHU_VERIFICATION_TOKEN');
      return res.status(403).json({ code: 1, msg: 'verification token mismatched' });
    }
    log.info('url_verification 验证通过');
    return res.status(200).json({ challenge: body.challenge });
  }

  // 二、事件回调：校验来源，非法来源直接静默忽略
  const check = checkVerificationToken(body, config);
  if (!check.ok) {
    log.warn('事件 Verification Token 不匹配，已忽略', { reason: check.reason });
    return res.status(200).json({ code: 0 });
  }

  const header = body.header || {};
  if (header.event_type !== MESSAGE_EVENT_TYPE) {
    log.info('忽略非消息事件', { eventType: header.event_type || body.type || 'unknown' });
    return res.status(200).json({ code: 0 });
  }

  // 三、转发。正常情况下几百毫秒内完成；一旦超过软超时先返回 200，
  // 避免飞书判定超时后重推（重推会被发送接口的 uuid 幂等字段挡掉）。
  const outcome = await Promise.race([
    forwardEvent({ event: body.event, config, deps: { fetchImpl } })
      .then((result) => ({ done: true, result }))
      .catch((err) => {
        log.error('处理事件异常', { error: String(err && err.message) });
        return { done: true, result: { status: 'failed' } };
      }),
    sleep(config.forwardSoftTimeoutMs).then(() => ({ done: false })),
  ]);

  if (!outcome.done) {
    log.warn('转发耗时超过软超时，已先返回 200，转发将在后台继续');
  }

  return res.status(200).json({ code: 0 });
}

function handler(req, res) {
  return handleRequest(req, res);
}

module.exports = handler;
module.exports.handleRequest = handleRequest;
module.exports.createHandler = (deps) => (req, res) => handleRequest(req, res, deps);
