'use strict';

function createMockFetch(routes) {
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    const call = {
      url: String(url),
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    calls.push(call);

    const route = (routes || []).find((item) => item.match(call));
    const response = route ? route.respond(call) : { status: 200, body: { code: 0, data: {} } };
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      text: async () => JSON.stringify(response.body === undefined ? {} : response.body),
    };
  };

  fetchImpl.calls = calls;
  fetchImpl.sentMessages = () => calls.filter((call) => call.url.includes('/im/v1/messages'));
  return fetchImpl;
}

const tokenRoute = {
  match: (call) => call.url.includes('/auth/v3/tenant_access_token'),
  respond: () => ({ status: 200, body: { code: 0, tenant_access_token: 'token-1', expire: 7200 } }),
};

function createRes() {
  const res = { statusCode: 0, headers: {}, payload: undefined, headersSent: false };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (name, value) => {
    res.headers[name] = value;
    return res;
  };
  res.json = (payload) => {
    res.payload = payload;
    res.headersSent = true;
    return res;
  };
  res.send = (payload) => {
    res.payload = payload;
    res.headersSent = true;
    return res;
  };
  return res;
}

function makeMessageEvent(overrides = {}) {
  const message = Object.assign(
    {
      message_id: 'om_source_1',
      chat_id: 'oc_source',
      chat_type: 'group',
      message_type: 'text',
      content: JSON.stringify({ text: '大家好' }),
    },
    overrides.message
  );

  return Object.assign(
    {
      schema: '2.0',
      header: {
        event_id: 'evt_1',
        event_type: 'im.message.receive_v1',
        token: 'vt_1',
        create_time: '1700000000000',
      },
      event: { sender: { sender_type: 'user', sender_id: { open_id: 'ou_user_1' } }, message },
    },
    overrides.event ? { event: Object.assign({}, overrides.event) } : {}
  );
}

module.exports = { createMockFetch, createRes, makeMessageEvent, tokenRoute };
