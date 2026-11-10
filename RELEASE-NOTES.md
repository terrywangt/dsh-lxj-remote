# dsh-lxj-remote 1.0.0

Fork 自 `martinbear1/dsh-wechat-remote` v1.7.16（commit `c1de4604`，MIT）。本版本以「梁小鲸」小程序 + 自托管中继为目标重新配置，并修复上游公网中继的连接风暴。版本号从 1.7.16 重置为 1.0.0，作为本 fork 的独立发布线起点。

## 与「梁小鲸」搭配

- 手机端小程序：**梁小鲸**（AppID `wx49e5c049988127e7`）。
- 配对入口：**我的 → 远程服务 → 设备管理 → 配对新电脑**。
- 二维码载荷格式与上游完全一致（`{v:1,mode:"public-relay",relay,relayOrigin,nodeId,identityPublicKey,ticket,expiresAt,lan}`），未做任何改动；「梁小鲸」配对页解析的 `ticket||t`、`nodeId||n`、`relayOrigin`、`identityPublicKey`、`lan.host/port` 均可直接对接。
- 业务后端：`https://tool-api.1day.wang`（配对落库 `POST /rev/remote/pair`）由「梁小鲸」侧调用，插件不参与。

## 默认中继改为自托管

- `DEFAULT_PUBLIC_RELAY_ORIGIN` → `https://h-wxrelay.1day.wang`（NAS 自建，容器内监听 8790）。
- 更新目录 / 策略目录（`update-service`、`other-endpoint-info`、`update-download` 的 host 白名单）全部指向同一自托管域名，**插件不再向 `relay.xyxfood.xyz` 发起任何请求**。
- 若中继 `/v1/update-policy` 未提供符合 schema 的目录，「检查更新」降级为「兼容信息暂不可用，不影响现有连接」，不会回落到上游服务器。
- 已手工写 `public.json` 指定 `relayOrigin` 的实例行为不变：显式配置优先于内置默认值。

## 连接风暴修复（插件侧）

上游现象：同一 nodeId 在 24 小时内 `ws online` 122 次，模式为 `enroll → online →（10s~60s）→ offline → 再 enroll`，偶发 3 秒内连续 3 次 enroll。本版本的修复：

1. **重连退避下限**：首次重连由 ~1s 提升到 **5s** 下限，上限由 30s 放宽到 **120s**。退避计数不再在 socket 刚 `open` 时清零，而是要求连接**存活超过 3s 的 settle 窗口**才计为成功；此前"打开几秒即被踢"会让阶梯每次都从头开始，形成风暴。
2. **配对刷新互斥**：`ensurePairingTicket(refresh)` 在已有连接/已有进行中的 lifecycle 时不再无条件再发一次 enroll + 第二条 socket；同一身份的并发刷新合并为一次请求。
3. **握手重试不再轮换单次票据**：仅 WebSocket 握手超时/被拒的重试复用上一次已接受的 enroll 结果，避免每次重连都让手机正在扫的二维码失效。
4. **跨进程身份租约（relay transport lease）**：在 `~/.dsh/harness-remote/instances/<key>/relay-leases/<hash>.lock` 用目录 rename 原子锁记录 `{pid,token,heartbeatAt}`，每 15s 续租。同一 nodeId 的第二个宿主进程（例如同一 profile 里装了两个插件副本）不再 enroll、不再抢中继的单一 agent 槽位，而是显式说明"由另一宿主进程持有"，并在 5s 后重试；持有者进程消失或心跳超过 45s 时立即可接管。可用 `HARNESS_REMOTE_RELAY_LEASE=0` 关闭。
5. **心跳参数**：客户端 ping 间隔 25s → **20s**，pong 超时 50s → **45s**，与中继侧 `MISS_TOLERANCE=3` 的 25s 探测窗口错开，避免两端同时判定对方失活而互相重启连接。

回归测试：`node scripts/test-relay-connection-storm.mjs`（已并入 `npm run test:public-relay`）。

## 兼容性

未改动任何持久化路径与内部标识符：`~/.dsh/harness-remote/`、`instances/<key>/identity.json`、`public.json`、`gate-wechat-state.json`、`storage-layout.json`、legacy 名 `harness-remote-public.json`、端口派生盐 `harness-remote-gate-v1`（Web 仍为 3092/3093）全部保持原样，**因此从上游升级不会丢失 nodeId、配对或局域网凭据，本版本不含也不需要迁移代码**。

## 安装

```text
DSH → 插件 → 添加插件 → github:terrywangt/dsh-lxj-remote
```

本 fork 尚未发布到 npm registry（需要 npm 账号授权），因此 `dsh-lxj-remote@1.0.0` 这种 registry 写法暂不可用；离线场景请下载 Release 附带的 `dsh-lxj-remote-1.0.0.tgz`。

`lib/` 构建产物与运行时依赖闭包（`vendored-deps.json` 列出的 67 个包）都随仓库提交，因为 `github:` 安装会把仓库本地打包、不会为 git 源拉取 `bundleDependencies`——缺依赖会让 gate 在加载阶段报 `Cannot find package 'qrcode'`（上游 1.7.16 的实际故障）。

## 上游差异一览

| 项目 | 上游 1.7.16 | 本 fork 1.0.0 |
|---|---|---|
| 包名 | `@harness-remote/dsh-wechat-remote` | `dsh-lxj-remote`（无 scope，便于插件页直接粘贴） |
| 默认中继 | `https://relay.xyxfood.xyz` | `https://h-wxrelay.1day.wang` |
| 更新目录 | `https://relay.xyxfood.xyz/v1/update-policy` | `https://h-wxrelay.1day.wang/v1/update-policy` |
| 小程序品牌 | Agent远程管理助手 / 鲸常在 | 梁小鲸（`wx49e5c049988127e7`） |
| 中继租约 | 无 | 有（跨进程互斥） |
| 重连退避 | 1s 起、30s 封顶、open 即清零 | 5s 起、120s 封顶、存活 3s 才清零 |
