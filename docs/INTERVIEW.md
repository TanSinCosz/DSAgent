# OpenCat 面试要点提炼

> 按模块拆解，每部分讲清楚"做了什么、为什么做、哪里难"。面试时挑 3-4 个最熟的讲。

---

## 一、整体架构 — State / Runtime 分离 + 三阶段请求流

**做了什麼**：把 Agent 运行时拆成两层——`State`（可序列化的对话数据）和 `Runtime`（瞬时依赖，如 API 客户端、工具列表）。请求处理分 Phase A/B/C 三阶段，将上下文压缩和运行时注入解耦。

**为什么难**：
- 大部分 AI Agent 项目把所有状态混在一起，无法持久化/恢复。State/Runtime 分离让 session 可以完整序列化为 JSONL 并跨进程恢复。
- Phase A/B/C 拆分解决了一个实际问题：运行时上下文（长期记忆、技能、Plan/Todo）如果在压缩之前注入，会被 auto-compress 吞掉，模型看不到。Phase C 单独注入解决了"压缩不碰易失内容"的时序问题。

**面试时可以说的数字**：支持多轮对话无限延续，session 可跨进程恢复。

---

## 二、上下文压缩 — 四级投影管道 + 三步压缩

**做了什么**：每条消息不是直接发给 DeepSeek，而是经过 4 层投影（摘要 → 预算 → 头尾预览 → 删除旧消息），外加 auto-compress 在第 2 轮基于投影 token 数触发永久压缩。

**为什么难**：
- 不是简单的"超出窗口就截断"。四个层级对应不同粒度的压缩策略，各自有独立的触发阈值（180K / 80K / 30K 等 8+ 个常量）。
- History Snip 支持**最多 8 次循环**逐步剥削旧消息，超 120K 时**全部回退**交给 auto-compress——有防御机制，不会过度压缩。
- Bulky Compact 将大工具结果持久化到磁盘，通过 `persisted_path` + `sha256` 引用来恢复。
- 投影**不碰权威历史** `state.Messages`——所有压缩是可逆的视图变换。即使 projection 被过度压缩，原始数据还在。

**面试时可以说的数字**：4 层投影 + 1 层 auto-compress，8+ 个可配置阈值，最多 8 次循环 snip。

---

## 三、工具系统 — Zod 运行时校验 + 并发模型 + 执行管道

**做了什么**：14 个内置工具 + MCP 动态工具，每个工具通过 Zod schema 定义参数约束，`executor.ts` 统一调度执行。

**为什么难**：
- Zod `safeParse` 不抛异常——校验失败把错误消息作为 tool result 返回给 DeepSeek，让模型**自己修正参数**，而不是直接报错停掉。
- `semanticNumber`/`semanticBoolean` 预处理：LLM 经常返回 `"timeout": "60000"`（字符串），`semanticNumber` 自动将其转为 `60000`（数字），大幅减少校验失败。
- 并发模型：`partitionToolCallsForExecution()` 按 `isConcurrencySafe` 将工具分组——安全的用 `Promise.all` 并行，不安全的串行，在安全和速度之间找平衡。
- 执行管道有 schema 校验 → 预处理 → 执行 → 落盘 → 格式化等完整的生命周期。

**面试时可以说的数字**：14 个内置工具 + 动态 MCP 工具，每个有 Zod schema + semantic preprocessor。

---

## 四、MCP 协议 — Stdio + Streamable HTTP 双传输

**做了什么**：完整实现了 MCP（Model Context Protocol），支持 Stdio（子进程管道）和 Streamable HTTP 两种传输方式，含 JSON-RPC 2.0 握手、工具发现、`tools/call` 调用全流程。

**为什么难**：
- MCP 是 Anthropic 2024 年底推出的协议，到你写这个项目时生态还不完善。你不是"用别人的 SDK"，是**自己写了整个 Client**。
- 理解了旧的 HTTP+SSE（双端点）为什么被废弃（EventSource 只支持 GET、认证困难、不兼容 Serverless），到新的 Streamable HTTP（单 POST）的演进逻辑。
- Stdio 的 Pending Map 机制：通过 `readline` 逐行读取 stdout，用 `id` 匹配请求和响应，在 Node.js 环境实现了类似浏览器的消息匹配。
- Schema 双轨制：MCP Server 的 JSON Schema → Zod schema 的适配，保证工具参数校验和类型安全。

**面试时可以说的数字**：支持 2 种传输、JSON-RPC 2.0 完整实现、含 `initialize` → `initialized` 两段握手。

---

## 五、Agent 系统 — 三种执行模式 + Worktree 隔离

**做了什么**：Agent 工具可以 fork 子 agent 独立执行任务，支持 sync（同步等待）、async（后台运行，通过 SendMessage 通信）、fork（继承父对话上下文）三种模式，支持 git worktree 隔离。

**为什么难**：
- Fork 模式：子 agent 继承父 agent 的完整对话上下文，但在隔离的工作区中运行——互不干扰。
- Worktree 隔离：利用 `git worktree` 在临时目录中 checkout 代码，子 agent 的修改不会影响父 agent 的工作目录。
- 父-子通信：async 模式下通过 `SendMessage` 工具排队发送消息，子 agent 在空闲时消费。
- 子 agent 的类型专业化：Explore（只读探索）、Plan（架构规划）、verification（验证）、worker（专注实现）。

**面试时可以说的数字**：3 种执行模式、5 种子 agent 类型、支持 worktree 隔离。

---

## 六、Skill 系统 — 渐进加载 + Fork 执行

**做了什么**：实现了 Anthropic 的 Skill 规范——通过 `SKILL.md` 文件定义可复用的指令集，支持三级渐进加载、条件性激活、fork 子 agent 执行。

**为什么难**：
- 渐进加载（Progressive Disclosure）不是一次性加载所有 Skill 内容——先是元数据（name + description），模型匹配后用 `ReadSkill` 工具读取正文，再按需执行脚本/引用文件。每一步只加载必要的内容，节省上下文。
- `paths` 字段的条件性激活：Skill 不是全局生效的——只有当 Agent 的当前工作路径匹配特定 glob 时，Skill 才被激活。比如 "只有进了 `frontend/` 目录才激活 React Skill"。
- `context: fork` 支持：Skill 可以声明在隔离子 agent 中执行，避免 Skill 内容污染主对话上下文。
- `allowed-tools` 安全限制：执行 Skill 时临时限制可用工具白名单，防止恶意 Skill 调用不该调的工具。

**面试时可以说的数字**：3 级渐进加载、2 种激活方式（全局 + 条件性）、支持 fork 隔离执行。

---

## 七、长期记忆 — 文件系统 + Dream 提取

**做了什么**：基于文件系统的持久化记忆，通过 Dream 机制（隐式记忆提取）和 Session Memory（显式对话笔记）双重维护长期上下文。

**为什么难**：
- 不依赖数据库或向量存储——纯文件系统 + Markdown，简单可靠。每个记忆一个 `.md` 文件，索引在 `MEMORY.md` 中。
- Dream 机制：在 Agent 空闲时，后台提取对话中的关键信息并存入长期记忆——不需要用户显式说"记住这个"。
- Session Memory：fork 一个专门的子 agent（`session_memory` 类型），滚动生成结构化的对话笔记，存储在 `.opencat/session-memory/` 中。
- 上下文注入：长期记忆通过 `<long_term_memory>` XML 标签注入到 `<opencat_context>` 中，每轮 Phase C 动态刷新。

**面试时可以说的数字**：2 种记忆类型（长期 + Session）、基于文件系统、零外部依赖。

---

## 八、评测系统 — SWE-bench Verified

**做了什么**：在 SWE-bench Verified 数据集上自动化评测 OpenCat 的"修 bug 能力"。支持 serial（两阶段：先调查再改代码）和 cache（多轮累积上下文）两种评测模式。

**为什么难**：
- 不是简单的"跑个脚本看准确率"。涉及 `git clone --mirror` 裸仓库 → `worktree add --detach` 分离指定 commit → Agent 修改代码 → `git diff --binary` 产出 patch 的完整流程。
- Bare clone 共享 + worktree 复用：同一个 repo（如 django/django）的多个 issue 共享一个 bare clone，每个 issue 只占用一个轻量 worktree，大幅节省磁盘和 clone 时间。
- 遥测数据采集：每轮 API 调用的 token 消耗、缓存命中率、工具调用分布、压缩触发次数全部记录到 `events.jsonl`。
- 支持两阶段提示词（先禁止 Edit/Write 让模型专注调查，再开放修改权限），模拟真实的 debugging 流程。

**面试时可以说的数字**：支持 SWE-bench Verified 数据集，bare clone + worktree 架构，完整遥测管线。

---

## 面试话术速查表

| 面试官问 | 你讲哪个模块 | 金句 |
|----------|-------------|------|
| "你这个项目难在哪？" | **上下文压缩** | "四级投影管道，投影不碰原始数据，snip 有 8 次循环 + 120K 回退机制" |
| "怎么保证代码质量？" | **工具系统** | "Zod 运行时校验，校验失败不崩溃，把错误返回给模型让它自己修正" |
| "你对 AI 前沿有关注吗？" | **MCP 协议** | "自己实现了 MCP Client，Stdio + Streamable HTTP 双传输，理解了 SSE 为什么被废弃" |
| "有没有架构设计经验？" | **整体架构** | "State/Runtime 分离，Phase A/B/C 解耦压缩和运行时注入" |
| "你怎么测试自己的项目？" | **评测系统** | "接了 SWE-bench Verified，用了 bare clone + worktree 的评测架构" |
| "你考虑过安全吗？" | **Skill 系统** | "allowed-tools 白名单，context: fork 隔离执行" |

---

## 一句话总结（电梯演讲）

> 我做的是一个 AI 编程 Agent 框架。核心解决了 LLM 长对话中上下文窗口不够用的问题——我设计了一个四级压缩管道，投影不碰原始数据，有完整的回退和防御机制。同时也实现了 MCP 协议、多 Agent 协作、Skill 渐进加载和 SWE-bench 评测。不是调 API 的 Demo，是能跑真实修 bug 评测的工程级项目。
