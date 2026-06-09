---
name: finance-bill-summary
description: 财务账单智能汇总 — 当用户需要汇总账单、生成财务报告、或推送财务通知到飞书/企业微信时触发。自动扫描目录中的 .md 账单文件，解析多平台数据，生成 Markdown 汇总报告并推送。
---

# 财务账单智能汇总

这是一个编排型 Skill。它不包含任何账单解析逻辑——所有解析、清洗、计算、推送能力都由 MCP Tool 提供。Skill 只负责：**判断何时介入 → 按正确顺序调用 Tool → 处理异常 → 呈现结果**。

---

## 触发条件

当用户消息中包含以下意图时，立即触发本 Skill：

**精确触发：**
- "汇总账单"
- "汇总 /data/finance/ 的账单"
- "生成财务报告" / "生成财报"
- "发送飞书" / "推送企业微信" / "发到群里"
- "帮我做月度汇总"

**模糊触发（结合上下文判断）：**
- "看看这个月的收支情况"
- "把账单整理一下"
- "给老板发一份报告"

**不触发：**
- 用户只是询问账单格式、MCP 配置等技术问题
- 用户手动调用单个 Tool（如只读一个文件）

---

## 执行流程

按以下顺序编排 5 个 MCP Tool。上一步的输出是下一步的输入。

### Step 1: `list_directory`

```
获取用户指定的目录下所有 .md 文件列表
```

- 如果用户未指定目录，询问用户提供路径
- 如果返回 `files: []`（无 .md 文件），**终止流程**并告知用户目录为空

### Step 2: `read_bill_file`（循环）

```
对 Step 1 返回的每个文件，逐一调用 read_bill_file 读取原始内容
```

- 逐个文件处理，不要并行跳过
- 如果某个文件读取失败（`isError: true`），记录该文件到失败列表，**继续处理下一个文件**

### Step 3: `parse_and_clean_bills`（循环）

```
对 Step 2 成功读取的每个文件，调用 parse_and_clean_bills
传入 raw_content（Step 2 的 content）和 source_file（文件名）
```

- 得到每个文件的结构化数据：`{ platform, records, parse_warnings }`
- 如果 `parse_warnings` 非空，记录下来——这些警告需要出现在最终报告中
- 如果某个文件的 `records` 为空，仍保留该条目（platform 信息有效），但在报告中标注"无有效记录"

### Step 4: `generate_report`

```
将所有 Step 3 的结果合并为 bill_data 数组，调用 generate_report
传入 report_title（根据目录名和当前日期自动生成，如 "2026年3月财务汇总报告"）
传入 period（从目录名或文件名推断，如 "2026-03"）
```

- 得到一个完整的 Markdown 报告文本 + 汇总数据

### Step 5: `send_notification`

```
用 Step 4 的报告文本作为 body，调用 send_notification
```

- Channel 默认为 `feishu`（可从用户指令中判断，如提到"企业微信"则用 `wecom`）
- Target：优先使用用户指定的 Webhook URL；用户未指定时，依赖 MCP Server 环境变量 `FEISHU_WEBHOOK_URL`
- Subject 使用 `report_title`

### Step 6: 向用户展示

```
将 Step 4 的 Markdown 报告展示给用户，并汇报处理概况：
- 共处理 N 个文件
- 共 M 条记录
- 总收入 / 总支出 / 净利润
- 通知发送状态
- 如有解析警告或失败文件，逐条列出
```

---

## 错误处理策略

| 场景 | 处理方式 |
|------|----------|
| `list_directory` 返回空 | 告知用户该目录无 .md 文件，停止流程 |
| `read_bill_file` 对某文件失败 | 跳过该文件，记录到"失败文件列表"，继续处理其余文件 |
| `parse_and_clean_bills` 返回 `parse_warnings` | 警告不中断流程，在最终报告中展示警告详情 |
| `parse_and_clean_bills` 返回 `records: []` | 保留该平台条目，标注"无有效记录"，继续 |
| 全部文件解析后 `records` 均为空 | 生成一份空报告（收入/支出为 0），告知用户无可解析数据 |
| `generate_report` 失败 | 检查 bill_data 格式是否正确，将原始 parse 结果展示给用户作为降级输出 |
| `send_notification` 返回 `success: false` | 告知用户推送失败及原因（如"缺少 Webhook URL"），但**不阻断报告展示**——报告仍然输出给用户 |

---

## 输出规范

最终向用户展示的内容应包含：

1. **处理概况**（一句话总结）
2. **完整的 Markdown 报告**（Step 4 输出）
3. **通知状态**（成功/失败 + 原因）
4. **异常明细**（如有）：失败文件列表、解析警告汇总
