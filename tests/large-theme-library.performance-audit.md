# 大型主题库性能审计与隔离基线

日期：2026-08-08

分支：`perf/large-theme-library`

边界：未修改生产代码；fixture 全部位于新的无头浏览器上下文、内存、临时 localStorage/IndexedDB 和 mock HTTP 响应中；没有读取或写入真实 SillyTavern 主题目录。

## 结论摘要

1000+ 无截图主题最可能的前三个瓶颈：

1. **全量 DOM 创建、替换和布局**：普通主题每张卡平均约 10.96 个元素；1000 个主题产生 11,020 个管理器元素，2000 个产生 21,982 个。`renderGrid()` 每次拼完整 HTML，再执行一次 `area.innerHTML = html`。
2. **每次交互都重建整个列表并重新绑定逐卡事件**：搜索每个字符、分类、排序、收藏、切换成功、编辑保存都会进入 `renderGrid()`。正常模式每张卡固定 2 个监听器，1000 个主题约 2,036 个管理器监听器，2000 个约 4,036 个。
3. **冷切换和事务读取完整 settings inventory，并深拷贝所有完整主题到长期 cache**：打开列表本身不读取完整 inventory，但第一次切换 cache miss 会读取 `/api/settings/get`，解析完整 settings 响应，并对每个可用主题执行 JSON 深拷贝。混合 CSS 数据下，1000/2000 主题的 mock themes payload 分别约 4.25/8.50 MiB；切换后关闭管理器，额外保留的 heap 约 4.70/8.97 MiB。

存在 O(N²)，但需要区分路径：

- 普通、无日夜/系列、非批量的首次列表路径主要是 `O(N log N)` 排序 + `O(N)` 派生、HTML 和监听器。
- 批量全选状态中，`batchSelected.indexOf()` 被每张卡调用，并且多处对每个选中 key 调用会重建整个列表的 `getLogicalItem()`，最坏 `O(N²)`。
- 大量日夜组合时，每张组合卡取 meta/变体会再次 `ensureState()` 遍历全部 pair，最坏 `O(P²)`；某些排序比较器又会重复进入该路径。
- 批量保存/删除/联合验证用 `runtime.findTheme()` 对每个目标线性扫描完整 inventory，为 `O(KN)`；批量导入的文件名冲突检测也有嵌套 `some()`，为 `O(KN)`。

## 生命周期与调用链

### 1. 启动与打开

1. `index.js:24-53` 顺序加载模块并调用 `createUiMain(...).start()`。
2. `src/ui-main.js:5711-5743` 初始化样式、launcher/FAB、storage 和 binding controller。
3. `src/storage.js:232-255` 从独立后端或 IndexedDB/localStorage 初始化 metadata；`src/ui-main.js:247-277` 的 `ensureDefaults()` 会遍历全部 `themeMeta`。
4. 点击 launcher 进入 `src/ui-main.js:3113-3270 openPopup()`：创建固定外壳、绑定头部/搜索/排序/底栏事件，然后调用 `fetchThemeList()`。
5. `src/ui-main.js:457-538 fetchThemeList()` 优先遍历 ST `#themes` 的 option，只复制名称到 `stThemeList`。正常路径一次打开只读取一次名称列表，完整 `/api/settings/get` inventory 为 0 次。
6. 若 `#themes`/datalist 不可用，函数会并行请求 `/api/themes`、`/api/themes/all`、`/themes`；这是最多 3 个候选名称 API 请求，不是 `/api/settings/get`。

### 2. 派生、卡片与 DOM

`src/ui-main.js:3586-3869 renderGrid()` 的主链：

1. `load()` 返回 storage 的同一个 `dataCache` 引用，不克隆。
2. `getLogicalItems()` → `themePairs.buildLogicalItems()`，构造 N 个轻量逻辑项；metadata 通过 `themeMeta[name]` 直接关联，不存在 `metadata.find()`。
3. `sortItems()` 对逻辑项副本排序，`O(N log N)`。
4. `buildSeriesLayoutUnits()` 为系列建立 membership map 并执行分类/搜索过滤。
5. `buildGridCardHtml()` 为全部可见项拼字符串。
6. `area.innerHTML = html` 销毁旧网格并一次性建立新 DOM。
7. 遍历 `.tm-card` 和 `.tm-card-menu`，逐卡绑定 click 监听器。

普通无图卡包含 10-14 个元素，受当前/收藏/频次 badge 和标签行影响；本 benchmark 平均 10.96。无图卡仍包含图片槽容器、占位 icon/span 和菜单，因此不加载图片并不能消除主要 DOM 成本。

### 3. 用户交互

- 搜索：`src/ui-main.js:3220` 每个 `input` 立即 `renderGrid()`，无 debounce；`itemMatchesSearch()` 每次重新 lowercase 名称、author、tag、description，且搜索前仍先排序全部项目。
- 分类：`src/ui-main.js:3346` 重新渲染分类栏和整个网格。筛选后的 DOM 只包含匹配卡片；旧卡不是 `display:none`，而是由 `innerHTML` 真正替换。
- 排序：`src/ui-main.js:3227-3235` 保存 sortMode 后全量重建。
- 收藏：`src/ui-main.js:4382-4388` 修改一个 metadata，`save()` 全量 `ensureDefaults()`，随后全量重建。
- 切换：卡片 click → `getLogicalItem()` → `applyManualTheme()` → `themeRuntime.applyThemeAndWait()` → state verification → visual verification → bound background；成功后更新 useCount/lastUsed、保存整个 metadata 对象并全量重建。
- 编辑：`src/ui-main.js:4890-4971` 只修改一个主题 metadata，但保存后仍 `renderCatbar()` + `renderGrid()`；没有增量卡片更新。
- 删除：`deleteThemeVerified()` 至少进行删除后的完整 inventory 验证；UI 再读取名称列表并全量重建。
- 改名：可信 cache + 可靠名称列表通常只需最终完整 inventory 1 次；冷路径需要初始 + 最终 2 次；成功后全量重建。
- 导入：单个和批量都使用初始 inventory + 最终联合验证，共 2 次；最终 `replaceInventory()` 会为全部完整主题重建 runtime cache，随后全量重建 UI。
- 导出：先读一次完整 inventory；选中的 lazy 主题还可能逐个 hydrate。

### 4. 关闭

`src/ui-main.js:3272-3279 closePopup()` 会：

- disconnect manager `MutationObserver`；
- disconnect grid `ResizeObserver`；
- 清理 resize timer；
- 从 DOM 移除整棵 `.tm-overlay`。

它不会清理：

- `stThemeList` 名称数组；
- storage `dataCache`；
- theme runtime `fullThemeCache`；
- 最多 12 项的 frame asset analysis cache；
- extension 生命周期级的 binding/color-scheme/launcher/FAB 监听和 interval。

这些大多是有意的 extension 生命周期 cache，而不是每次打开新增。隔离测试中等待 400 ms 遮罩定时器后强制 GC，200/1000/2000/5000 的第一次关闭均回到打开前完全相同的 CDP node 数；监听器只多 1 个一次性 window resize listener。没有证据表明“单纯打开→关闭”会按主题数持续泄漏 DOM。

完成收藏、切换、编辑后再关闭，CDP 残余相对基线固定为约 192 nodes / 17 listeners，不随 N 增长；这是常量级操作/模块生命周期残留，需要后续专项核查，但不是 1000+ 数量崩溃的首要解释。更重要的是，冷切换建立的 `fullThemeCache` 在关闭后仍保留全部主题深拷贝，其内存随完整 payload 线性增长。

其他资源：下载 JSON 的 Blob URL 会 revoke；frame asset object URL 在超过 12 项被淘汰时 revoke，但关闭管理器不会释放仍在 cache 的最多 12 项。截图没有独立无限增长 cache，主要驻留在 metadata `dataCache`。Lightbox 正常关闭会移除 document keydown listener；若外部强制移除管理器而未走 lightbox 自己的 close，存在保留 listener/closure 的边缘风险。

## Inventory、clone、normalize 与 compare

### 名称 inventory

- 打开：1 次扫描 ST 控件，0 次完整 settings inventory。
- 底栏刷新：通常 1 次扫描 ST 控件；fallback 环境并行发出最多 3 个候选名称 API。
- 名称数据为字符串数组；卡片列表不直接携带 custom CSS、variables 等完整字段。

### 完整主题 inventory

`src/theme-api.js:19-37` POST `/api/settings/get`，浏览器先接收并 `response.json()` 解析整个 settings 响应，最后才返回 `data.themes`。真实响应还包含扩展设置等数据，本 mock 只含 themes，因此真实传输/解析成本可能更高。

`src/theme-runtime.js:93-129` 在正常 capture 路径对每个可用主题调用 `remember()`；`remember()` 使用 `schema.cloneValue()`，即 `JSON.parse(JSON.stringify(theme))`。因此一次完整读取同时存在：

1. ST 自己已有的 native theme 对象；
2. 本次 settings JSON 解析得到的 inventory（事务期间至少暂存）；
3. runtime `fullThemeCache` 中的一份完整深拷贝；
4. 当前被 resolve/apply 的主题还会产生额外短期 clone/snapshot。

完整 inventory 不会在打开时 normalize。导入/导出才按 SillyTavern baseline normalize；验证只对目标主题字段进行 JSON compare/fingerprint，不会在普通列表渲染时 deepEqual 全部主题。

## 算法复杂度

| 路径 | 当前复杂度 | 说明 |
|---|---:|---|
| 从 `#themes` 复制名称 | `O(N)` | 每次打开/刷新 |
| build logical items（无关系） | `O(N)` | 新建 N 个轻量对象 |
| 名称/时间/频次排序 | `O(N log N)` | recent/freq/starred 比较器会取 metadata |
| 搜索派生 | `O(N log N + NT)` | 先排序，再逐项重新 lowercase/扫描文本 |
| HTML + DOM + 普通监听器 | `O(R)` | R 为当前可见卡片数；全部分类时 R=N |
| batchSelected membership | 最坏 `O(N²)` | 数组 `indexOf` 被逐卡调用 |
| batch key → logical item | 最坏 `O(KN)` | 每次 `getLogicalItem()` 都重建 N 个逻辑项 |
| 大量 day/night pair 卡片 | 最坏 `O(P²)` | 每卡多次 `getPair()` → `ensureState()` 全量遍历 pair |
| series 主布局 | `O(N+M)` | 已使用 membership map；M 为系列成员数 |
| 部分系列/批量辅助路径 | 最坏 `O(NM)` | 对每项 `findSeriesByTarget()` 重新规范化并扫描 groups/members |
| 批量保存/删除验证 | `O(KN)` | 每个目标调用线性 `findTheme()` |
| 批量导入文件名冲突 | `O(KN)` | expectedThemes.some × initialInventory.some |

适合 Map/Set 且当前仍反复扫描的位置：

- full inventory `name → theme` Map；
- sanitized filename → theme name Map；
- logical item `key/name → item` Map；
- batchSelected Set；
- pair `themeName → pair` Map；
- stThemeList Set（存在性和 fallback 排除）；
- series membership map 应在一次 render/操作中复用，避免再走 `findSeriesByTarget()`；
- 每个逻辑项预建 normalized search text。

已是 O(1) 的位置：普通 metadata、截图和 backgroundName 都以 theme name 为对象 key 直接读取；当前主题判断对普通项只有长度 1 的 `themeNames.indexOf()`；主系列布局已经建立 membership map。

## DOM 与监听器基线（轻量、无截图）

| 主题数 | 首次可交互 | 管理器元素 | 网格元素 | button | 管理器监听器 | 首次打开最长 long task |
|---:|---:|---:|---:|---:|---:|---:|
| 200 | 201 ms | 2,255 | 2,194 | 228 | 439 | 147 ms |
| 1000 | 453 ms | 11,020 | 10,960 | 1,028 | 2,036 | 398 ms |
| 2000 | 1,072 ms | 21,982 | 21,922 | 2,028 | 4,036 | 979 ms |
| 5000（极限观察） | 2,891 ms | 54,862 | 约 54,802 | 5,028 | 10,036 | 2,681 ms |

每张普通卡平均 10.96 个元素、2 个监听器；无逐卡 observer。两个 listener 分别绑定在 card click 和 menu button click。编辑、删除、预览等菜单 listener 只在打开单张卡菜单时创建，不是每卡预绑。系列 block 另有 manage/toggle/scroll/pointer/wheel 等约 9 个 listener。

搜索/分类后旧网格通过 `innerHTML` 被移除，不会隐藏留在 DOM；但每次都重新创建匹配卡片并重新绑定 listener。滚动没有窗口化，全部卡始终驻留。

## 操作基线

同步交互时间为单次受控桌面 Chrome 观察值；首次可交互包含两帧；异步主题切换包含 state/visual/background 验证，受无头浏览器帧调度影响，因此主要用于观察规模趋势，不是 SLA。

| 数据集 | N | payload | 搜索全匹配 | 切分类 | 排序 | 收藏单项 | 冷切换（完整 inventory 1 次） |
|---|---:|---:|---:|---:|---:|---:|---:|
| 轻量 | 200 | 0.01 MiB | 14.6 ms | 10.0 ms | 19.7 ms | 56.9 ms | 664 ms |
| 轻量 | 1000 | 0.06 MiB | 45.4 ms | 54.1 ms | 82.3 ms | 73.1 ms | 1,183 ms |
| 轻量 | 2000 | 0.13 MiB | 83.9 ms | 77.5 ms | 111.5 ms | 147.8 ms | 2,116 ms |
| 混合 | 200 | 0.85 MiB | 11.7 ms | 13.7 ms | 11.3 ms | 34.6 ms | 476 ms |
| 混合 | 1000 | 4.25 MiB | 46.5 ms | 41.4 ms | 86.6 ms | 99.7 ms | 1,732 ms |
| 混合 | 2000 | 8.50 MiB | 76.6 ms | 115.2 ms | 119.8 ms | 139.2 ms | 3,684 ms |

混合数据分布：每 20 个主题中 14 个约 128 B CSS、5 个约 4 KiB、1 个约 64 KiB；无图片。打开时间与轻量数据近似，证明打开列表主要受卡片数量影响；冷切换和完整 inventory 则明显受 payload 影响。

1000 轻量主题冷/热 cache 对照：第一次切换完整 inventory 读取 1 次；cache 建立后的第二次切换读取 0 次。热切换的无头帧调度绝对时间不稳定，不纳入表格。

单主题编辑/收藏都确认调用全量 `renderGrid()`。操作值存在帧调度噪声，但 1000/2000 卡片的 DOM 数在操作后仍恢复为全部 N 张，代码调用链也直接证明不是增量更新。

## Heap 与关闭后生命周期

受控环境使用 CDP 强制 GC；这是趋势证据，不等同于真实 SillyTavern/WebView heap。

| 数据集 | N | 打开新增 heap | 第一次关闭后 nodes | 冷切换及操作后关闭仍保留的 heap（相对第一次关闭） |
|---|---:|---:|---:|---:|
| 轻量 | 200 | 0.38 MiB | 回到基线 | 0.28 MiB |
| 轻量 | 1000 | 1.10 MiB | 回到基线 | 0.48 MiB |
| 轻量 | 2000 | 1.96 MiB | 回到基线 | 0.79 MiB |
| 混合 | 200 | 0.38 MiB | 回到基线 | 1.12 MiB |
| 混合 | 1000 | 1.10 MiB | 回到基线 | 4.70 MiB |
| 混合 | 2000 | 1.97 MiB | 回到基线 | 8.97 MiB |

结论：关闭可释放列表 DOM；完整主题 cache 不随关闭释放。真实 ST 同时还有 native themes、完整 settings 响应以及可能的第三方 bridge cache，峰值会高于本 mock。

## “无截图仍闪退”的最可能原因

1. 1000/2000 张完整卡片造成约 11k/22k 管理器元素，加上文本节点后 CDP 总节点增量更高；首次打开形成 398/979 ms 单一 long task。
2. 每个搜索字符、分类、排序和单项 metadata 操作都重新 parse 大块 HTML、销毁/创建全部节点并重新绑定约 2N listener，连续操作制造重复长任务和 GC 压力。
3. 第一次主题切换读取整个 `/api/settings/get` 并为全部完整主题建立深拷贝 cache；大 CSS 数据在关闭后仍驻留。低内存移动 WebView 或已有大量聊天 DOM 的页面更可能在峰值时被系统终止。

图片会进一步放大 decode/GPU/metadata 占用，但不是成立这些成本的必要条件。

## 优化候选排序

| 优先级 | 方案 | 收益 | 风险 | 修改范围 | 预计解决的问题 |
|---|---|---|---|---|---|
| P0 | 分批渲染：首批 30-60，后续分帧追加；使用 render generation token 取消过期任务 | 很高 | 中 | `ui-main.js`，少量 `styles.js`，benchmark/tests | 首次长任务、瞬时 DOM 峰值、低端设备假死 |
| P0 | 网格事件委托：card/menu 各由 grid 容器处理 | 中高 | 低-中 | `ui-main.js` | 2N listener、重建后的重复绑定成本 |
| P0 | 一次 render 建立 view model + Map/Set + search key cache | 高 | 中 | `ui-main.js`，可选小型纯函数 helper/tests | 重复 logical item、lowercase、pair/series/name lookup；消除已知 O(N²) 辅助路径 |
| P1 | 搜索 debounce（约 80-120 ms）+ 复用排序结果 | 高 | 低 | `ui-main.js` | 每字符全量长任务、IME 连续输入卡顿 |
| P1 | 增量 DOM 更新 | 高 | 中 | `ui-main.js` | 收藏、编辑、当前卡切换后重建全部列表；在 starred/recent/freq 排序下需正确移动卡片 |
| P1 | 对 metadata/storage normalization 建立明确 dirty/revision，避免每次 save 全扫 `themeMeta` | 中 | 中 | `ui-main.js`、`storage.js`、tests | 单项收藏/编辑仍做 O(N) metadata ensure |
| P2 | 虚拟列表/窗口化 | 极高（2000+） | 高 | 主网格/系列布局/CSS/滚动/无障碍/批量选择测试 | 常驻 DOM 从 O(N) 降为可视窗口；但系列横轨与可变网格尺寸复杂 |
| P2 | requestIdleCallback + fallback | 中 | 中 | render scheduler | 将非首屏批量工作移出关键帧；必须有 rAF/setTimeout fallback |
| P2 | inventory Map 与事务局部索引 | 中高（批处理） | 中 | `theme-runtime.js`、`theme-transactions.js`、tests | `findTheme`、filename collision、批量 verify 的 `O(KN)` |
| 暂缓 | 轻量后端 inventory / 完整主题按需读取 | 潜在极高 | 高 | ST/bridge/API/runtime/transaction/apply 链 | 降低完整 settings 解析和 full cache；当前没有独立官方轻量接口，容易破坏验证链 |
| 暂缓 | 持久化 inventory cache、存储格式迁移、默认后端依赖 | 不确定 | 很高 | 数据层/用户文件/后端 | 与本轮证据不匹配，增加失效和数据安全风险 |

## 推荐第一阶段

目标定为**稳定支持 2000 个主题**。1000 是必须过线的最低目标；5000 在当前全量 DOM 架构下首次可交互约 2.9 s、一个约 2.68 s long task、约 54.9k 管理器元素和 10k listener，需要虚拟化或更深的数据/API变化，不宜作为第一阶段承诺。

第一阶段建议只改列表层：

1. 增加可取消的分批渲染（首批 48 左右，按帧追加）；
2. 将普通 card/menu click 改为 grid 事件委托；
3. 每次 library/metadata revision 构建一次逻辑项 Map、series membership、Set 和 search text；
4. 搜索 debounce 并复用未变化的排序结果；
5. 先对收藏、非排序字段编辑、当前 active class 做安全的单卡增量更新；排序键变化时仍回退到完整/分批重排；
6. 用现有 benchmark 加入首批可交互、全部渲染完成、取消过期 render、关闭中途 render、2000 主题操作回归。

预计生产修改文件：

- `src/ui-main.js`（主要）；
- `src/styles.js`（若需要批次 sentinel/loading 状态）；
- 测试文件，包括本 benchmark 和必要的纯函数/DOM 回归。

第一阶段风险：**中等**。风险集中在系列布局、批量选择、快速搜索/关闭时的过期批次，以及 starred/recent/freq 排序下的增量更新。应保持 `theme-runtime.js`、`theme-transfer.js` 和导入→inventory 同步→apply→state verification→visual verification→bound background 链不变。

暂缓：虚拟列表、轻量后端 inventory、持久化 cache、主题存储格式迁移、全数据层异步化，以及任何修改刚修复好的切换验证链的方案。先用 P0/P1 观察 2000 主题的首次可交互、长任务、常驻 DOM 和交互回归，再决定是否进入虚拟化。

## Benchmark 文件

- `tests/large-theme-library.benchmark.js`
- `tests/large-theme-library.benchmark-results.json`
- `tests/large-theme-library.benchmark-results-5000.json`
- `tests/large-theme-library.benchmark-results-warm-cache.json`

运行依赖 Playwright，但使用全新浏览器 context 和 mock endpoint；不会访问真实主题目录。完整六组运行命令由本机 Codex bundled `NODE_PATH` 提供 Playwright，并使用系统 Chrome headless。
