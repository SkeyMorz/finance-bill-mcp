# finance-bill-mcp

财务账单智能汇总 MCP Server —— 让 AI Agent 自动读取多平台账单、清洗数据、生成报告并推送到飞书/企业微信。

## 快速开始

```bash
npm install      # 安装依赖
npm run build    # 编译 TypeScript
npm run start    # 启动 MCP Server（stdio 模式）
```

## 环境要求

- Node.js >= 18
- npm >= 9

## 接入 AI 编码环境

### Claude Code

项目根目录已有 `.mcp.json`，Claude Code 进入项目目录后自动加载。也可手动配置 `~/.claude.json`：

```json
{
  "mcpServers": {
    "finance-bill": {
      "command": "node",
      "args": ["./dist/server.js"],
      "env": {
        "FEISHU_WEBHOOK_URL": "你的飞书Webhook地址"
      }
    }
  }
}
```

### Cursor

将 `configs/cursor/mcp.json` 复制到项目根目录 `.cursor/mcp.json`。

### Codex

启动时通过 `--mcp-config` 指定 `configs/codex/mcp.json`。

## MCP Tools

| Tool | 功能 |
|------|------|
| `list_directory` | 列出指定目录下所有 `.md` 文件 |
| `read_bill_file` | 读取单个账单文件的原始内容 |
| `parse_and_clean_bills` | 自动识别格式（Markdown表格/CSV/Key-Value）并清洗为结构化数据 |
| `generate_report` | 接收多平台结构化数据，生成 Markdown 汇总报告 |
| `send_notification` | 通过飞书/企业微信 Webhook 推送报告 |

## Skill 编排

项目包含 `SKILL.md`，注册为 `finance-bill-summary` Skill。当用户说"汇总账单""生成财报""发送飞书"时，AI Agent 自动按以下流程编排 Tool：

```
list_directory → read_bill_file(×N) → parse_and_clean_bills(×N) → generate_report → send_notification
```

## 示例数据

`sample_data/` 目录包含 3 个模拟账单文件，覆盖不同格式：

| 文件 | 平台 | 格式 | 记录数 |
|------|------|------|--------|
| `alipay_202603.md` | 支付宝商家 | Markdown 表格 | 13 |
| `wechat_pay_202603.md` | 微信支付 | CSV 风格 | 13 |
| `bank_statement_202603.md` | 银行对公流水 | Key-Value | 12 |

## 端到端演示

在 Claude Code 中进入项目目录，确保 `.mcp.json` 已配置，然后说：

> "帮我汇总 sample_data/ 目录下的所有账单，生成 2026年3月 月度报告并发送到飞书"

AI Agent 将自动：
1. 扫描 `sample_data/` 找到 3 个 `.md` 文件
2. 依次读取每个文件内容
3. 自动识别格式并解析为结构化数据
4. 生成包含收入/支出/净利润、平台分析、分类统计的 Markdown 报告
5. 推送到飞书群（如已配置 Webhook URL）

## 项目结构

```
finance-bill-mcp/
├── src/
│   ├── server.ts              # MCP Server 入口，注册 5 个 Tool
│   ├── parsers/               # 账单解析器
│   │   ├── types.ts           # 共享类型
│   │   ├── platform.ts        # 平台识别
│   │   ├── markdown.ts        # Markdown 表格解析
│   │   ├── csv.ts             # CSV 解析
│   │   ├── keyvalue.ts        # Key-Value 解析
│   │   └── normalize.ts       # 日期标准化 + 分类
│   ├── report/                # 报表引擎
│   │   ├── calculator.ts      # 聚合计算
│   │   └── markdown.ts        # Markdown 报告生成
│   └── notify/                # 通知模块
│       └── sender.ts          # 飞书/企微 Webhook
├── sample_data/               # 示例账单数据
├── configs/                   # Cursor / Claude Code / Codex 配置参考
├── SKILL.md                   # Agent 编排 Skill
├── .mcp.json                  # Claude Code MCP 配置
├── package.json
└── tsconfig.json
```

## License

MIT
