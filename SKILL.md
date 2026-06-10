---
name: finance-bill-summary
description: 财务账单智能汇总 — 当用户需要汇总账单、生成财务报告、或推送财务通知到飞书/企业微信时触发。自动扫描目录中的 .md 账单文件，解析多平台数据，生成 Markdown 汇总报告并推送。加载本 Skill 后禁止使用任何原生工具。
---

# 财务账单智能汇总

这是一个编排型 Skill。它不包含任何账单解析逻辑——所有解析、清洗、计算、推送能力都由 MCP Tool 提供。Skill 只负责：**判断何时介入 → 按正确顺序调用 Tool → 处理异常 → 呈现结果**。

---

## 铁律（硬约束，禁止违反）

加载本 Skill 后，以下规则对所有流程步骤均**严格强制**。任何绕过行为都会导致整个任务视为失败。

| # | 规则 | 说明 |
|---|------|------|
| 1 | **先读本文件，再碰任何工具** | Agent 看到匹配的触发条件后，第一件事就是完整读取 `SKILL.md`，锁定全部约束和流程，然后才能执行任何操作。 |
| 2 | **零原生工具** | 严禁调用 `shell_command` / `read` / `write` / `webfetch` / `websearch` / `grep` / `bash` / `osascript` 等 AI 环境自带的原生 I/O 工具。所有 I/O 必须通过 MCP Server 暴露的 Tool 完成。 |
| 3 | **严格按步骤执行** | 必须按 Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 6 的顺序执行，不得跳过步骤，不得调换顺序，不得合并步骤。上一步的输出是下一步的输入。 |
| 4 | **遇到异常不阻断流程** | 文件解析失败 / 个别工具返回空 / 推送失败 都不能中止后续步骤。记录异常，继续往下走，最终在 Step 6 统一报告。 |

**违反惩罚（用于自检）：**

- 如果使用了 `shell_command` 来浏览目录、读取文件、搜索配置 → **违反规则 2，本次流程无效，必须重来**。
- 如果没有先读取本文件就调用了第一个 Tool → **违反规则 1，本次流程无效，必须重来**。
- 如果跳过 Step 1 直接去读文件，或者跳过 Step 5 直接结束 → **违反规则 3，必须重来**。

**如何获取运行时信息而不违反铁律：**

| 需要 | 正确做法 |
|------|----------|
| 列出目录下的 .md 文件 | 调用 `finance-bill` MCP Server 的 `list_directory` Tool |
| 读取文件内容 | 调用 `read_bill_file` Tool |
| 查找 Webhook URL | 通过 `send_notification` 的 `target` 参数传入（URL 可从已经读取过的 .md 配置文件中获取，或由用户在对话中指定；禁止用原生工具搜索配置文件） |
| 查看项目结构 | 通过 `list_directory` 遍历各层目录 |

---

## 触发条件

Agent 的**第一动作**必须是读取本 SKILL.md 文件。读取之前不得调用任何 Tool。

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

触发后 Agent 必须立刻读取本 SKILL.md 全文，锁定铁律和流程后再开始执行。

---

## 执行流程（不可跳过、不可调换顺序）

本流程共 6 步，严格按顺序执行。在开始 Step 1 之前，必须确保已将本 SKILL.md 全文读入上下文。

### Step 1 — `list_directory`

```
获取用户指定的目录下所有 .md 文件列表
```

- 如果用户未指定目录，询问用户提供路径
- 如果返回 `files: []`（无 .md 文件），**终止流程**并告知用户目录为空

### Step 2 — `read_bill_file`（循环）

```
对 Step 1 返回的每个文件，逐一调用 read_bill_file 读取原始内容
```

- 逐个文件处理，不要并行跳过
- 如果某个文件读取失败（`isError: true`），记录该文件到失败列表，**继续处理下一个文件**

### Step 3 — `parse_and_clean_bills`（循环）

```
对 Step 2 成功读取的每个文件，调用 parse_and_clean_bills
传入 raw_content（Step 2 的 content）和 source_file（文件名）
```

- 得到每个文件的结构化数据：`{ platform, records, parse_warnings }`
- 如果 `parse_warnings` 非空，记录下来——这些警告需要出现在最终报告中
- 如果某个文件的 `records` 为空，仍保留该条目（platform 信息有效），但在报告中标注"无有效记录"

### Step 4 — `generate_report`

```
将所有 Step 3 的结果合并为 bill_data 数组，调用 generate_report
传入 report_title（根据目录名和当前日期自动生成，如 "2026年3月财务汇总报告"）
传入 period（从目录名或文件名推断，如 "2026-03"）
```

- 得到一个完整的 Markdown 报告文本 + 汇总数据

### Step 5 — `send_notification`

```
用 Step 4 的报告文本作为 body，调用 send_notification
```

- Channel 默认为 `feishu`（可从用户指令中判断，如提到"企业微信"则用 `wecom`）
- Target：优先使用用户指定的 Webhook URL；用户未指定时，依赖 MCP Server 环境变量 `FEISHU_WEBHOOK_URL`
- Subject 使用 `report_title`

### Step 6 — 向用户展示

```
将 Step 4 的 Markdown 报告展示给用户，并汇报处理概况：
 1. 共处理 N 个文件，失败 X 个
 2. 共 M 条记录
 3. 总收入 / 总支出 / 净利润
 4. 通知发送状态（成功/失败 + 原因）
 5. 如有解析警告或失败文件，逐条列出
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

---

## 质量验收清单

交付给用户前，逐项自检：

- [ ] 全程未使用任何原生工具（`shell_command`、`read`、`write`、`grep` 等）
- [ ] 严格按照 Step 1 → 2 → 3 → 4 → 5 → 6 顺序执行
- [ ] 所有异常都已记录并在 Step 6 向用户展示，没有静默吞掉
