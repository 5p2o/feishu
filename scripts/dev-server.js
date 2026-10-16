'use strict';

const http = require('node:http');
const { loadEnvFile } = require('../lib/env-file');
const handler = require('../api/webhook');

loadEnvFile();

const port = Number(process.env.PORT) || 3000;

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };
  res.send = (payload) => {
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return res;
  };

  try {
    await handler({ method: req.method, url: req.url, headers: req.headers, body: rawBody || undefined }, res);
  } catch (err) {
    console.error('[feishu-forward] ERROR 未捕获异常:', err);
    if (res.headersSent) res.end();
    else {
      res.statusCode = 500;
      res.end('internal error');
    }
  }
});

server.listen(port, () => {
  console.log('本地调试服务已启动: http://localhost:' + port + '/api/webhook');
  console.log('自测地址验证（PowerShell）：');
  console.log(
    '  curl.exe -s -X POST http://localhost:' +
      port +
      '/api/webhook -H "Content-Type: application/json" -d \'{"type":"url_verification","challenge":"test123","token":"你的VerificationToken"}\''
  );
});
