'use strict'
// 走路摇ZLY 微博相册壁纸引擎 v3 (host-only Cordis 插件,随 DSH profile 启动即运行)
//
// 运行内容:
//   1) 同日跳过微博检查;跨天/跨月抓当月增量,按 博主/YYYY-MM 入库;
//   2) 每个博主自动回填"今年 01 .. 上月"历史相册(断点续传,已存在文件跳过);
//   3) 每次启动将展示月份复位为该博主最新有内容月份(前端可下拉切换任意月份);
//   4) 三种显示模式: solid 全遮挡(不透明UI) / glass 半透明毛玻璃 / clear 全透明;
//   5) 多博主: config.json 可配置多个 uid,name(按 uid 建独立子目录,互不干扰);
//   6) 经 webServer 提供 /zly-wallpaper/* 状态/媒体/网页脚本接口,并向 index 注入
//      壁纸层; wallpaper.js 自带样式自举,可被宿主级 wallpaper-boot 补丁延迟加载,
//      从而"打开 DSH 即显示壁纸,无需强制刷新"。
//
// 配置(config.json,与本文件同目录;缺省用默认值):
//   { "root": "本地保存根目录",
//     "blogs": [ { "uid": "1909576453", "name": "走路摇ZLY" }, ... ] }
//   root 缺省 -> ~/.dsh/weibo-wallpaper
//   blogs 缺省或为空 -> 走路摇ZLY
//
// 数据布局:
//   <root>/ui.json                        全局展示偏好(模式/间隔/当前博主/所选月份)
//   <root>/<uid>/state.json               该博主抓取状态(Cookie 只存在这里,不落日志)
//   <root>/<uid>/albums/<YYYY-MM>/...     该博主的按月媒体
// 旧版(v2,单博主平铺: root/state.json + root/albums)首次启动时自动迁移到 <uid>/ 下。
//
// 重要(发布注意事项): 本插件不携带任何 Cookie/媒体数据;Cookie 由用户在页面上
// 通过 🔑 按钮填入,仅保存在本地 state.json 中。请勿把运行目录提交到 git。

const fs = require('fs')
const path = require('path')
const os = require('os')

function loadConfig() {
  const fallback = () => ({ root: path.join(os.homedir(), '.dsh', 'weibo-wallpaper'), blogs: [{ uid: '1909576453', name: '走路摇ZLY' }] })
  try {
    const cfgPath = path.join(__dirname, 'config.json')
    if (!fs.existsSync(cfgPath)) return fallback()
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {}
    const root = (cfg.root && String(cfg.root).trim()) ? String(cfg.root).trim() : fallback().root
    let blogs = fallback().blogs
    if (Array.isArray(cfg.blogs) && cfg.blogs.length) {
      const list = cfg.blogs
        .filter((b) => b && typeof b.uid === 'string' && String(b.uid).trim())
        .map((b) => ({ uid: sanitizeUid(b.uid), name: (b.name && String(b.name).trim()) ? String(b.name).trim() : String(b.uid).trim() }))
        .filter((b) => b.uid)
      if (list.length) blogs = list
    }
    return { root: root, blogs: blogs }
  } catch (e) {
    console.log('[zly-engine] config.json 解析失败,使用默认配置:', String((e && e.message) || e))
    return fallback()
  }
}
function sanitizeUid(u) {
  return String(u).trim().replace(/[^0-9A-Za-z_-]/g, '')
}

const CONFIG = loadConfig()

// ---- 浏览器端样式(注入到每个 DSH 页面) ----
const BASE_CSS = [
  '#zly-wallpaper-stage{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-10;overflow:hidden;background:#000;pointer-events:none;margin:0;padding:0}',
  '#zly-wallpaper-stage img,#zly-wallpaper-stage video{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;border:0}',
  '#zly-wallpaper-stage img{animation:zlywfade .9s ease}',
  '@keyframes zlywfade{from{opacity:.15}to{opacity:1}}',
  '#zly-wallpaper-bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:4px;align-items:center;padding:5px 10px;border-radius:999px;background:rgba(8,10,14,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;font:12px/1.5 system-ui,-apple-system,\'Segoe UI\',sans-serif;pointer-events:auto;opacity:.95;max-width:min(94vw,900px);box-sizing:border-box;user-select:none}',
  '#zly-wallpaper-bar button{appearance:none;-webkit-appearance:none;border:0;background:transparent;color:#fff;cursor:pointer;font-size:15px;line-height:1;padding:3px 7px;border-radius:10px;margin:0}',
  '#zly-wallpaper-bar button:hover{background:rgba(255,255,255,.2)}',
  '#zly-wallpaper-bar select{appearance:none;-webkit-appearance:none;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font-size:12px;line-height:1.2;padding:2px 6px;border-radius:10px;outline:none}',
  '#zly-wallpaper-bar select[data-zlyw=\'blog\']{max-width:120px}',
  '#zly-wallpaper-bar select[data-zlyw=\'month\']{max-width:160px}',
  '#zly-wallpaper-bar select:hover{background:rgba(255,255,255,.2)}',
  '#zly-wallpaper-bar select option{background:#1c1e26;color:#fff}',
  '#zly-wallpaper-bar[data-dim=\'1\']{opacity:.32}',
  '#zly-wallpaper-bar[data-dim=\'1\']:hover{opacity:1}',
  '#zly-wallpaper-bar [data-zlyw=label]{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.9);max-width:300px;padding:0 6px}',
  // 半透明毛玻璃(亮/暗)
  'body.zlyw-glass{--dsw-alias-bg-base:rgba(250,250,250,.68);--dsw-alias-bg-layer-1:rgba(255,255,255,.78);--dsw-alias-bg-layer-2:rgba(255,255,255,.66);--dsw-alias-bg-layer-3:rgba(255,255,255,.6);--dsw-specific-sidebar-fill:rgba(252,252,252,.62);background:transparent}',
  'body[data-ds-dark-theme].zlyw-glass{--dsw-alias-bg-base:rgba(10,11,15,.62);--dsw-alias-bg-layer-1:rgba(22,23,31,.66);--dsw-alias-bg-layer-2:rgba(31,33,43,.62);--dsw-alias-bg-layer-3:rgba(40,42,54,.6);--dsw-specific-sidebar-fill:rgba(12,13,18,.7);background:transparent}',
  // 全透明(亮/暗)
  'body.zlyw-clear{--dsw-alias-bg-base:rgba(255,255,255,0);--dsw-alias-bg-layer-1:rgba(255,255,255,0);--dsw-alias-bg-layer-2:rgba(255,255,255,0);--dsw-alias-bg-layer-3:rgba(255,255,255,0);--dsw-specific-sidebar-fill:rgba(255,255,255,0);background:transparent}',
  'body[data-ds-dark-theme].zlyw-clear{--dsw-alias-bg-base:rgba(0,0,0,0);--dsw-alias-bg-layer-1:rgba(0,0,0,0);--dsw-alias-bg-layer-2:rgba(0,0,0,0);--dsw-alias-bg-layer-3:rgba(0,0,0,0);--dsw-specific-sidebar-fill:rgba(0,0,0,0);background:transparent}',
  // 全遮挡: 不加任何透明覆盖,主题保持默认不透明(壁纸被界面完全遮挡)
].join('\n')

const BROWSER_JS = (function () {
  const cssLine = 'var zlywCss=' + JSON.stringify(BASE_CSS) + ';'
  const lines = [
    '(function(){',
    cssLine,
    'if(window.__zlywLoaded){return}window.__zlywLoaded=true;',
    'function ensureStyle(){if(document.querySelector(\'style[data-zlyw-style]\'))return;var st=document.createElement(\'style\');st.setAttribute(\'data-zlyw-style\',\'1\');st.textContent=zlywCss;document.head.appendChild(st)}',
    'var stage=null,bar=null,label=null,selBlog=null,selMonth=null,btnMode=null,btnPlay=null;',
    'var media=[],idx=0,playing=true,mode=\'glass\',months=[],activeMonth=null,activeBlog=null,blogs=[],curBlogs=\'\',slide=null,slideIv=0,poll=null,statePref={intervalSec:12};',
    'var MODES=[\'solid\',\'glass\',\'clear\'];',
    'var MODE_ICON={\'solid\':\'●\',\'glass\':\'◐\',\'clear\':\'◯\'};',
    'var MODE_TXT={\'solid\':\'全遮挡\',\'glass\':\'毛玻璃\',\'clear\':\'全透明\'};',
    'function setLabel(t){if(label)label.textContent=t}',
    'function applyBodyMode(){var b=document.body;if(!b)return;b.classList.remove(\'zlyw-glass\');b.classList.remove(\'zlyw-clear\');b.classList.remove(\'zlyw-solid\');if(mode===\'glass\')b.classList.add(\'zlyw-glass\');else if(mode===\'clear\')b.classList.add(\'zlyw-clear\')}',
    'function paintModeBtn(){if(btnMode){btnMode.textContent=MODE_ICON[mode]||\'◐\';btnMode.title=\'显示模式: \'+(MODE_TXT[mode]||mode)+\' (点击循环切换)\'}}',
    'function setMode(m){if(MODES.indexOf(m)<0)return;mode=m;applyBodyMode();paintModeBtn();post(\'/zly-wallpaper/set\',{pref:{mode:m}})}',
    'function cycleMode(){var i=MODES.indexOf(mode);setMode(MODES[(i+1)%MODES.length])}',
    'function ensureDom(){if(stage&&bar)return;ensureStyle();stage=document.getElementById(\'zly-wallpaper-stage\');if(!stage){stage=document.createElement(\'div\');stage.id=\'zly-wallpaper-stage\';document.body.appendChild(stage)}bar=document.getElementById(\'zly-wallpaper-bar\');if(!bar){bar=document.createElement(\'div\');bar.id=\'zly-wallpaper-bar\';bar.innerHTML=\'<button type="button" data-zlyw="prev" title="上一张">⏮</button><button type="button" data-zlyw="play" title="播放/暂停">⏯</button><button type="button" data-zlyw="next" title="下一张">⏭</button><select data-zlyw="blog" title="切换博主"></select><select data-zlyw="month" title="切换月份相册"></select><button type="button" data-zlyw="refresh" title="立即检查微博更新">⟳</button><button type="button" data-zlyw="cookie" title="设置当前博主的微博Cookie">🔑</button><button type="button" data-zlyw="mode" title="显示模式"></button><span data-zlyw="label"></span>\';document.body.appendChild(bar)}label=bar.querySelector(\'[data-zlyw=label]\');selBlog=bar.querySelector(\'[data-zlyw=blog]\');selMonth=bar.querySelector(\'[data-zlyw=month]\');btnMode=bar.querySelector(\'[data-zlyw=mode]\');btnPlay=bar.querySelector(\'[data-zlyw=play]\');if(selBlog)selBlog.addEventListener(\'change\',function(){var v=selBlog.value;if(v)post(\'/zly-wallpaper/set\',{activeBlog:v})});if(selMonth)selMonth.addEventListener(\'change\',function(){var v=selMonth.value;if(v)post(\'/zly-wallpaper/set\',{activeMonth:v})});if(bar)bar.addEventListener(\'click\',onClick);paintBlogs();paintModeBtn()}',
    'function post(u,body){return fetch(u,{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify(body||{})}).then(function(r){return r.json()}).then(function(j){if(j&&j.state)refresh();return j}).catch(function(e){setLabel(\'接口错误: \'+e)})}',
    'function paintBlogs(){if(!selBlog)return;if(!blogs.length){selBlog.style.display=\'none\';selBlog.innerHTML=\'\';return}selBlog.style.display=blogs.length>1?\'\':\'none\';var cur=selBlog.value;var o=\'\';for(var k=0;k<blogs.length;k++){o+=\'<option value="\'+blogs[k].uid+\'">\'+blogs[k].name+\'</option>\'}if(selBlog.innerHTML!==o){selBlog.innerHTML=o;if(cur)selBlog.value=cur}}',
    'function onClick(ev){var b=ev.target&&ev.target.closest?ev.target.closest(\'[data-zlyw]\'):null;if(!b||!b.dataset)return;var a=b.dataset.zlyw,n=media.length;if(a===\'prev\'&&n){idx=(idx-1+n)%n;show()}else if(a===\'next\'&&n){idx=(idx+1)%n;show()}else if(a===\'play\'){playing=!playing;if(btnPlay)btnPlay.textContent=playing?\'⏯\':\'▶\';if(playing)armSlide();else disarmSlide()}else if(a===\'mode\'){cycleMode()}else if(a===\'refresh\'){setLabel(\'正在检查微博更新…\');post(\'/zly-wallpaper/refresh\',{})}else if(a===\'cookie\'){var v=window.prompt(\'粘贴微博登录 Cookie(m.weibo.cn 登录后 F12 复制,以 SUB= 开头;留空清除,仅保存在本机):\',\'\');if(v===null)return;post(\'/zly-wallpaper/set\',{cookie:v.trim()}).then(function(){post(\'/zly-wallpaper/refresh\',{})})}}',
    'function clearMedia(){if(!stage)return;while(stage.firstChild)stage.removeChild(stage.firstChild)}',
    'function sameList(a,b){if(!a||!b||a.length!==b.length)return false;for(var i=0;i<a.length;i++){if(a[i].url!==b[i].url)return false}return true}',
    'function show(){if(!stage)return;clearMedia();if(!media.length){setLabel(\'该月暂无壁纸内容\');return}var it=media[idx%media.length];if(!it)return;var e;if(it.kind===\'video\'){e=document.createElement(\'video\');e.src=it.url;e.autoplay=true;e.muted=true;e.loop=media.length===1;e.playsInline=true;e.addEventListener(\'ended\',function(){if(media.length>1&&playing){idx=(idx+1)%media.length;show()}})}else{e=document.createElement(\'img\');e.src=it.url;e.alt=\'\'}stage.appendChild(e)}',
    'function armSlide(){disarmSlide();var iv=(statePref&&statePref.intervalSec>2)?statePref.intervalSec:12;slideIv=iv;slide=setInterval(function(){if(!playing)return;var it=media[idx%media.length];if(!media.length)return;if(it&&it.kind===\'video\'&&media.length>1)return;if(media.length>1){idx=(idx+1)%media.length;show()}},iv*1000)}',
    'function disarmSlide(){if(slide){clearInterval(slide);slide=null}}',
    'function syncSlide(){var iv=(statePref&&statePref.intervalSec>2)?statePref.intervalSec:12;if(!slide||slideIv!==iv){disarmSlide();if(playing)armSlide()}}',
    'function refresh(){fetch(\'/zly-wallpaper/state\').then(function(r){return r.json()}).then(function(j){var st=j.state||j;if(!st)return;if(st.pref){statePref=st.pref;if(st.pref.mode&&st.pref.mode!==mode){mode=st.pref.mode;applyBodyMode();paintModeBtn()}if(typeof st.pref.intervalSec===\'number\'&&st.pref.intervalSec>2)syncSlide()}var bl=st.blogs||[];var bls=\'\';for(var bi=0;bi<bl.length;bi++){bls+=bl[bi].uid+\'|\'+bl[bi].name+\';\'}if(bls!==curBlogs){curBlogs=bls;blogs=bl;paintBlogs()}var blogChanged=activeBlog!==st.activeBlog;if(blogChanged){activeBlog=st.activeBlog;months=[];if(selBlog&&activeBlog)selBlog.value=activeBlog}var mlist=st.months||[];var listChanged=false;if(mlist.length!==months.length){listChanged=true}else{for(var i=0;i<mlist.length;i++){if(!months[i]||months[i].month!==mlist[i].month||months[i].count!==mlist[i].count){listChanged=true;break}}}if(listChanged){months=mlist;var cur=(selMonth&&selMonth.value)||\'\';var opts=\'\';for(var k=0;k<mlist.length;k++){opts+=\'<option value="\'+mlist[k].month+\'">\'+mlist[k].month+\' · \'+mlist[k].count+\'项</option>\'}selMonth.innerHTML=opts;if(cur)selMonth.value=cur}var want=st.activeMonth||(mlist.length?mlist[0].month:\'\');var wantChanged=want&&want!==activeMonth;if(wantChanged){activeMonth=want;if(selMonth)selMonth.value=want}var next=st.media||[];var mediaChanged=!sameList(media,next)||wantChanged||blogChanged;if(mediaChanged){media=next;if(idx>=media.length)idx=0;if(media.length)show();else setLabel((st.name||\'博主\')+\' · \'+(activeMonth||\'无月\')+\' 暂无壁纸内容\')}var t=(st.name||\'博主\')+\' · \'+(activeMonth||\'无月\')+\' · \'+media.length+\' 项 · 上次检查 \'+(st.lastCheckDate||\'从未\');if(st.historical&&st.historical.summary&&st.historical.summary.error&&!st.historical.done){t+=\' · 历史回填: \'+st.historical.summary.error}else if(st.historical&&st.historical.summary&&!st.historical.summary.done&&!st.historical.done){t+=\' · 历史回填进行中(页\'+(st.historical.summary.page||0)+\')\'}else if(st.historical&&st.historical.done&&st.historical.summary&&st.historical.summary.note){t+=\' · 历史回填\'+(st.historical.summary.note.indexOf(\'完成\')>=0?\'完成\':\'(\'+st.historical.summary.note+\')\')}if(st.lastError)t+=\' · \'+(st.cookieNeeded?\'需登录:点🔑粘贴Cookie后⟳\':\'错误: \'+st.lastError);if(!media.length&&!st.cookieSet&&!st.lastError)t+=\' · 未设置Cookie或该月无内容\';setLabel(t)})}',
    'ensureDom();applyBodyMode();refresh();poll=setInterval(refresh,6000);setTimeout(function(){if(bar)bar.setAttribute(\'data-dim\',\'1\')},5000)',
    '})();'
  ]
  return lines.join('\n')
})()

const STAGE_HTML = '<div id="zly-wallpaper-stage"></div><div id="zly-wallpaper-bar" data-zlyw-bar="1"><button type="button" data-zlyw="prev" title="上一张">⏮</button><button type="button" data-zlyw="play" title="播放/暂停">⏯</button><button type="button" data-zlyw="next" title="下一张">⏭</button><select data-zlyw="blog" title="切换博主"></select><select data-zlyw="month" title="切换月份相册"></select><button type="button" data-zlyw="refresh" title="立即检查微博更新">⟳</button><button type="button" data-zlyw="cookie" title="设置当前博主的微博Cookie">🔑</button><button type="button" data-zlyw="mode" title="显示模式">◐</button><span data-zlyw="label"></span></div><style data-zlyw-style="1">' + BASE_CSS + '</style><script src="/zly-wallpaper/wallpaper.js"></script>'

module.exports = {
  inject: ['webServer'],
  __config: CONFIG,
  __css: BASE_CSS,
  __browser: BROWSER_JS,
  __stage: STAGE_HTML,
  apply(ctx) {
    const ROOT = CONFIG.root
    const BLOGS = CONFIG.blogs
    const MAXF = 512 * 1024 * 1024
    const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.mp4': 'video/mp4' }
    const MODES = ['solid', 'glass', 'clear']
    const log = (...a) => console.log('[zly-engine]', ...a)

    const blogDir = (uid) => path.join(ROOT, uid)
    const blogStateFile = (uid) => path.join(blogDir(uid), 'state.json')
    const blogAlbums = (uid) => path.join(blogDir(uid), 'albums')
    const blogMonthDir = (uid, month) => path.join(blogAlbums(uid), month)
    const UI_FILE = path.join(ROOT, 'ui.json')

    const svc = {}
    for (const k of ['webServer', 'timer']) {
      try { svc[k] = ctx.get(k) } catch (e) { svc[k] = undefined }
    }
    log('services:', JSON.stringify(Object.fromEntries(Object.keys(svc).map((k) => [k, !!svc[k]]))))
    log('config: root=' + ROOT + ' blogs=' + JSON.stringify(BLOGS.map((b) => b.uid + ':' + b.name)))
    const cleaners = []
    ctx.effect(() => () => { cleaners.forEach((f) => { try { f() } catch (e) {} }); cleaners.length = 0 })
    const addClean = (fn) => { if (typeof fn === 'function') cleaners.push(fn) }

    let busy = false
    let histBusy = false
    const lastViewByUid = {}
    const diag = { done: false, nodeHttp: false, err: null }
    const sleep = async (ms) => { await new Promise((r) => setTimeout(r, ms)) }
    const nativeTimeout = (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) }
    const pad = (n) => (n < 10 ? '0' + n : '' + n)
    const extOf = (name) => { const m = String(name).toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|bmp|mp4)$/); return m ? '.' + m[1] : null }

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    const REQ_HEADERS = (cookie) => ({ 'User-Agent': UA, 'Referer': 'https://m.weibo.cn/', 'X-Requested-With': 'XMLHttpRequest', 'Accept': '*/*', ...(cookie ? { Cookie: cookie } : {}) })
    async function httpFetch(url, cookie, timeoutMs) {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), timeoutMs || 40000)
      try { return await fetch(url, { headers: REQ_HEADERS(cookie || ''), redirect: 'follow', signal: ctl.signal }) }
      finally { clearTimeout(t) }
    }
    async function nodeCall(kind, url, cookie, dest, maxOutMB) {
      try {
        const r = await httpFetch(url, cookie, kind === 'file' ? 240000 : 40000)
        if (!r.ok) return { ok: false, err: 'HTTP ' + r.status }
        if (kind === 'file') {
          const buf = Buffer.from(await r.arrayBuffer())
          fs.writeFileSync(dest, buf)
          return { ok: true, stdout: '' }
        }
        const txt = await r.text()
        return { ok: true, stdout: txt }
      } catch (e) { return { ok: false, err: String((e && e.message) || e) } }
    }

    // ---- 全局展示偏好(ui.json) ----
    const defaultPref = () => ({ auto: true, mode: 'glass', intervalSec: 12 })
    const defaultUi = () => ({ pref: defaultPref(), activeBlog: BLOGS[0].uid, activeMonth: null })
    async function loadUi() {
      let ui = defaultUi()
      try {
        if (fs.existsSync(UI_FILE)) {
          const j = JSON.parse(fs.readFileSync(UI_FILE, 'utf8'))
          if (j && typeof j === 'object') ui = Object.assign(defaultUi(), j)
        }
      } catch (e) { log('loadUi warn', String((e && e.message) || e)) }
      if (!ui.pref || typeof ui.pref !== 'object') ui.pref = defaultPref()
      if (typeof ui.pref.glass === 'boolean' && !ui.pref.mode) ui.pref.mode = ui.pref.glass ? 'glass' : 'solid'
      if (!ui.pref.mode || MODES.indexOf(ui.pref.mode) < 0) ui.pref.mode = 'glass'
      if (!BLOGS.some((b) => b.uid === ui.activeBlog)) ui.activeBlog = BLOGS[0].uid
      if (!ui.activeMonth || !/^\d{4}-\d{2}$/.test(ui.activeMonth)) ui.activeMonth = null
      return ui
    }
    async function saveUi(ui) {
      try {
        fs.mkdirSync(ROOT, { recursive: true })
        fs.writeFileSync(UI_FILE, JSON.stringify(ui, null, 2), 'utf8')
      } catch (e) { log('saveUi warn', String((e && e.message) || e)) }
    }

    // ---- 单博主抓取状态(<uid>/state.json) ----
    const defaultBlogState = (uid, name) => ({ version: 3, uid: uid, name: name, cookie: '', cookieNeeded: false, lastCheckDate: null, lastSyncMonth: null, lastAttempt: null, lastError: null, summary: null, historical: null })
    async function loadBlogState(uid) {
      const name = (BLOGS.find((b) => b.uid === uid) || {}).name || uid
      let st = defaultBlogState(uid, name)
      try {
        const file = blogStateFile(uid)
        if (fs.existsSync(file)) {
          const j = JSON.parse(fs.readFileSync(file, 'utf8'))
          if (j && typeof j === 'object') st = Object.assign(defaultBlogState(uid, name), j)
        }
      } catch (e) { log('loadBlogState warn', String((e && e.message) || e)) }
      if (!st.historical || typeof st.historical !== 'object') st.historical = { year: null, from: null, to: null, window: null, done: false, pageNext: 1, since: '', pages: 0, found: {}, summary: null }
      return st
    }
    async function saveBlogState(uid, st) {
      try {
        fs.mkdirSync(blogDir(uid), { recursive: true })
        fs.writeFileSync(blogStateFile(uid), JSON.stringify(st, null, 2), 'utf8')
      } catch (e) { log('saveBlogState warn', String((e && e.message) || e)) }
    }

    // ---- 旧版(单博主平铺)自动迁移: root/state.json + root/albums -> <uid>/ ----
    async function migrateLegacy() {
      const legacyState = path.join(ROOT, 'state.json')
      const legacyAlbums = path.join(ROOT, 'albums')
      const hasState = fs.existsSync(legacyState)
      const hasAlbums = fs.existsSync(legacyAlbums)
      if (!hasState && !hasAlbums) return
      log('检测到旧版数据布局,开始迁移')
      let legacy = null
      try { if (hasState) legacy = JSON.parse(fs.readFileSync(legacyState, 'utf8')) } catch (e) {}
      let uid = (legacy && legacy.uid) ? sanitizeUid(legacy.uid) : BLOGS[0].uid
      if (!BLOGS.some((b) => b.uid === uid)) uid = BLOGS[0].uid
      fs.mkdirSync(blogDir(uid), { recursive: true })
      try { if (hasState && !fs.existsSync(blogStateFile(uid))) fs.renameSync(legacyState, blogStateFile(uid)) } catch (e) { log('迁移 state.json 失败', String((e && e.message) || e)) }
      try { if (hasAlbums && !fs.existsSync(blogAlbums(uid))) fs.renameSync(legacyAlbums, blogAlbums(uid)) } catch (e) { log('迁移 albums 失败', String((e && e.message) || e)) }
      try {
        if (legacy) {
          let ui = null
          try { ui = JSON.parse(fs.readFileSync(UI_FILE, 'utf8')) } catch (e) {}
          if (!ui || typeof ui !== 'object') ui = defaultUi()
          if (!ui.pref || typeof ui.pref !== 'object') ui.pref = defaultPref()
          if (legacy.pref && typeof legacy.pref === 'object') ui.pref = Object.assign(ui.pref, legacy.pref)
          if (typeof legacy.activeMonth === 'string') ui.activeMonth = legacy.activeMonth
          ui.activeBlog = uid
          if (!ui.pref.mode || MODES.indexOf(ui.pref.mode) < 0) ui.pref.mode = 'glass'
          await saveUi(ui)
        }
      } catch (e) { log('迁移 ui.json 失败', String((e && e.message) || e)) }
      log('迁移完成 -> ' + blogDir(uid))
    }

    async function mkdirP(dir) { fs.mkdirSync(dir, { recursive: true }); return dir }
    async function setup() {
      try {
        fs.mkdirSync(ROOT, { recursive: true })
        const probe = await nodeCall('json', 'https://www.baidu.com/robots.txt', '')
        diag.nodeHttp = !!(probe.ok && probe.stdout.length > 0)
        diag.done = true
      } catch (e) {
        diag.done = true
        diag.err = String((e && e.message) || e)
      }
    }
    async function listMonthFiles(uid, month) {
      const dir = blogMonthDir(uid, month)
      const out = []
      try {
        if (!fs.existsSync(dir)) return out
        for (const en of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!en.isFile()) continue
          const ext = extOf(en.name)
          if (ext && MIME[ext]) { const st = fs.statSync(path.join(dir, en.name)); out.push({ name: en.name, kind: ext === '.mp4' ? 'video' : 'image', size: st.size }) }
        }
      } catch (e) { log('listMonthFiles warn', String((e && e.message) || e)) }
      out.sort((a, b) => (a.name < b.name ? -1 : 1))
      return out
    }
    async function fileExists(p) {
      try { return fs.existsSync(p) && fs.statSync(p).isFile() } catch (e) { return false }
    }
    async function fileSizeOf(p) {
      try { return fs.existsSync(p) ? fs.statSync(p).size : 0 } catch (e) { return 0 }
    }
    async function listMonths(uid) {
      const out = []
      try {
        const albums = blogAlbums(uid)
        if (!fs.existsSync(albums)) return out
        for (const en of fs.readdirSync(albums, { withFileTypes: true })) {
          if (en.isDirectory() && /^\d{4}-\d{2}$/.test(en.name)) out.push(en.name)
        }
      } catch (e) {}
      out.sort((a, b) => (a < b ? 1 : -1))
      return out
    }
    const MO = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
    function parseCreated(s) {
      if (!s) return null
      s = String(s)
      let m = s.match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) \d{2}:\d{2}:\d{2} \+0800 (\d{4})/)
      if (m && MO[m[1]]) {
        const y = parseInt(m[3], 10); const mo = parseInt(MO[m[1]], 10); const d = parseInt(m[2], 10)
        return { y: y, m: mo, d: d, key: y + '-' + pad(mo) + '-' + pad(d), month: y + '-' + pad(mo) }
      }
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
      if (m) {
        const y = parseInt(m[1], 10); const mo = parseInt(m[2], 10); const d = parseInt(m[3], 10)
        return { y: y, m: mo, d: d, key: y + '-' + pad(mo) + '-' + pad(d), month: y + '-' + pad(mo) }
      }
      m = s.match(/^(\d{1,2})-(\d{1,2})/)
      if (m) {
        const now = new Date()
        let y = now.getFullYear()
        const mo = parseInt(m[1], 10)
        if (mo > now.getMonth() + 1 && mo >= 10) y -= 1
        const d = parseInt(m[2], 10)
        return { y: y, m: mo, d: d, key: y + '-' + pad(mo) + '-' + pad(d), month: y + '-' + pad(mo) }
      }
      return null
    }

    const normUrl = (u) => { let s = String(u).trim(); if (s.indexOf('//') === 0) s = 'https:' + s; return s.replace(/\/(thumb150|orj360|wap180|bmiddle|mw690)\//g, '/mw2000/') }
    const pidOf = (u) => { const clean = String(u).split('?')[0]; const seg = (clean.split('/').pop() || '').replace(/\.(jpg|jpeg|png|gif|webp|bmp|mp4)$/i, ''); return seg.replace(/[^0-9A-Za-z_-]/g, '') }
    const extOfUrl = (u) => { const m = String(u).match(/\.(jpg|jpeg|png|gif|webp|bmp|mp4)(\?|$)/i); return m ? '.' + m[1].toLowerCase() : null }

    async function getVideoUrl(mb, cookie) {
      try {
        const grab = (pi) => {
          if (!pi) return null
          const mi = pi.media_info || {}
          const u = (pi.urls && (pi.urls.mp4_720p_mp4 || pi.urls.mp4_hd_mp4)) || mi.stream_url_hd || mi.stream_url || null
          return u ? String(u) : null
        }
        const local = grab(mb.page_info)
        if (local) return local
        const r = await httpJson('https://m.weibo.cn/statuses/show?id=' + encodeURIComponent(mb.mid), cookie)
        if (r.json && r.json.data) {
          const pi = (r.json.data.page_info) || {}
          const u = grab(pi)
          if (u) return u
        }
      } catch (e) {}
      return null
    }

    async function buildItems(rows, monthKey, cookie) {
      const map = new Map()
      for (const row of rows) {
        const mb = row.mb
        const d = row.d
        if (mb.retweeted_status && !(mb.pics && mb.pics.length) && !mb.original_pic) continue
        const pics = mb.pics || []
        const urls = pics.map((p) => (p.large && p.large.url) || p.url || '').filter(Boolean)
        if (!urls.length && mb.original_pic) urls.push(mb.original_pic)
        for (const u0 of urls) {
          const u = normUrl(u0)
          const pid = pidOf(u)
          if (!pid) continue
          const key = 'img:' + pid
          if (map.has(key)) continue
          map.set(key, { key: key, url: u, ext: extOfUrl(u) || '.jpg', kind: 'image', dateKey: d ? d.key : null, pid: pid })
        }
        const pi = mb.page_info || {}
        const isVideo = String(pi.type) === 'video' || String(pi.object_type) === 'video'
        if (isVideo && mb.mid) {
          const vurl = await getVideoUrl(mb, cookie)
          if (vurl) {
            const key = 'vid:' + mb.mid
            if (!map.has(key)) map.set(key, { key: key, url: vurl, ext: '.mp4', kind: 'video', dateKey: d ? d.key : null, pid: 'v' + mb.mid })
          }
        }
      }
      return map
    }

    async function httpJson(url, cookie) {
      const r = await nodeCall('json', url, cookie)
      if (!r.ok) {
        const info = String(r.err)
        if (info.indexOf('432') >= 0 || info.indexOf('passport') >= 0 || info.indexOf('login') >= 0) return { err: 'login-gate:' + info.slice(0, 120) }
        return { err: info.slice(0, 240) }
      }
      const body = (r.stdout || '').trim()
      if (!body) return { err: 'empty body' }
      if (body[0] !== '{' && body[0] !== '[') return { err: 'non-json head: ' + body.slice(0, 160) }
      let j = null
      try { j = JSON.parse(body) } catch (e) { return { err: 'bad-json: ' + body.slice(0, 160) } }
      if (j && typeof j === 'object' && 'ok' in j && j.ok !== 1) return { err: 'api-err ok=' + j.ok + ' ' + JSON.stringify(j).slice(0, 160) }
      return { json: j }
    }

    async function feedContainerId(cookie, uid) {
      let container = '107603' + uid
      try {
        const prof = await httpJson('https://m.weibo.cn/api/container/getIndex?type=uid&value=' + uid + '&containerid=100505' + uid, cookie)
        if (prof.json && prof.json.data) {
          const ui = prof.json.data.userInfo || {}
          log('博主 uid=' + uid + ' screen_name:', ui.screen_name || '?')
          const tabs = ((prof.json.data.tabsInfo && prof.json.data.tabsInfo.tabs) || [])
          for (const t of tabs) if (String(t.title || '').indexOf('微博') >= 0 && t.containerid) { container = t.containerid; break }
        }
      } catch (e) {}
      return container
    }

    async function crawlMonth(uid, monthKey, cookie) {
      const container = await feedContainerId(cookie, uid)
      log('uid=' + uid + ' 微博流容器:', container)
      const map = await pageFeed(container, monthKey, cookie, 'feed')
      if (!map || map.size === 0) return { total: 0, added: 0, skipped: 0, failed: 0, note: '当月未发现新内容或接口受限' }
      const dir = blogMonthDir(uid, monthKey)
      await mkdirP(dir)
      const batch = Array.from(map.values()).map((it) => ({ name: ((it.dateKey ? it.dateKey : monthKey + '-01') + '_' + (it.pid || 'm')) + it.ext, url: it.url }))
      return downloadBatch(batch, dir, monthKey, cookie)
    }

    async function downloadBatch(batch, dir, monthKey, cookie) {
      let added = 0, skipped = 0, failed = 0
      for (const b of batch) {
        const dest = dir + '\\' + b.name
        if (await fileExists(dest)) { skipped++; continue }
        const dl = await nodeCall('file', b.url, cookie || '', dest)
        const sz = await fileSizeOf(dest)
        if (!dl.ok || sz <= 0) {
          try { fs.rmSync(dest, { force: true }) } catch (e) {}
          failed++
          log('下载失败:', b.name, dl.err || ('size ' + sz))
        } else { added++; log('新增[' + monthKey + ']:', b.name, sz + 'B') }
        await sleep(250)
      }
      return { total: batch.length, added: added, skipped: skipped, failed: failed, month: monthKey }
    }

    // 抓单月(默认微博流): 持续翻页直到翻过当月边界。
    async function pageFeed(container, monthKey, cookie, sourceName) {
      const base = 'https://m.weibo.cn/api/container/getIndex?containerid=' + container
      const rows = []
      let scheme = null
      let nextSince = ''
      let page = 1
      let pages = 0
      let anyMonthSeen = false
      for (; pages < 80; pages++) {
        let url = base
        if (scheme === 'since' && nextSince) url += '&since_id=' + encodeURIComponent(nextSince)
        else if (scheme === 'page' && page > 1) url += '&page=' + page
        const r = await httpJson(url, cookie)
        if (r.err) throw new Error('weibo:' + sourceName + ':' + r.err)
        const data = (r.json && r.json.data) || {}
        const cards = data.cards || []
        const cli = data.cardlistInfo || {}
        if (!cards.length) break
        if (scheme === null) scheme = Object.prototype.hasOwnProperty.call(cli, 'since_id') ? 'since' : 'page'
        if (scheme === 'since') {
          const s = typeof cli.since_id === 'string' ? cli.since_id : ''
          if (s) nextSince = s
          else if (pages === 0) scheme = 'page'
        } else {
          page = (typeof cli.page === 'number' && cli.page) ? cli.page + 1 : page + 1
        }
        let pageSaw = false
        let pageOlder = false
        for (const card of cards) {
          const mb = card && card.mblog
          if (!mb) continue
          const d = parseCreated(mb.created_at)
          const ym = d ? d.month : null
          if (ym === monthKey) { pageSaw = true; anyMonthSeen = true; rows.push({ mb: mb, d: d }) }
          else if (ym && ym < monthKey) pageOlder = true
        }
        log('pageFeed', sourceName, 'round', pages, 'cards', cards.length, 'rows', rows.length)
        if (!pageSaw && pageOlder && anyMonthSeen) break
        if (!pageSaw && pageOlder && !anyMonthSeen && pages >= 1) break
        await sleep(700)
      }
      log('pageFeed done', sourceName, 'pages', pages, 'rows', rows.length)
      return buildItems(rows, monthKey, cookie)
    }

    // ---- 历史回填: 今年 01 .. 上月(断点续传,按需增量) ----
    function monthWindow() {
      const n = new Date()
      const y = n.getFullYear()
      const m = n.getMonth() + 1
      if (m <= 1) return null
      const from = y + '-01'
      const to = y + '-' + pad(m - 1)
      const months = []
      for (let mm = 1; mm < m; mm++) months.push(y + '-' + pad(mm))
      return { year: y, from: from, to: to, months: months, label: from + '..' + to }
    }

    function monthsBetween(from, to) {
      const out = []
      if (!from || !to) return out
      const fm = /^(\d{4})-(\d{2})$/.exec(from); const tm = /^(\d{4})-(\d{2})$/.exec(to)
      if (!fm || !tm || fm[1] !== tm[1]) return out
      const y = fm[1]
      for (let mm = parseInt(fm[2], 10); mm <= parseInt(tm[2], 10); mm++) out.push(y + '-' + pad(mm))
      return out
    }

    async function ensureHistoricalFor(uid) {
      const st = await loadBlogState(uid)
      const yearWin = monthWindow()
      const curYear = String(new Date().getFullYear())
      if (!yearWin) {
        if (!st.historical || st.historical.year !== curYear || !st.historical.done) {
          st.historical = { year: curYear, from: null, to: null, window: 'none', done: true, pageNext: 1, since: '', pages: 0, found: {}, summary: { note: '当前为 1 月,无需回填', done: true } }
          await saveBlogState(uid, st)
        }
        return
      }
      if (st.historical && st.historical.year === yearWin.year && st.historical.done && st.historical.to === yearWin.to && st.historical.window === yearWin.label) return
      let win = null
      const hist = (st.historical && st.historical.year === yearWin.year) ? st.historical : null
      if (hist && !hist.done && hist.window && typeof hist.pageNext === 'number' && hist.from && hist.to) {
        win = { year: yearWin.year, from: hist.from, to: hist.to, months: monthsBetween(hist.from, hist.to), label: hist.window }
      } else if (hist && hist.done && hist.to && hist.to < yearWin.to) {
        const missing = yearWin.months.filter((m) => m > hist.to)
        if (missing.length) win = { year: yearWin.year, from: missing[0], to: yearWin.to, months: missing, label: missing[0] + '..' + yearWin.to }
      }
      if (!win) win = yearWin
      if (win.months.length === 0) return
      if (!(st.cookie && st.cookie.length > 4)) {
        if (!st.historical) st.historical = { year: yearWin.year, from: null, to: null, window: null, done: false, since: '', pages: 0, found: {}, summary: null }
        st.historical.summary = { error: '缺少 Cookie,无法回填历史相册', done: false }
        st.cookieNeeded = true
        await saveBlogState(uid, st)
        return
      }
      await backfillHistory(win, uid)
    }

    async function ensureHistoricalAll() {
      if (histBusy) return
      histBusy = true
      try {
        for (const b of BLOGS) {
          try { await ensureHistoricalFor(b.uid) }
          catch (e) {
            log('历史回填异常 uid=' + b.uid + ':', String((e && e.message) || e))
            const s2 = await loadBlogState(b.uid)
            if (s2.historical) { s2.historical.summary = Object.assign({}, s2.historical.summary, { error: String((e && e.message) || e).slice(0, 200), done: false }) }
            await saveBlogState(b.uid, s2)
          }
        }
      } finally { histBusy = false }
    }

    async function backfillHistory(win, uid) {
      log('开始历史回填 uid=' + uid + ':', win.label)
      const st = await loadBlogState(uid)
      const cookie = st.cookie || ''
      const container = await feedContainerId(cookie, uid)
      const from = win.from
      const monthsSet = {}
      for (const m of win.months) monthsSet[m] = true
      for (const m of win.months) await mkdirP(blogMonthDir(uid, m))
      const base = 'https://m.weibo.cn/api/container/getIndex?containerid=' + container
      const resumeSame = st.historical && st.historical.window === win.label
      // 微博流翻页: 用数字 page(该容器响应无 since_id,置顶旧帖也让 since 语义不可靠);
      // 只有整页都早于窗口下界时才视为已越过窗口。空页或达到页数上限 -> 未完成,下次续传。
      let pageNext = (resumeSame && typeof st.historical.pageNext === 'number' && st.historical.pageNext > 1) ? st.historical.pageNext : 1
      let pages = resumeSame ? (st.historical.pages || 0) : 0
      const found = Object.assign({}, (st.historical && st.historical.found) || {})
      let addedAll = 0, skippedAll = 0, failedAll = 0
      let finishReason = 'running'
      let emptyStreak = 0
      const MAX_HIST_PAGES = 2000
      for (; pages < MAX_HIST_PAGES; pages++) {
        let url = base
        if (pageNext > 1) url += '&page=' + pageNext
        const r = await httpJson(url, cookie)
        if (r.err) {
          const msg = String(r.err)
          if (msg.indexOf('login-gate') >= 0 || msg.indexOf('432') >= 0 || msg.indexOf('passport') >= 0) {
            const s2 = await loadBlogState(uid); s2.cookieNeeded = true
            if (s2.historical) s2.historical.summary = { error: '登录态失效,回填暂停', done: false, pages: pages }
            await saveBlogState(uid, s2)
            log('回填: 登录失效', msg.slice(0, 120))
            return
          }
          log('回填页错误(继续):', msg.slice(0, 160))
          await sleep(900)
          continue
        }
        const data = (r.json && r.json.data) || {}
        const cards = data.cards || []
        const cli = data.cardlistInfo || {}
        if (!cards.length) {
          emptyStreak++
          if (emptyStreak >= 2) { finishReason = 'ended'; break }
          pageNext++
          await sleep(500)
          continue
        }
        emptyStreak = 0
        if (typeof cli.page === 'number' && cli.page > 1) pageNext = cli.page

        const byMonth = {}
        let pageHasTarget = false
        let pageHasBelow = false
        let pageHasAbove = false
        for (const card of cards) {
          const mb = card && card.mblog
          if (!mb) continue
          const d = parseCreated(mb.created_at)
          if (!d) continue
          if (d.month < from) pageHasBelow = true
          else if (monthsSet[d.month]) {
            pageHasTarget = true
            if (!byMonth[d.month]) byMonth[d.month] = []
            byMonth[d.month].push({ mb: mb, d: d })
          } else pageHasAbove = true
        }
        for (const mkey of Object.keys(byMonth)) {
          const rows = byMonth[mkey]
          const items = await buildItems(rows, mkey, cookie)
          if (!items || items.size === 0) continue
          const dir = blogMonthDir(uid, mkey)
          await mkdirP(dir)
          const batch = Array.from(items.values()).map((it) => ({ name: ((it.dateKey ? it.dateKey : mkey + '-01') + '_' + (it.pid || 'm')) + it.ext, url: it.url }))
          const res = await downloadBatch(batch, dir, mkey, cookie)
          addedAll += res.added; skippedAll += res.skipped; failedAll += res.failed
          found[mkey] = ((found[mkey] || 0) + res.added)
        }
        const h = await loadBlogState(uid)
        h.historical = Object.assign({}, h.historical, {
          year: win.year, window: win.label, from: win.from, to: win.to,
          done: false, pageNext: pageNext + 1, pages: pages + 1, found: found,
          summary: { window: win.label, page: pages + 1, found: found, added: addedAll, skipped: skippedAll, failed: failedAll, done: false },
        })
        await saveBlogState(uid, h)
        log('回填进度 uid=' + uid + ': 页', pages + 1, '(pageNext ' + (pageNext + 1) + ')', '命中', JSON.stringify(Object.keys(byMonth)), '累计新增', addedAll, '跳过', skippedAll)
        // 整页既无窗口月也无更新(窗口上方)内容、且出现更早(窗口下界外)卡 -> 已越过窗口最旧边界
        if (!pageHasTarget && !pageHasAbove && pageHasBelow) { finishReason = 'crossed'; break }
        pageNext++
        await sleep(700)
      }
      const done = finishReason === 'crossed'
      const h2 = await loadBlogState(uid)
      h2.historical = Object.assign({}, h2.historical, {
        year: win.year, window: win.label, from: win.from, to: win.to,
        done: done, pageNext: (done ? 1 : pageNext), pages: pages, found: found,
        summary: {
          window: win.label, pages: pages, found: found, added: addedAll, skipped: skippedAll, failed: failedAll, done: done,
          note: finishReason === 'crossed' ? '完成' : (finishReason === 'ended' ? '翻页耗尽但未越过窗口下界(下次打开继续)' : '达到页数上限,下次打开继续'),
        },
      })
      await saveBlogState(uid, h2)
      log('历史回填结束 uid=' + uid + ':', win.label, done ? '完成' : '未完成(下次继续)', '新增', addedAll, '跳过', skippedAll, '失败', failedAll)
    }

    function todayParts() {
      const n = new Date()
      return { date: n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()), month: n.getFullYear() + '-' + pad(n.getMonth() + 1) }
    }

    // 展示月份: 显式切换(activeMonth)时严格按该月展示(可为空月,媒体=[]);
    // 未显式选择(打开 DSH 复位后)时,默认该博主最新有内容的月份,其次最新月份。
    async function activeFor(uid, activeMonth) {
      const months = await listMonths(uid)
      const withCounts = []
      for (const m of months) { const files = await listMonthFiles(uid, m); withCounts.push({ month: m, count: files.length }) }
      if (activeMonth && /^\d{4}-\d{2}$/.test(activeMonth)) {
        let w = null
        for (const c of withCounts) if (c.month === activeMonth) { w = c; break }
        if (!w) w = { month: activeMonth, count: 0 }
        return { months: withCounts, active: w.month, activeCount: w.count }
      }
      let found = null
      for (const w of withCounts) if (w.count > 0) { found = w; break }
      if (!found && withCounts[0]) found = withCounts[0]
      return { months: withCounts, active: found ? found.month : null, activeCount: found ? found.count : 0 }
    }

    async function runSync(force, uid) {
      if (busy) return { busy: true }
      busy = true
      try {
        const st = await loadBlogState(uid)
        const ui = await loadUi()
        const tp = todayParts()
        if (!force && st.lastCheckDate === tp.date) {
          log('uid=' + uid + ' 日期相同(' + tp.date + '),跳过微博检查')
          lastViewByUid[uid] = { skipped: true, today: tp.date, ...(await activeFor(uid, ui.activeMonth)) }
          return lastViewByUid[uid]
        }
        log('uid=' + uid + ' 日期不同(' + (st.lastCheckDate || '无记录') + ' → ' + tp.date + '),开始微博检查')
        await mkdirP(blogAlbums(uid))
        const isNewMonth = st.lastSyncMonth !== tp.month
        if (isNewMonth) log('uid=' + uid + ' 进入新的一月 ' + tp.month + ',新建 year-month 文件夹')
        await mkdirP(blogMonthDir(uid, tp.month))
        const sum = await crawlMonth(uid, tp.month, st.cookie || '')
        st.lastCheckDate = tp.date
        st.lastSyncMonth = tp.month
        st.lastAttempt = tp.date
        st.lastError = null
        st.summary = sum
        await saveBlogState(uid, st)
        lastViewByUid[uid] = { skipped: false, summary: sum, today: tp.date, ...(await activeFor(uid, ui.activeMonth)) }
        log('uid=' + uid + ' 同步完成:', JSON.stringify(sum))
        return lastViewByUid[uid]
      } catch (e) {
        const msg = String((e && e.message) || e)
        log('uid=' + uid + ' 同步失败:', msg)
        try {
          const st = await loadBlogState(uid)
          const ui = await loadUi()
          st.lastAttempt = todayParts().date
          st.lastError = msg
          if (msg.indexOf('登录') >= 0 || msg.indexOf('login-gate') >= 0 || msg.indexOf('432') >= 0 || msg.indexOf('api-err') >= 0 || msg.indexOf('no-shell-subprocess-backend') >= 0) st.cookieNeeded = true
          await saveBlogState(uid, st)
          lastViewByUid[uid] = { error: msg, today: todayParts().date, ...(await activeFor(uid, ui.activeMonth)) }
        } catch (e2) { lastViewByUid[uid] = { error: msg + ' (状态保存失败: ' + e2 + ')' } }
        return lastViewByUid[uid]
      } finally { busy = false }
    }

    async function viewState() {
      const ui = await loadUi()
      const blog = BLOGS.find((b) => b.uid === ui.activeBlog) || BLOGS[0]
      const st = await loadBlogState(blog.uid)
      const tp = todayParts()
      const res = await activeFor(blog.uid, ui.activeMonth)
      const media = []
      if (res.active) {
        const files = await listMonthFiles(blog.uid, res.active)
        for (const f of files) media.push({ name: f.name, kind: f.kind, size: f.size, url: '/zly-wallpaper/media/' + blog.uid + '/' + res.active + '/' + f.name })
      }
      return {
        ok: true, today: tp.date, month: tp.month, name: blog.name, uid: blog.uid, root: ROOT,
        lastCheckDate: st.lastCheckDate, lastSyncMonth: st.lastSyncMonth, lastAttempt: st.lastAttempt, lastError: st.lastError,
        cookieSet: !!(st.cookie && st.cookie.length > 4), cookieNeeded: !!st.cookieNeeded,
        skippedToday: lastViewByUid[blog.uid] ? !!lastViewByUid[blog.uid].skipped : (st.lastCheckDate === tp.date),
        syncing: busy, histBusy: histBusy,
        pref: ui.pref || { auto: true, mode: 'glass', intervalSec: 12 },
        summary: st.summary, historical: st.historical || null,
        blogs: BLOGS.map((b) => ({ uid: b.uid, name: b.name })),
        activeBlog: blog.uid, months: res.months, activeMonth: res.active, activeCount: res.activeCount, media: media,
        diag: diag, svc: { hostNative: true, webServer: !!svc.webServer, timer: !!svc.timer },
      }
    }

    async function handleSet(a) {
      const ui = await loadUi()
      if (typeof a.activeBlog === 'string') {
        const t = sanitizeUid(a.activeBlog)
        if (BLOGS.some((b) => b.uid === t)) {
          if (ui.activeBlog !== t) ui.activeMonth = null
          ui.activeBlog = t
          await saveUi(ui)
        }
      }
      if (typeof a.cookie === 'string') {
        const st = await loadBlogState(ui.activeBlog)
        st.cookie = a.cookie.trim()
        st.cookieNeeded = false
        await saveBlogState(ui.activeBlog, st)
      }
      if (typeof a.activeMonth === 'string' && /^\d{4}-\d{2}$/.test(a.activeMonth)) {
        ui.activeMonth = a.activeMonth
        await saveUi(ui)
      }
      if (a.pref && typeof a.pref === 'object') {
        const p = Object.assign({}, ui.pref, a.pref)
        if (typeof p.mode === 'string' && MODES.indexOf(p.mode) < 0) {
          if (typeof p.glass === 'boolean') p.mode = p.glass ? 'glass' : 'solid'
          else p.mode = ui.pref.mode
        }
        ui.pref = p
        await saveUi(ui)
      }
      return viewState()
    }

    function readBody(req) {
      return new Promise((resolve) => {
        let data = ''
        req.on('data', (c) => { data += c; if (data.length > 65536) { data = data.slice(0, 65536); req.destroy() } })
        req.on('end', () => resolve(data))
        req.on('error', () => resolve(data))
      })
    }

    if (svc.webServer) {
      try {
        const disposeRoute = svc.webServer.register({
          kind: 'prefix',
          path: '/zly-wallpaper',
          handler: async (req, res) => {
            try {
              const pathname = (req.url || '').split('?')[0]
              const rest = pathname.slice('/zly-wallpaper'.length)
              if (rest === '/wallpaper.js') {
                res.statusCode = 200
                res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
                res.setHeader('Cache-Control', 'no-cache')
                res.end(BROWSER_JS)
                return
              }
              if (rest === '/refresh') {
                const ui = await loadUi()
                await runSync(true, ui.activeBlog)
                await ensureHistoricalFor(ui.activeBlog)
                res.statusCode = 200
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok: true, state: await viewState() }))
                return
              }
              if (rest === '/set') {
                let body = {}
                try { body = JSON.parse((await readBody(req)) || '{}') } catch (e) {}
                res.statusCode = 200
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok: true, state: await handleSet(body) }))
                return
              }
              if (rest.indexOf('/media/') === 0) {
                const parts = rest.slice('/media/'.length).split('/')
                const uid = parts[0] || ''
                const month = parts[1] || ''
                const name = parts.slice(2).join('/')
                if (!/^[0-9A-Za-z_-]{1,32}$/.test(uid) || !BLOGS.some((b) => b.uid === uid)) { res.statusCode = 400; res.end('bad blog'); return }
                if (!/^\d{4}-\d{2}$/.test(month) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) { res.statusCode = 400; res.end('bad path'); return }
                const full = path.join(blogMonthDir(uid, month), name)
                try {
                  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { res.statusCode = 404; res.end('not found'); return }
                  const ext = extOf(name)
                  const st = fs.statSync(full)
                  if (st.size > MAXF) { res.statusCode = 413; res.end('too large'); return }
                  const bytes = fs.readFileSync(full)
                  res.statusCode = 200
                  res.setHeader('Content-Type', (ext && MIME[ext]) || 'application/octet-stream')
                  res.setHeader('Content-Length', String(bytes.length))
                  res.setHeader('Cache-Control', 'no-cache')
                  res.end(bytes)
                } catch (e2) { res.statusCode = 500; res.end('read fail: ' + String((e2 && e2.message) || e2)) }
                return
              }
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, state: await viewState() }))
            } catch (e) { try { res.statusCode = 500; res.end('err') } catch (e2) {} }
          },
        })
        addClean(() => { try { disposeRoute() } catch (e) {} })
        log('HTTP route registered: /zly-wallpaper')
      } catch (e) { log('route register failed(可能另一实例已注册):', String((e && e.message) || e)) }

      try {
        const disposeTap = svc.webServer.tapIndex((html) => {
          if (html.indexOf('id="zly-wallpaper-stage"') >= 0) return html
          const at = html.indexOf('</body>')
          return at >= 0 ? html.slice(0, at) + STAGE_HTML + html.slice(at) : html + STAGE_HTML
        })
        addClean(() => { try { disposeTap() } catch (e) {} })
      } catch (e) { log('tapIndex failed:', String((e && e.message) || e)) }
    }

    const start = async () => {
      await setup().catch((e) => log('setup error', String((e && e.message) || e)))
      // 每次打开 DSH: 展示月份复位为最新(有内容)月;首次启动顺带迁移旧版数据
      try {
        fs.mkdirSync(ROOT, { recursive: true })
        await migrateLegacy()
        const ui = await loadUi()
        if (ui.activeMonth) { ui.activeMonth = null; await saveUi(ui) }
      } catch (e) { log('startup migrate/reset error', String((e && e.message) || e)) }
      // 先做各博主当月同步,结束后再跑历史回填,避免整文件状态写入互相覆盖
      for (const b of BLOGS) {
        try { await runSync(false, b.uid) } catch (e) { log('startup sync error uid=' + b.uid, String((e && e.message) || e)) }
      }
      if (svc.timer) svc.timer.timeout(() => { ensureHistoricalAll().catch((e) => log('hist ensure error', String((e && e.message) || e))) }, 1000)
      else addClean(ctx.effect(() => nativeTimeout(() => { ensureHistoricalAll().catch((e) => log('hist ensure error', String((e && e.message) || e))) }, 1000)))
    }
    if (svc.timer) addClean(ctx.effect(() => svc.timer.timeout(start, 1200)))
    else addClean(ctx.effect(() => nativeTimeout(start, 1200)))
    log('engine apply ok; ROOT=' + ROOT)
  },
}
