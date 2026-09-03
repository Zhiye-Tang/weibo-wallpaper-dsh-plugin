# DSH 官方仓库 Discussions 宣传帖(文案 + 使用说明)

> 发布位置:https://github.com/deepseek-ai/deepseek-harness/discussions
> 建议分类:**Show and tell**(若分类列表里有);没有就用 **General**。
> 语言建议:下方给英文主帖 + 中文精简版。官方仓库社区以英文为主,英文帖曝光最好;可把中文版放在主帖末尾作为附注,或只发英文帖并在评论区补中文。

---

## 英文主帖(直接复制,{}处替换后发布)

### Title

> **Show and tell: I built a dsh-plugin that turns every DSH launch into a living wallpaper from Weibo**

### Body

Hi everyone 👋

Following the official guidance (add the `dsh-plugin` topic, share it with the ecosystem), I'd like to show a host-level plugin I've been building: **[weibo-wallpaper-dsh](https://github.com/Zhiye-Tang/weibo-wallpaper-dsh-plugin)**.

**What it does:** it turns a Weibo blogger's album/media into the wallpaper of the DSH web UI. Every time you start DSH it checks Weibo, downloads new content by month into local `YYYY-MM` folders, and shows the latest month behind the interface — no session required, no manual refresh.

| Glass (default) | Transparent | Opaque |
|---|---|---|
| ![](https://raw.githubusercontent.com/Zhiye-Tang/weibo-wallpaper-dsh-plugin/main/docs/screenshots/01-glass.png) | ![](https://raw.githubusercontent.com/Zhiye-Tang/weibo-wallpaper-dsh-plugin/main/docs/screenshots/02-clear.png) | ![](https://raw.githubusercontent.com/Zhiye-Tang/weibo-wallpaper-dsh-plugin/main/docs/screenshots/03-solid.png) |

**Highlights**

- **Runs at the profile layer** (a `cordis.patch.yml` insert), so the wallpaper lives with the DSH process, not with any agent session — I learned this the hard way after v1 made the wallpaper depend on an open session 😅.
- **Idempotent by day**: same-day restarts skip Weibo entirely; new days/months do incremental downloads into fresh `YYYY-MM` folders.
- **Resumable historical backfill**: on first run it archives this year Jan → last month page by page; close DSH any time and it resumes next start.
- **Multi-blogger**: add `uid`/`name` entries in one `config.json`; each blogger gets its own state and albums, switchable from the control bar.
- **Three display modes** (opaque / frosted glass / fully transparent) toggled from an on-page control bar.
- **No npm runtime dependencies** — plain Node `fs`/`fetch`.

**Quick start** (full guide in the repo README): copy the two `plugins/` folders into your profile dir, merge the `- insert:` rows into your profile's `cordis.patch.yml`, set `config.json`, restart DSH, then paste your own m.weibo.cn cookie via the 🔑 button.

**Honest caveats** (also in the README): it talks to Weibo's unofficial mobile JSON API, so cookies expire and Weibo may rate-limit (`432`) or change endpoints over time; content stays on your machine and is for personal, local use only.

I'd love feedback — bug reports, feature ideas (cookie-expiry notice, image/video-only modes, packaging as a `dsh plugin add` bundle…), or PRs are all welcome. If it's useful to you, a ⭐ on the repo would make my day.

Repo: https://github.com/Zhiye-Tang/weibo-wallpaper-dsh-plugin (topic: `dsh-plugin`)

---

## 中文精简版(可选,适合作为主帖附注或中文讨论区)

> **标题备选**:Show and tell:一个把微博相册变成 DSH 界面壁纸的宿主插件
>
> 给 DeepSeek Harness 写了个宿主级插件 `weibo-wallpaper-dsh`:每次打开 DSH 自动同步关注的微博博主相册(同日跳过、按月归档到本地 `YYYY-MM`),并把最新月份设为 Web 界面壁纸——不依赖任何会话、免手动刷新,控制条可切月份/博主/三种显示模式(全遮挡/毛玻璃/全透明)。首次启用还会自动回填今年 1 月到上个月,断点续传。
>
> 技术上就是官方说的"Everything is a Plugin":两个本地插件行插进 profile 的 `cordis.patch.yml`,引擎随进程常驻。纯 Node 原生实现,零 npm 依赖。需要你本人的 m.weibo.cn Cookie(仅存本机、不上传),依赖非官方接口,可能被微博限流,README 里都写了风险。
>
> 仓库:https://github.com/Zhiye-Tang/weibo-wallpaper-dsh-plugin(话题 dsh-plugin,双语 README)。项目还在持续开发,欢迎 Issue/PR/star ⭐。如果你也在折腾 DSH 插件,欢迎交流。

---

## 发布前检查清单

- [ ] 仓库最新代码已 `git push`(含双语 README、docs/social-preview.png、docs/announcement-article.md);截图用 raw 链接,推完后立即生效
- [ ] 仓库已设置 topics(`dsh-plugin` 等)与 Description(帖子里的链接卡片会展示)
- [ ] 帖子标题避免"震惊/必看",用具体价值描述(如上面的标题)
- [ ] 正文里只贴**官方仓库链接**,不带 Cookie/路径/隐私内容
- [ ] 发布后 1~2 天回来回复评论,把共性问题沉淀回 README Troubleshooting

## 顺带的曝光渠道(可选)

1. **awesome 列表**:`0xsline/awesome-deepseek-harness`、`Dominic789654/awesome-deepseek-harness` 都是公开收录 DSH 插件的 awesome 仓库——给它们提 PR 把项目加进列表(有些要求先有 `dsh-plugin` 话题,正好已加)。
2. **话题页**:https://github.com/topics/dsh-plugin —— DSH 生态开发者会逛这里,帖子发完记得 repo 话题里能找到你。
3. **桌面版生态**:`dsh-tauri-desk/deepseek-harness-desktop` 等周边项目社区也接受插件分享,可同类发帖。
