# OpenClaw Ubuntu 国内部署排错总结

日期：2026-03-25  
适用场景：Ubuntu 服务器、国内网络、源码部署 OpenClaw、额外加载第三方插件

## 一、核心结论

- 源码仓库只用 `pnpm`，不要在仓库根目录执行 `npm install <第三方插件>`。
- 第三方插件（如 `web-search-plus-plugin`）应安装在独立目录，并通过 `openclaw.json` 顶层 `plugins.load.paths` 加载。
- `pnpm install --frozen-lockfile` 失败时，先确认 `package.json` 与 `pnpm-lock.yaml` 是否一致。
- `restart` 失败不一定是异常，可能是 gateway 尚未运行或未安装 service。
- 飞书不生效最常见原因是：当前运行用户读取的 `~/.openclaw/openclaw.json` 不一致，或 `dmPolicy/groupPolicy` 限制了消息。

## 二、这次遇到的问题与原因

### 1) 构建/启动时大量 `Cannot find module`

典型模块：`grammy`、`@buape/carbon`、`@slack/web-api`、`@whiskeysockets/baileys`。  
根因：安装流程被中断、根目录依赖被污染、或读取了错误用户的状态目录。

### 2) `ERR_PNPM_OUTDATED_LOCKFILE`

根因：`package.json` 新增依赖（如 `web-search-plus-plugin`）但 lockfile 未更新，却使用了 `--frozen-lockfile`。

### 3) `ERR_PNPM_NO_MATCHING_VERSION openclaw@2026.3.14`

根因：镜像源缺少该版本；同时根项目不应额外安装 `openclaw` 包（源码仓库本身就是 openclaw）。

### 4) 配置校验失败

错误示例：

- `commands.plugins: expected boolean, received object`
- `commands: Unrecognized keys: session/channels/gateway`

根因：`commands` 对象未正确闭合，导致顶层字段被错误嵌套到 `commands`。

## 三、推荐部署结构

```text
/opt/openclaw/openclawmain                 # OpenClaw 源码目录（仅 pnpm）
/opt/openclaw/plugins/web-search-plus      # 第三方插件目录（npm 安装）
```

## 四、标准修复流程

### A. 清理源码根目录的误装依赖

```bash
cd /opt/openclaw/openclawmain
npm pkg delete dependencies.web-search-plus-plugin
npm pkg delete devDependencies.web-search-plus-plugin
npm pkg delete optionalDependencies.web-search-plus-plugin
npm pkg delete dependencies.openclaw
npm pkg delete devDependencies.openclaw
npm pkg delete optionalDependencies.openclaw
rm -f package-lock.json
rm -rf node_modules dist
```

### B. 重新安装并构建源码

```bash
pnpm install -r --no-frozen-lockfile
pnpm build
```

### C. 插件独立安装

```bash
mkdir -p /opt/openclaw/plugins/web-search-plus
cd /opt/openclaw/plugins/web-search-plus
npm init -y
npm install web-search-plus-plugin --registry=https://registry.npmjs.org/
```

### D. 在配置里加载插件（顶层 `plugins`）

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/opt/openclaw/plugins/web-search-plus/node_modules/web-search-plus-plugin"
      ]
    },
    "entries": {
      "web-search-plus-plugin": {
        "enabled": true
      }
    }
  }
}
```

## 五、飞书不工作时的排查顺序

1. 确认当前运行用户（root/node/ubuntu）与配置目录一致。  
2. 确认生效配置中存在 `channels.feishu`（不是改了另一个用户的 `~/.openclaw`）。  
3. 启动 gateway 前确认 `gateway.mode=local`。  
4. 检查飞书平台侧：Bot 能力、WebSocket 事件订阅、`im.message.receive_v1` 事件、应用发布状态。  
5. 排查策略拦截：`dmPolicy`、`groupPolicy`、`requireMention`。

## 六、常用命令速查

```bash
# 配置校验
jq . ~/.openclaw/openclaw.json >/dev/null && echo "JSON OK"
openclaw doctor

# 启动与状态
pnpm openclaw gateway
pnpm openclaw channels status --probe
pnpm openclaw logs --follow

# 配对检查（Feishu）
pnpm openclaw pairing list feishu
pnpm openclaw pairing approve feishu <CODE>
```

## 七、安全提醒

本次排查过程中出现过明文密钥（API Key、App Secret、Gateway Token）外泄风险。  
务必执行：

- 立即轮换所有已暴露凭据。
- 后续排错日志与聊天中使用脱敏值。
