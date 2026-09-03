'use strict'
// 引擎 v3 烟雾测试(离线): 复制引擎到临时目录 -> 假 ctx/假 fetch -> 演练
// 旧版数据迁移、当月抓取下载、历史回填缺 Cookie 分支、HTTP 路由与多博主切换。
// 用法: node test/smoke.cjs   (需要 Node >= 18;不访问真实网络)
const fs = require('fs')
const path = require('path')

const HERE = __dirname
const REPO = path.join(HERE, '..')
const ENGINE_SRC = path.join(REPO, 'plugins', 'zly-wallpaper-engine', 'index.cjs')
const SMOKE = path.join(REPO, '.smoke')
const UID1 = '1909576453'
const UID2 = '2222222222'

const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra ? String(extra) : '' })
  console.log('[smoke]', cond ? 'PASS' : 'FAIL', '-', name, extra ? '(' + extra + ')' : '')
}
function assert(cond, msg) { if (!cond) throw new Error('assert: ' + msg) }

async function main() {
  fs.rmSync(SMOKE, { recursive: true, force: true })
  fs.mkdirSync(SMOKE, { recursive: true })
  const root = path.join(SMOKE, 'data') // 模拟用户数据根目录
  const engDir = path.join(SMOKE, 'engine')
  fs.mkdirSync(path.join(root, 'albums', '2026-09'), { recursive: true })
  fs.mkdirSync(engDir, { recursive: true })

  // ---- 旧版(v2 平铺)数据: root/state.json + root/albums ----
  const legacyState = {
    version: 2, uid: UID1, name: '走路摇ZLY', lastCheckDate: null, lastSyncMonth: null, lastAttempt: null,
    lastError: null, cookie: '', cookieNeeded: false, activeMonth: '2026-09',
    pref: { auto: true, mode: 'glass', intervalSec: 12 }, summary: null, historical: { done: true },
  }
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(legacyState, null, 2))
  fs.writeFileSync(path.join(root, 'albums', '2026-09', 'legacy_old.jpg'), Buffer.from('LEGACYBYTES'))
  fs.copyFileSync(ENGINE_SRC, path.join(engDir, 'index.cjs'))
  fs.writeFileSync(path.join(engDir, 'config.json'), JSON.stringify({ root, blogs: [{ uid: UID1, name: '走路摇ZLY' }, { uid: UID2, name: '第二博主' }] }, null, 2))

  // ---- 假 ctx / 假 webServer / 假 fetch ----
  const cleanups = []
  const fakeCtx = {
    get(name) { if (name === 'webServer') return fakeWeb; return undefined },
    effect(fn) { let c = null; try { c = fn() } catch (e) {} if (typeof c === 'function') { cleanups.push(c); return c } return () => {} },
  }
  let routeHandler = null
  let tapFns = []
  const fakeWeb = {
    register(opts) { routeHandler = opts.handler; return () => {} },
    tapIndex(fn) { tapFns.push(fn); return () => {} },
  }

  // 假网络: 一切响应本地生成
  const containerCalls = { [UID1]: 0, [UID2]: 0 }
  global.fetch = async (url) => {
    const u = String(url)
    const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o), arrayBuffer: async () => Buffer.from(JSON.stringify(o)) })
    if (u.indexOf('baidu.com') >= 0) return { ok: true, status: 200, text: async () => 'ok', arrayBuffer: async () => Buffer.from('ok') }
    if (u.indexOf('type=uid') >= 0) {
      const m = /value=(\d+)/.exec(u)
      const uid = m ? m[1] : UID1
      return json({ ok: 1, data: { userInfo: { screen_name: uid === UID1 ? '走路摇ZLY' : '第二博主' }, tabsInfo: { tabs: [{ title: '微博', containerid: '107603' + uid }] } } })
    }
    if (u.indexOf('containerid=107603') >= 0) {
      const m = /containerid=107603(\d+)/.exec(u)
      const uid = m ? m[1] : UID1
      containerCalls[uid] = (containerCalls[uid] || 0) + 1
      const call = containerCalls[uid]
      if (call === 1 && uid === UID1) {
        // 只有 UID1 的"当月"流返回 1 条带图微博(9 月 1 日)
        return json({ ok: 1, data: { cardlistInfo: { page: 1 }, cards: [{ card_type: 9, mblog: { created_at: 'Mon Sep 01 10:00:00 +0800 2026', mid: 'mid' + uid, text: 'hi', pics: [{ large: { url: 'https://wx1.sinaimg.cn/mw690/deadbeef.jpg' } }], original_pic: null, page_info: null } }] } })
      }
      // 其余翻页 / 其他博主: 空卡片 -> 触发"翻页耗尽"或当月无内容分支
      return json({ ok: 1, data: { cardlistInfo: { page: call }, cards: [] } })
    }
    // 媒体下载(图片地址等兜底)
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('FAKEIMGBYTES'), text: async () => 'x' }
  }

  const engine = require(path.join(engDir, 'index.cjs'))
  engine.apply(fakeCtx)
  assert(typeof routeHandler === 'function', 'webServer.register 应被调用并保存 handler')

  const fakeRes = () => {
    const r = { statusCode: 0, headers: {}, body: '' }
    r.setHeader = (k, v) => { r.headers[k] = v }
    r.end = (b) => { r.body = b === undefined ? '' : Buffer.isBuffer(b) ? b.toString('binary') : String(b) }
    return r
  }
  const fakeReq = (url, postBody) => ({
    url, method: postBody ? 'POST' : 'GET',
    on(ev, cb) { if (ev === 'data' && postBody) cb(JSON.stringify(postBody)); if (ev === 'end') cb() },
    destroy() {},
  })
  const callRoute = async (url, body) => {
    const res = fakeRes()
    await routeHandler(fakeReq(url, body), res)
    let parsed = null
    try { parsed = JSON.parse(res.body) } catch (e) {}
    return { res, parsed }
  }

  // ---- 等待引擎启动流程(migrate -> runSync -> ensureHistorical)完成 ----
  const today = new Date()
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  const dateStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate())
  const blogStateFile = path.join(root, UID1, 'state.json')
  const albumDir = path.join(root, UID1, 'albums', '2026-09')
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(blogStateFile)) {
        const st = JSON.parse(fs.readFileSync(blogStateFile, 'utf8'))
        if (st.lastCheckDate === dateStr) break
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250))
  }

  // ---- 断言: 旧数据迁移 ----
  ok('迁移: root/state.json 已移入 <uid>/', !fs.existsSync(path.join(root, 'state.json')))
  ok('迁移: root/albums 已移入 <uid>/albums', !fs.existsSync(path.join(root, 'albums')))
  ok('迁移: 旧文件保留在 <uid>/albums/2026-09/', fs.existsSync(path.join(albumDir, 'legacy_old.jpg')))
  ok('迁移: ui.json 已生成', fs.existsSync(path.join(root, 'ui.json')))
  if (fs.existsSync(path.join(root, 'ui.json'))) {
    const ui = JSON.parse(fs.readFileSync(path.join(root, 'ui.json'), 'utf8'))
    ok('迁移: ui.pref.mode=glass', ui.pref && ui.pref.mode === 'glass')
    ok('迁移: ui.activeBlog=' + UID1, ui.activeBlog === UID1)
    ok('迁移: ui.activeMonth 启动时已复位为 null', ui.activeMonth === null || ui.activeMonth === undefined)
  }

  // ---- 断言: 当月抓取(模拟 9 月 1 条带图微博) ----
  ok('抓取: 博主 state.json 存在', fs.existsSync(blogStateFile))
  let blogSt = {}
  if (fs.existsSync(blogStateFile)) blogSt = JSON.parse(fs.readFileSync(blogStateFile, 'utf8'))
  ok('抓取: lastCheckDate=' + dateStr, blogSt.lastCheckDate === dateStr)
  ok('抓取: summary.added=1', blogSt.summary && blogSt.summary.added === 1, JSON.stringify(blogSt.summary))
  const files = fs.readdirSync(albumDir).filter((f) => /\.(jpg|mp4)$/i.test(f))
  ok('抓取: 相册含旧图+新下载 2 个文件', files.length >= 2, files.join(','))

  // ---- 断言: 历史回填缺 Cookie 分支(异步,等它跑完) ----
  const hdeadline = Date.now() + 15000
  while (Date.now() < hdeadline) {
    try {
      const s = JSON.parse(fs.readFileSync(blogStateFile, 'utf8'))
      if (s.cookieNeeded && s.historical && s.historical.summary && String(s.historical.summary.error || '').indexOf('缺少 Cookie') >= 0) break
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250))
  }
  blogSt = JSON.parse(fs.readFileSync(blogStateFile, 'utf8'))
  ok('回填: cookieNeeded=true', blogSt.cookieNeeded === true)
  ok('回填: 摘要提示缺 Cookie', blogSt.historical && String(blogSt.historical.summary && blogSt.historical.summary.error || '').indexOf('缺少 Cookie') >= 0)

  // ---- 断言: HTTP 状态视图 ----
  const st1 = await callRoute('/zly-wallpaper/state')
  ok('路由: /state ok=true', st1.parsed && st1.parsed.ok === true && st1.parsed.state && st1.parsed.state.ok === true)
  if (st1.parsed && st1.parsed.state) {
    const s = st1.parsed.state
    ok('状态: 博主数=2', s.blogs && s.blogs.length === 2)
    ok('状态: activeBlog=' + UID1, s.activeBlog === UID1)
    ok('状态: 展示月份 2026-09', s.activeMonth === '2026-09')
    ok('状态: media>=2 项', s.media && s.media.length >= 2)
    ok('状态: 媒体 URL 含博主 uid 前缀', s.media.length ? String(s.media[0].url).indexOf('/zly-wallpaper/media/' + UID1 + '/') === 0 : false)
  }

  // ---- 断言: 媒体文件路由 ----
  const dlName = files.find((f) => f !== 'legacy_old.jpg') || files[0]
  if (dlName) {
    const res = fakeRes()
    await routeHandler(fakeReq('/zly-wallpaper/media/' + UID1 + '/2026-09/' + dlName), res)
    ok('路由: 媒体下载 200 且内容正确', res.statusCode === 200 && res.body.length > 0)
  }
  const badRes = fakeRes()
  await routeHandler(fakeReq('/zly-wallpaper/media/bad/2026-09/x.jpg'), badRes)
  ok('路由: 非法博主 400', badRes.statusCode === 400)

  // ---- 断言: set(切博主 -> 切回 + 设置 Cookie) ----
  const sw = await callRoute('/zly-wallpaper/set', { activeBlog: UID2 })
  ok('切换: 切到第二博主', sw.parsed && sw.parsed.state && sw.parsed.state.activeBlog === UID2)
  ok('切换: 第二博主当前无媒体(空)', sw.parsed.state && sw.parsed.state.media.length === 0)
  const swb = await callRoute('/zly-wallpaper/set', { activeBlog: UID1 })
  ok('切换: 切回 ' + UID1, swb.parsed && swb.parsed.state && swb.parsed.state.activeBlog === UID1)
  const setCookie = await callRoute('/zly-wallpaper/set', { cookie: 'SUB=smoketest' })
  ok('Cookie: 设置后 cookieSet=true', setCookie.parsed && setCookie.parsed.state && setCookie.parsed.state.cookieSet === true)
  const stAfter = JSON.parse(fs.readFileSync(blogStateFile, 'utf8'))
  ok('Cookie: 已写入 <uid>/state.json(仅本机)', stAfter.cookie === 'SUB=smoketest')
  const stateNoCookie = await callRoute('/zly-wallpaper/set', { cookie: '' })
  ok('Cookie: 清空后 cookieSet=false', stateNoCookie.parsed && stateNoCookie.parsed.state && stateNoCookie.parsed.state.cookieSet === false)

  // ---- 断言: 注入 HTML 包含壁纸层 ----
  const injected = tapFns.length ? tapFns[0]('<html><body>UI</body></html>') : ''
  ok('注入: tapIndex 含 stage/bar/wallpaper.js', injected.indexOf('zly-wallpaper-stage') >= 0 && injected.indexOf('zly-wallpaper-bar') >= 0 && injected.indexOf('/zly-wallpaper/wallpaper.js') >= 0)

  // ---- 清理 ----
  while (cleanups.length) { const c = cleanups.pop(); try { c() } catch (e) {} }
  fs.rmSync(SMOKE, { recursive: true, force: true })

  const failed = results.filter((r) => !r.pass)
  console.log('[smoke] ===== ' + (results.length - failed.length) + '/' + results.length + ' passed =====')
  if (failed.length) { console.log('[smoke] failed:', failed.map((f) => f.name + (f.extra ? ' :: ' + f.extra : '')).join('\n')); process.exit(1) }
  process.exit(0)
}

main().catch((e) => { console.error('[smoke] 异常:', e); process.exit(1) })
