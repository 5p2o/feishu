'use strict';

const { loadEnvFile } = require('../lib/env-file');
const { getTenantAccessToken, listChats } = require('../lib/feishu');

loadEnvFile();

async function main() {
  const appId = (process.env.FEISHU_APP_ID || '').trim();
  const appSecret = (process.env.FEISHU_APP_SECRET || '').trim();

  if (!appId || !appSecret) {
    console.error('请先配置 FEISHU_APP_ID 与 FEISHU_APP_SECRET（环境变量或项目根目录的 .env 文件）。');
    process.exit(1);
  }

  const token = await getTenantAccessToken({ fetchImpl: fetch, appId, appSecret });
  const chats = await listChats({ fetchImpl: fetch, token });

  if (chats.length === 0) {
    console.log('机器人还没有加入任何群聊。请先把机器人拉进源群和目标群，再重新运行本脚本。');
    return;
  }

  console.log('机器人当前所在群聊共 ' + chats.length + ' 个：\n');
  for (const chat of chats) {
    console.log('- ' + (chat.name || '(未命名群)'));
    console.log('  chat_id      : ' + chat.chat_id);
    console.log('  群成员数     : ' + (chat.member_count ?? '未知'));
  }
  console.log('\n把上面的 chat_id 填入：');
  console.log('  TARGET_CHAT_ID  = 转发到的目标群');
  console.log('  SOURCE_CHAT_ID  = 需要监听的源群（可留空，表示机器人所在的所有群）');
}

main().catch((err) => {
  console.error('获取群列表失败:', err.message);
  process.exit(1);
});
