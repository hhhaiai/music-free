# Music Free V4.1 — Architecture

本架构以 **本地优先、可替换 Provider、明确的播放身份边界** 为原则。V4.1 是 V3.9 工程上的渐进重构；旧模块暂时提供兼容导出，不宣称所有技术债都已消除。

## 1. 依赖方向

```text
Presentation (src/presentation/)
  ↓ 调用
Application (src/application/ 与 src/bootstrap/)
  ↓ 依赖端口／领域规则
Domain (src/domain/music/)
  ↑ 由 Infrastructure 实现端口
Infrastructure (src/infrastructure/, server/)
```

- **Domain**：`types.ts`、`identity.ts`、`metadata.ts`、`entities.ts`、`sourceRanking.ts`、`recommendation.ts`、`concertChapters.ts`、`regions.ts`。核心身份规则不依赖 React、网络、数据库。
- **Application**：`ports/musicProvider.ts` 定义来源能力接口；`use-cases/musicDiscovery.ts` 汇聚搜索、发现；`resolveCatalogAudio.ts` 匹配歌名／歌手／录音身份及音源健康状态。
- **Composition Root**：`bootstrap/compositionRoot.ts` 负责注入实际 Provider。更换 Provider 的入口应在这里，而非修改 UI。
- **Infrastructure**：各种音乐和视频 Provider、IndexedDB、FFmpeg.wasm、HTMLMediaElement 控制器、本机 Node Core 与 SQLite WAL。
- **Presentation**：`presentation/App.tsx`、`presentation/components/` 和 `presentation/hooks/`，包括沉浸式卡片、同步歌词和演唱会章节卡片。

## 2. 迁移兼容层

`src/App.tsx`, `src/types.ts`, `src/providers/*`, `src/components/*`, `src/engine/*`, `src/lib/*` 的一部分仍是兼容导出或旧代码入口，方便从 V3.9 平滑迁移和维持插件/测试引用。新的扩展优先进入上述分层目录；逐步移除兼容层必须配套测试和迁移记录。

> 技术债：`src/presentation/App.tsx` 仍包含较多 React 状态和页面编排，尚未拆成完整的独立页面模块。这是未来增量重构点，不作为 V4.1 已完成的事项。

## 3. 音乐身份与音源边界

```text
歌曲目录（Apple/iTunes 等）
    -> 标准曲目/歌手/版本信息
    -> 严格匹配（同曲同歌手、可选 Recording/ISRC 等）
    -> 音源候选评分（时长、版本、许可、健康）
    -> 同一录音的独立可播放音源
    -> 浏览器 Audio 控制器
```

- 「目录中有歌曲」**不等于**「找到了可播放的商业原版音频」。
- 原唱优先，允许用户另选翻唱，但自动回退不应跨歌手或跨录音身份。
- 元数据里的「原唱」「版本」「地区」标记存在未知/低置信度情况；不能把启发式识别当成权威证明。
- 来源能力声明区分 `search`、`trending`、`independentAudio`、`licenseMetadata`、`videoSearch`、`officialEmbed`。
- YouTube / Bilibili 采用官方搜索/公开链接与允许的内嵌播放；不绕过访问控制，不把其受保护视频音轨转换为独立音频。

## 4. 本地存储与自动发现

| 数据 | 当前主存储 | 说明 |
|---|---|---|
| 歌单、收藏、历史、导入歌曲、播放快照、LRC | 浏览器 IndexedDB / localStorage | 沿用既有浏览器数据库名；更换浏览器 Profile 不会自动迁移 |
| 后台发现快照、Provider 状态、任务状态、音源健康、TTL 元数据 | Mac 本地 SQLite WAL | 默认 `~/.music-free/music-free.sqlite`，不依赖浏览器缓存 |
| 本地音视频处理临时结果 | 浏览器内存 Blob | 不上传；关闭页面后释放 |
| 远程音视频媒体字节 | 无应用级持久缓存 | 浏览器及源站决定流缓存行为 |

`server/scheduler.mjs` 具备持久任务状态、并发上限、超时、指数退避、失败保留最后成功快照。`server/tasks/discovery.mjs` 注册多来源元数据发现；不保证某个国家/语言所有热门商业歌曲都能播放。

## 5. 播放与可视化

- `infrastructure/playback/playbackController.ts` 包装 HTML5 Audio 的播放/暂停/定位/音量，现阶段播放队列和部分事件状态仍由 React 管理。
- `presentation/components/ImmersivePlayer.tsx` 提供专辑卡片、歌词舞台、动态视觉三种场景。当前动态频谱为 **CSS 动画视觉效果**，**不是**基于真实音频 FFT 的频谱分析；这是一个明确保留的增强项。
- `presentation/components/ConcertSetlistPanel.tsx` 解析用户提供的公开视频描述时间戳；点击曲目在官方播放器允许的情况下定位播放，不抓取隐藏章节或下载平台视频。
- `infrastructure/media/localExtractor.ts` 使用 FFmpeg.wasm 为用户选择的本地授权视频识别音轨/视频轨；不处理受保护在线视频流。

## 6. 可扩展点和约束

1. 新增音乐源：实现 `MusicProviderPort` 并在 `infrastructure/providers/registry.ts` 注册；由 Composition Root 注入，不直接在 UI 使用第三方 SDK。
2. 新增平台视频：在 `infrastructure/providers/video/` 实现官方搜索或官方嵌入能力，独立声明支持范围。
3. 新增推荐策略：修改领域层 `recommendation.ts`，保持纯函数，增加回归用例。
4. 更换磁盘数据库：仅替换 Local Core 的 Store 实现并保留 `/api/local/*` 契约及迁移测试。
5. 新增视觉主题：通过 Presentation 的 CSS tokens 和组件 props，不能改变后台 Provider 或播放身份。
6. 保持本地环回监听和 Origin/Host 校验；Provider 凭据只存放本机环境配置，绝不提交 `.env`。
7. 逐次发布应通过 `npm test`、`npm run check`、`npm run build`，并在 Mac 上进行真实搜索、嵌入播放及本地媒体测试。

## 7. Git 的历史语义

仓库包含从已有 ZIP **追溯导入的版本快照提交** 和这次正式制作的 V4.0/V4.1 工程提交。追溯导入的 Commit 日期是 **本次归档日期，不等同于当年原始开发提交日期**；它们让你能够执行 `git diff v3.8.0 v3.9.0`，但不能被理解成恢复了此前不存在的真实 Git 原始历史。详见 `GIT_HISTORY.md`。

## 8. V4.1.1 搜索和播放链路重构

```text
用户查询
    -> Domain.searchIntent (纯函数：歌曲/歌手/自由文本/歧义)
    -> Domain.verifiedCatalog (4 条经过核对的参考元数据；非独立音频)
    -> Application.catalogSearch (歌曲身份过滤、已核对优先排序)
    -> Infrastructure.appleCatalog (按需查询 Apple 公开目录；最多三个地区，缓存)
    -> Application.resolveCatalogAudio (查找可用的独立音频：严格歌名/歌手/版本)
    -> Application.startBufferedPlayback (先调用播放再并行等缓冲)
    -> Infrastructure.HTMLAudio / 失败冷却
        └── 完整独立音频不存在时，可选官方 YouTube 嵌入
             -> Presentation.OfficialVideoStage (仅官方 iframe，本站不重托管媒体)
```

新增组件只依赖领域类型和播放选择接口；它不会解析/下载 YouTube 媒体，也不会向其他音源写入视频流。`App.tsx` 仍承担若干编排状态，下一次大重构前须先建立浏览器端到端测试，避免重演破坏既有功能的情况。

### 查询准确性策略

- 明确的 `歌名 - 歌手`／`歌手 - 歌名` 分隔、少量人工核对的简繁/俄文/艺名别名。
- 已核对的标准曲目可在离线/目录不可达时立即显示；这不等同于在线播放能力。
- 用户没有指定歌手的歧义词（例如单独搜索「星星」）不应自动归属 Vitas。
- 目录结果按明确的目标歌手和曲名严格筛选；歌手不符、无人署名、Live／Remix 版本不会默认为原唱录音。
- 对没有可靠录音 ID 的结果，歌名+歌手+时长匹配只代表**元数据匹配**，不是录音指纹认证。

### 启动与缓冲

- 后台 Audius 热门任务的初次延迟设为 0，Local Core 轮询由 30 秒降为 5 秒；其他服务逐步错峰。
- 点击独立音频播放先调用 `HTMLMediaElement.play()`，随后并行验证缓冲是否达到当前网络策略。已开始播放但没有可靠 `TimeRanges` 的来源，不再无意义等待 26 秒。
- 用户选择另一首时会中断过期搜索/匹配；上一个失败音源的 `current` / `src` / queue 会清理，不再显示为正在播放。
- 已核对官方视频的无独立音源匹配有 7 秒超时预算，优先回退至网页内的官方 iframe；不提供非法媒体提取。

### 可扩展性

1. 增加艺术家/歌曲别名：修改 Domain `searchIntent.ts`，并添加场景测试。
2. 增加人工核对的官方视频：修改 Domain `verifiedCatalog.ts`，必须提供可核对的官方出处和真实 ID；**不能将普通上传/翻唱假冒官方**。
3. 增加目录来源：实现 Infrastructure Provider，再由应用层 `catalogSearch.ts` 综合排名；不得把资料当成完整音频。
4. 增加可播放独立来源：实现 `MusicProviderPort` 并注册；保证时长、许可、媒体地址/状态都满足边界。
5. 新增播放适配器：保持队列和播放身份独立于具体平台及 UI。
