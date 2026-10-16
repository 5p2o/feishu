'use strict';

const fs = require('node:fs');
const path = require('node:path');

// 本地脚本用的极简 .env 读取器（Vercel 上直接用平台配置的环境变量）。
function loadEnvFile(filePath, env = process.env) {
  const target = filePath || path.join(process.cwd(), '.env');
  if (!fs.existsSync(target)) return false;

  for (const rawLine of fs.readFileSync(target, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.length > 1 && ['"', "'"].includes(value[0]) && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    if (key && !(key in env)) env[key] = value;
  }
  return true;
}

module.exports = { loadEnvFile };
