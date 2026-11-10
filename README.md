# dsh-lxj-remote

> **Fork 声明**：本仓库 fork 自 [`martinbear1/dsh-wechat-remote`](https://github.com/martinbear1/dsh-wechat-remote)（上游 `@harness-remote/dsh-wechat-remote` v1.7.16，commit `c1de4604`），上游以 **MIT License** 授权，版权声明与 `LICENSE` 文件完整保留。本项目在其基础上适配「梁小鲸」微信小程序与自托管中继，同样以 MIT 授权发布。

**在「梁小鲸」小程序里，接着用自己电脑上的 DeepSeek Harness。**

「**梁小鲸**」（AppID `wx49e5c049988127e7`）是手机端微信小程序，用来查看会话进展、发送任务、处理问答与审批、收取任务文件。本仓库提供配套的 **DSH 连接插件**：装在电脑上，让小程序连接你的 DSH。任务由电脑上的 DSH 执行，手机负责远程操作与查看。

**默认中继（relay）：`https://h-wxrelay.1day.wang`（自托管）。** 全新安装无需任何配置即可直连该中继；不再请求任何第三方中继服务器。电脑需保持开机、联网并运行 DSH，支持局域网直连与端到端加密公网连接。

插件当前版本：**1.0.0** · [发布页](https://github.com/terrywangt/dsh-lxj-remote/releases/tag/v1.0.0)

## 一、安装：在电脑 DSH 中添加插件

打开电脑上的 **DSH → 插件 → 添加插件**，粘贴下面的包名，安装并启用（Web 与 Desktop 同一包名）：

```text
dsh-lxj-remote@1.0.0
```

若你的 DSH 版本要求填写源码地址，使用 GitHub 直装格式：

```text
github:terrywangt/dsh-lxj-remote
```

按安装结果确认是否已生效；如提示需要重启，请结束任务后正常重启对应 DSH，然后打开 **设置 → 微信连接**，或进入插件详情页。

> 本仓库把构建产物 `lib/` 一并提交进 git，因此 `github:` 直装和 `npm pack` 两条路径都能拿到完整可运行代码，无需在本机重新执行 `tsc`/`esbuild` 构建。

## 二、配对：在「梁小鲸」小程序里扫码

1. **电脑上**：打开「微信连接」面板，点击 **生成二维码**。
2. **手机上**：打开微信里的 **梁小鲸** 小程序，按 **我的 → 远程服务 → 设备管理 → 配对新电脑** 进入扫码页。
3. **扫描电脑屏幕上的配对二维码**，按提示完成绑定。

二维码载荷（`{v:1,mode:"public-relay",relay,relayOrigin,nodeId,identityPublicKey,ticket,expiresAt,lan}`）与上游及「梁小鲸」配对页完全兼容，本 fork **未改动任何载荷格式**。

配对成功后，在小程序里打开会话列表继续跟进，或新建会话开始任务。Web 与 Desktop 是独立节点，使用哪一端就配对哪一端；多台电脑可分别添加。

## 三、升级：检查更新

在 **设置 → 微信连接** 或插件详情页点击 **检查更新**。更新目录取自自托管中继：

```text
https://h-wxrelay.1day.wang/v1/update-policy
```

中继必须返回符合插件 `update-policy` schema（`schemaVersion 1` + `revision`/`issuedAt`/`expiresAt`/`releases`/`blocked`/`retiredDsh`）的目录。若中继只提供占位目录（例如 `{"latest":null}`），插件会把它判定为不可用目录，并显示「兼容信息暂不可用，不影响现有连接」——**这是设计上的降级，不会回落到上游 `relay.xyxfood.xyz`**。发布新版本时请同步更新中继目录，目录中的 `asset.url` 必须是 `https://github.com/terrywangt/dsh-lxj-remote/releases/download/v<版本>/<文件>.tgz`。

## 四、持久化与兼容性（重要）

本 fork 只改**展示层与品牌层**，**不改**任何磁盘持久化路径与标识符，因此从上游升级不会丢失已有 nodeId、配对与局域网凭据：

| 保持不变的内部标识 | 位置 |
|---|---|
| 实例存储目录 | `~/.dsh/harness-remote/instances/<key>/` |
| 节点身份 | `…/instances/<key>/identity.json`（legacy：`~/.dsh/harness-remote-public-identity.json`） |
| 公网中继配置 | `…/instances/<key>/public.json`（legacy：`~/.dsh/harness-remote-public.json`） |
| 局域网门状态 | `…/instances/<key>/gate-wechat-state.json` |
| 存储布局标记 | `storage-layout.json` / `.storage-lock` / `storage-transaction.json` |
| 配对门端口派生盐 | `harness-remote-gate-v1`（Web 仍为 3092/3093，其他 profile 由 32000 起派生） |

因为路径完全兼容，**本 fork 没有一次性迁移代码，也不需要迁移**。已用 `public.json` 手工指定 `relayOrigin` 的用户：该显式配置优先，行为不变；只有**未写 `public.json` 的全新安装**才会使用内置默认中继 `https://h-wxrelay.1day.wang`。

## 五、连接风暴修复（相对上游 v1.7.16）

上游实测会出现 `enroll → ws online → 十几秒到一分钟后 offline → 再 enroll` 的循环（同一 nodeId 24 小时内 122 次 online）。本 fork 在插件侧做了四项修复：重连退避下限、身份租约互斥、握手重试不再轮换单次票据、心跳超时与中继判活窗口错开。详见 [RELEASE-NOTES.md](RELEASE-NOTES.md)；回归测试：

```text
node scripts/test-relay-connection-storm.mjs
```

## 六、开发与构建

```text
npm ci
npm run bundle      # 重新生成 lib/（tsc + esbuild client + typert）
npm run typecheck
npm run test:public-relay
```

上游许可证与第三方声明见 [LICENSE](LICENSE)、[THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES)。安全问题报告沿用 [SECURITY.md](SECURITY.md)。
