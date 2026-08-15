# dsh-anchored-standard

[English](./README.md)

DeepSeek Harness（DSH）实验性 agent 预设：首轮模型请求沿用 Minimal 对齐的开局
（仅 `bash` + `read` 两个工具、固定一句 system prompt），首个持久化工具调用或
首次回复之后，自动恢复 Standard 预设的完整工具目录。双形态发布：**安装器
bundle**（`dsh plugin add` 一键安装）与**手动预设目录**。

本项目是社区项目，非 DeepSeek 官方预设，与 DeepSeek 无隶属或背书关系。

## 原理

DeepSeek V4 Pro 对**首次请求**的 API 可见工具目录高度敏感。社区评测
[`xiaobright/modeltest`](https://github.com/xiaobright/modeltest) 在同一冻结
题面上测得：官方 Minimal 预设 99/96，Standard 与 PTC 仅 91/92；而"Minimal
开局、首个工具调用后恢复完整 25 项 Standard 目录"的两阶段预设连续得到 98/99
——增益来自首轮轨迹锚定，而非全程限制工具数量。原始设计出自
[`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard)；
本仓库是独立实现，并在 harness `0.1.0-rc.6` 上以 wire 层 `request/header`
快照验证（首次请求 2 个工具，第二次请求起完整目录）。

每个会话的流程：

1. system prompt 固定为 Minimal 原句
   `You are a helpful software engineer assistant.`；
2. 首次模型请求只暴露平台 shell（`bash`/`pwsh`）+ `read`；
3. 会话产生首个持久化晋升信号——`tool/call` 或首个 `assistant/message`
   （先到者为准）——之后所有请求暴露完整 Standard 目录。请求 #1 永远是
   bootstrap 目录，请求 #2 永远是完整目录，纯文本首轮回复也不会把会话困在
   窄目录里。

晋升状态由持久化会话事件推导，刷新与恢复会话均保持。

## 安装

### 方式 A：安装器 bundle（推荐）

```sh
dsh plugin --profile web add github:Jungod1121/dsh-anchored-standard
```

随后完全重启 DeepSeek Harness。启动时 bundle 会把预设幂等复制到用户预设根
目录（`$DSH_HOME/.agent-presets/anchored-standard/`，已存在的文件绝不覆盖），
预设随即出现在会话预设列表中。新建空白会话并选择「锚定标准模式」。不要在
活跃会话上切换预设。

如需设为新会话的默认预设，在 `$DSH_HOME/settings.yaml` 中设置
`agent-presets.default: anchored-standard`。

### 方式 B：手动预设目录

克隆本仓库，把整个 `preset` 目录复制到用户预设根目录下，id 为
`anchored-standard`：

```sh
dsh_home="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$dsh_home/.agent-presets"
cp -R preset "$dsh_home/.agent-presets/anchored-standard"
```

roster 会在进程运行中动态发现用户预设；新建空白会话并选择「锚定标准模式」。

## 卸载

```sh
dsh plugin --profile web remove dsh-anchored-standard
```

卸载 bundle 不会删除已安装的预设。手动删除预设：

```sh
rm -rf "${DSH_HOME:-$HOME/.dsh}/.agent-presets/anchored-standard"
```

## 验证

导出会话 JSONL 检查 `request/header` 事件：第一个 header 应只含
`bash/read`（Windows 为 `pwsh/read`），之后的 header 应含完整 Standard
目录。

## 兼容性

基于 DeepSeek Harness `0.1.0-rc.6` 开发与验证。harness 处于 developer
preview 阶段并明确允许破坏性变更，升级前请先核对上游改动。

## 成绩与证据边界

锚定机制（首轮 bootstrap 目录 → 后续完整目录）已在 rc.6 上于 wire 层验证。
98/99 的能力分来自 [`xiaobright/modeltest`](https://github.com/xiaobright/modeltest)
Project2 V4.1b——同一冻结题面 n=2。这是该题面的可复现证据，**不构成**跨
模型、跨任务的通用提升承诺。

## 许可证

MIT。见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。
