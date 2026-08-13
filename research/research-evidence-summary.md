# TaskGuard 候选方向：实时研究证据摘要（2026-08-13）

## 实时 GitHub 信号

GitHub Trending 当日页面显示 `stablyai/orca`（44,092 stars，页面显示当日新增 1,235）与 `msitarzewski/agency-agents`（144,682 stars，页面显示当日新增 1,873），表明并行 Agent/ADE 是注意力密集的主赛道。GitHub Trending 本周显示 `TencentCloud/TencentDB-Agent-Memory`（20,719 stars，本周显示新增 5,720）、`google/skills`（17,933 stars，本周显示新增 2,288）、`huangruiteng/loopx`（4,441 stars，本周显示新增 2,509）和 `zhaoxuya520/reverse-skill`（24,540 stars，本周显示新增 5,573）。本月页面继续出现 Agent Memory、Skills、跨 Agent 网关和 Orchestration 项目。

来源：

- https://github.com/trending?since=daily
- https://github.com/trending?since=weekly
- https://github.com/trending?since=monthly

## 22 个代表性项目的 GitHub API 实时样本

原始结构化数据：`selected-projects.json`；表格：`selected-projects.tsv`。关键项目及 GitHub API 查询时的 stars：

| 类别                    | 项目                                |   Stars | 观察                                       |
| ----------------------- | ----------------------------------- | ------: | ------------------------------------------ |
| Coding agent            | openai/codex                        | 105,592 | 终端编码 Agent。                           |
| Coding agent            | anomalyco/opencode                  | 196,703 | 开源 coding agent，类别极其拥挤。          |
| Coding agent            | google-gemini/gemini-cli            | 106,495 | 终端 agent。                               |
| Coding agent            | cline/cline                         |  66,096 | SDK、IDE extension、CLI。                  |
| Coding agent            | aaif-goose/goose                    |  52,738 | 可扩展 agent。                             |
| Fleet                   | stablyai/orca                       |  44,095 | 并行 Agent ADE。                           |
| Fleet                   | huangruiteng/loopx                  |   4,443 | long-running Agent team state kernel。     |
| Fleet                   | ruvnet/ruflo                        |  67,749 | meta-harness/swarm。                       |
| Async coding            | langchain-ai/open-swe               |  10,545 | 异步 coding agent。                        |
| Shared instructions     | agentsmd/agents.md                  |  23,609 | AGENTS.md 开放格式。                       |
| MCP ecosystem           | punkpeye/awesome-mcp-servers        |  92,177 | MCP server 目录。                          |
| MCP ecosystem           | modelcontextprotocol/servers        |  89,508 | MCP server 实现。                          |
| Agent memory            | TencentCloud/TencentDB-Agent-Memory |  20,719 | 团队 Agent memory。                        |
| Agent memory            | thedotmack/claude-mem               |  90,570 | 跨 Agent persistent context。              |
| Skills                  | addyosmani/agent-skills             |  86,658 | 编码 Agent engineering skills。            |
| Skills                  | google/skills                       |  17,934 | Google Agent Skills。                      |
| Multi-harness ecosystem | wshobson/agents                     |  38,751 | 多 harness plugin marketplace。            |
| Governance              | microsoft/agent-governance-toolkit  |   5,895 | policy、identity、sandbox 与 reliability。 |
| Governance curation     | agentrust-io/awesome-ai-governance  |      29 | AI governance 资源目录。                   |

## 官方格式与真实痛点

GitHub 官方文档确认 Copilot 支持 `.github/copilot-instructions.md` 的全仓库指令、`.github/instructions/**/*.instructions.md` 的按路径指令以及任意位置的 `AGENTS.md`；最近的 `AGENTS.md` 在目录树中优先。Copilot 文档还说明可使用根目录 `CLAUDE.md` 或 `GEMINI.md` 作为 agent instructions。Claude Code 官方 memory 文档确认：`CLAUDE.md` 是上下文而非强制执行机制；要阻止动作，应使用 PreToolUse hook；它支持 root / nested `CLAUDE.md`、`.claude/rules/` 路径规则、imports、MCP 等。AGENTS.md 官网称该格式已被 60k+ 开源项目采用，并且嵌套 AGENTS.md 以最近路径规则作为优先级。

这意味着“人类可读指令”趋于可移植，但“跨 Agent 的确定性、可审计、执行前边界编译与预检”仍不是上述格式本身解决的问题。

来源：

- https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot
- https://docs.github.com/en/copilot/reference/custom-instructions-support
- https://docs.anthropic.com/en/docs/claude-code/memory
- https://agents.md/

## 社区痛点

近期检索到的 Hacker News 和 Reddit 讨论涉及：开发者反复向 Agent 解释项目上下文；多层 CLAUDE.md / 规则如何避免冲突；在自动模式下仅在探索阶段授权并审阅完整 transcript；MCP 信任和 prompt injection 风险；以及 AI 代码的质量门与审计责任。相关论文搜索结果还包括 “How AI Policies Reshape Developer Experience on GitHub”（2026-08）。

来源：

- https://news.ycombinator.com/item?id=49169640
- https://news.ycombinator.com/item?id=49239021
- https://www.reddit.com/r/ClaudeCode/
- https://arxiv.org/html/2608.03329v1

## 选题结论

不应复制执行器、fleet、memory、skills marketplace 或通用 governance toolkit。可行的独立项目是一个名为 **TaskGuard**（临时候选）的本地优先 **repository intent compiler / agent preflight**：扫描既有规则，生成带 provenance 的 `.agent-policy.yml`，为文件、命令、网络、MCP、required checks、人工确认和 AI disclosure 提供确定性 evaluator，并通过 CLI、read-only MCP 和 GitHub Action 供任意 coding agent 在执行前查询。

它与用户已有项目的边界：TaskToPR 负责“从 Issue 到变更/PR”；PatchWitness 负责“变更后的独立证据和 gate”；TaskGuard 只负责“变更前/执行中意图编译、规则冲突和策略预检”，集成是可选的。
