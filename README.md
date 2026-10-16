# 飞书群消息转发机器人（零设备常开）

把飞书 A 群（可多个）的消息自动转发到 B 群，**不需要任何电脑或服务器常开**：
飞书服务器通过事件订阅把消息推送到 Vercel 云函数，云函数再调用飞书接口转发出去。

## 文件结构

```text
feishu-forward-bot/
├── api/
│   └── webhook.js          # 云函数入口（Vercel 只部署这一个接口）
├── lib/
│   ├── config.js           # 环境变量解析
│   ├── event.js            # 回调体解析、解密、Verification Token 校验
│   ├── feishu.js           # 飞书 API：token / 发消息 / 群列表 / 事件解密
│   ├── format.js           # 各类消息 -> 可发送的 content
│   ├── forward.js          # 过滤规则、幂等、转发编排
│   ├── log.js              # 统一日志
│   └── env-file.js         # 本地脚本用的 .env 读取器
├── scripts/
│   ├── list-chats.js       # 一键获取机器人所在群的 chat_id
│   └── dev-server.js       # 本地起一个 webhook 服务，便于自测
├── test/                   # node:test 单测（27 个用例）
├── package.json
├── vercel.json
└── .env.example
```

**零依赖**：只用 Node 内置能力（全局 `fetch`、`node:crypto`），不需要 `axios`，
Vercel 上无需 `npm install` 装任何包，冷启动更快。

## 相比原始方案的几处修正（都会踩坑，务必了解）

| 问题 | 原始写法 | 本项目 |
| --- | --- | --- |
| **转发死循环** | 把目标群的消息也转发回目标群，来回触发 | 源群 == 目标群时直接丢弃（`source_chat_is_target`） |
| **重复转发** | 飞书超时重推会转发多次 | 发送时带 `uuid` 幂等字段，飞书侧 1 小时内只投递一次 |
| **请求来源** | 不校验 Verification Token，任何人可伪造 | 校验 token，不匹配直接忽略；支持 Encrypt Key 解密 |
| **token 过期** | token 失效就永久失败 | 命中 token 失效错误码时自动刷新并重试一次 |
| **@ 提醒** | 原样转发 `@_user_1` 乱码 | 还原成 `@张三` 纯文本（注意：不会真的提醒对方） |
| **群 ID 获取** | 要去调 API 调试台手搓请求 | `npm run chats` 一条命令列出所有群和 chat_id |
| **超时** | 转发慢会拖到飞书超时 | 2.5 秒软超时保护，先回 200，转发在后台继续 |

## 一、创建飞书自建应用

1. 用个人账号登录 [飞书开放平台](https://open.feishu.cn/app)，点击「创建企业自建应用」。
2. 填写应用名称（如「群消息转发助手」）、描述、图标，点击创建。
3. 提示创建测试企业时，填写测试企业名称、手机号、验证码并确认。
4. 在「测试企业和人员」页面点击「关联应用」，把应用绑定到测试企业。

> 测试企业模式下，权限和配置变更立即生效，无需管理员审核，个人账号即可完成全部流程。

## 二、获取应用凭证

在应用详情页记录三个值，后面要填进 Vercel 环境变量：

| 凭证 | 位置 | 用途 | 环境变量名 |
| --- | --- | --- | --- |
| App ID | 凭证与基础信息 | 应用唯一标识（`cli_...`） | `FEISHU_APP_ID` |
| App Secret | 凭证与基础信息 | 换取 tenant_access_token | `FEISHU_APP_SECRET` |
| Verification Token | 安全设置 | 校验事件请求来源 | `FEISHU_VERIFICATION_TOKEN` |

> 如果还开启了「安全设置 > 加密策略」里的 Encrypt Key，必须同时配置 `FEISHU_ENCRYPT_KEY`，
> 否则回调体是密文，云函数无法解析。

## 三、开启机器人能力并申请权限

1. 左侧「添加应用能力」→ 找到「机器人」→ 点击「添加」。
2. 左侧「开发配置 > 权限管理」，在 API 权限里搜索并开通：

| 权限标识 | 用途 |
| --- | --- |
| `im:message` | 读取消息（接收群消息事件的前提） |
| `im:message:send_as_bot` | 以机器人身份发送消息（转发到目标群） |
| `im:chat` | 获取群聊信息（拿目标群 chat_id） |
| `contact:user.base:readonly` | 可选，仅当开启 `SHOW_SENDER_NAME` 需要 |

勾选后点击「批量开通」。

## 四、添加事件订阅

1. 左侧点击「事件与回调」。
2. 「事件配置」页签 → 配置订阅方式 → 选择「将事件发送至开发者服务器」（Webhook 模式）。
   **此时先不填地址**，等第五步部署完再回来填。
3. 在「已添加事件」里点击「添加事件」，搜索并添加：`接收消息 v2.0`（`im.message.receive_v1`）。

## 五、部署到 Vercel

### 5.1 推到 GitHub

```bash
cd feishu-forward-bot
git init
git add .
git commit -m "feat: 飞书群消息转发机器人"
git branch -M main
git remote add origin https://github.com/<你的用户名>/feishu-forward-bot.git
git push -u origin main
```

### 5.2 在 Vercel 导入项目

1. 用 GitHub 账号登录 [vercel.com](https://vercel.com)，点击「Add New… > Project」，选择上面的仓库。
2. Framework Preset 选 `Other`（无需构建命令、无需 Output Directory）。
3. 展开 Environment Variables，按下表添加：

| 变量名 | 值 | 必填 |
| --- | --- | --- |
| `FEISHU_APP_ID` | 第二步的 App ID | 是 |
| `FEISHU_APP_SECRET` | 第二步的 App Secret | 是 |
| `TARGET_CHAT_ID` | 目标群 chat_id（第六步获取，可先随便填一个再改） | 是 |
| `FEISHU_VERIFICATION_TOKEN` | 第二步的 Verification Token | 强烈建议 |
| `FEISHU_ENCRYPT_KEY` | 开启了加密策略才需要 | 否 |
| `SOURCE_CHAT_ID` | 只转发这些源群，多个用逗号分隔；留空=机器人所在的所有群 | 否 |
| `FORWARD_PREFIX` | 转发内容前缀，如 `[源群]` | 否 |
| `SHOW_SENDER_NAME` | `true` 时带上发送者姓名（需 `contact:user.base:readonly`） | 否 |
| `FORWARD_MESSAGE_TYPES` | 默认 `text,post,image,file,audio,media,sticker` | 否 |
| `FORWARD_BOT_MESSAGES` | `true` 时也转发其他机器人的消息（默认忽略） | 否 |
| `FORWARD_P2P` | `true` 时也转发单聊消息（默认只转发群消息） | 否 |
| `NOTIFY_UNSUPPORTED` | `true` 时对未开启的消息类型发提示 | 否 |

4. 点击「Deploy」。部署完成后得到域名，你的 Webhook 地址就是：

```text
https://<你的项目名>.vercel.app/api/webhook
```

> 改了环境变量必须重新部署（Redeploy）才会生效。

## 六、获取目标群的 chat_id

1. **先把机器人拉进目标群**（在飞书群里 @机器人 或通过群设置添加机器人）。
2. 本地执行（会自动读取项目根目录的 `.env`）：

```bash
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
# 编辑 .env，填入 FEISHU_APP_ID / FEISHU_APP_SECRET
npm run chats
```

输出示例：

```text
- 研发通知群
  chat_id      : oc_1a2b3c4d5e6f7g8h9i0j
  群成员数     : 12
```

3. 把目标群的 chat_id 填到 Vercel 的 `TARGET_CHAT_ID`，然后 Redeploy。

> 也可以从事件日志里拿：机器人所在群里有人发言时，飞书推送的事件数据里就含 `chat_id`
> （Vercel 项目 → Logs 里能看到）。

## 七、回填 Webhook 地址并验证

1. 回到飞书开放平台「事件与回调」→「订阅方式」，把请求地址填成
   `https://<你的项目名>.vercel.app/api/webhook`，点击保存。
2. 飞书会立刻发一个 `url_verification` 请求，云函数返回 `challenge` 即保存成功。
3. 保存失败时先本地排查：

```powershell
curl.exe -s -X POST https://<你的项目名>.vercel.app/api/webhook -H "Content-Type: application/json" -d '{"challenge":"test123","type":"url_verification","token":"你的VerificationToken"}'
```

> Windows PowerShell 下 JSON 一定要用**单引号**包起来。写成 `-d "{\"challenge\":...}"`
> 会把反斜杠原样发给服务端，导致 `invalid payload`（这一步很容易踩）。

期望返回 `{"challenge":"test123"}`。返回 403 说明 `FEISHU_VERIFICATION_TOKEN` 填错了；
返回 500 说明 `FEISHU_APP_ID`/`FEISHU_APP_SECRET` 没配好。

## 八、把机器人加入两个群并开始转发

1. 把机器人拉进**源群**（要监听消息的群）和**目标群**（接收转发内容的群）。
2. 确保机器人在两个群里都有发言权限（未被设置禁言）。
3. 在源群发一条文本消息，目标群应该立刻收到转发；在 Vercel Logs 里能看到
   `转发成功 {"msgType":"text","targets":1}`。

## 本地开发与测试

```bash
npm test          # 跑 27 个单测（无需网络、无需真实飞书凭证）
npm run dev       # 本地起 http://localhost:3000/api/webhook，可用 curl.exe 自测
```

本地调试时可以把 `.env` 填好，用 `npm run dev` 起服务，再用上面第七步的 curl 验证地址逻辑；
如果要让飞书直连本地，需要 ngrok 之类的内网穿透（本项目不需要，Vercel 已提供公网地址）。

## 行为说明与限制

- 只有**机器人被拉进的群**才会产生事件，机器人无法监听自己不在的群。
- 文本里的 @ 会被还原成 `@名字` 纯文本，**不会真正提醒**目标群成员（机器人只能以自己的身份发言）。
- 图片、文件、语音等转发时复用原 `file_key`/`image_key`（同租户内可用），不会重新上传。
- 卡片消息默认不转发，如需转发把 `interactive` 加进 `FORWARD_MESSAGE_TYPES`。
- 默认忽略其他机器人发来的消息，避免两个转发机器人互相刷屏。
- 频繁转发可能触发飞书发送接口的频率限制，高流量场景建议加队列或做关键词过滤。
- 云函数实例内存里的 token 缓存是「尽力而为」，冷启动会重新取一次 token，属正常现象。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 保存 Webhook 地址失败 | 地址必须是公网 https；检查是否漏了 `/api/webhook` 路径；看 Vercel Logs 是否有 500 |
| 403 `verification token mismatched` | `FEISHU_VERIFICATION_TOKEN` 与开放平台「安全设置」里的值不一致 |
| 日志报 `收到加密事件，但未配置 FEISHU_ENCRYPT_KEY` | 开放平台开启了加密策略，需同步配置 Encrypt Key |
| 日志报 `code=230002 Bot is not in the chat` | 机器人不在目标群，或目标群 chat_id 填错 |
| 日志报 `code=99991672 / 99991663` | 权限未开通或 token 失效；确认已开通 `im:message:send_as_bot` 并重新部署 |
| 收到消息但没转发 | 看日志里的 skip 原因：`source_chat_is_target`（源群就是目标群）／`bot_sender_ignored`／`type_not_enabled:xxx`／`private_chat_disabled` |
| 一条消息转发了两次 | 检查是否配置了多个 `TARGET_CHAT_ID`；重复推送已被 `uuid` 幂等兜住 |
