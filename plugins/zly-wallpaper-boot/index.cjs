'use strict'
// 走路摇ZLY 壁纸引擎 —— 宿主级引导补丁 (wallpaper-boot)
//
// 作用: 让"打开 DSH 即显示壁纸、无需强制刷新"成立。
// 背景: 引擎随 DSH web 进程启动挂载,但浏览器往往早于引擎首次渲染 index;
//       引擎 tapIndex 注入对"已打开页面"无效,此前需一次 Ctrl+Shift+R。
// 方案: 本补丁随 DSH web 进程启动即注册(早于任何会话),向每个 index 渲染注入
//       <script src="/zly-wallpaper-boot/boot.js">。该脚本持续轮询引擎状态接口
//       /zly-wallpaper/state;一旦引擎上线(路由可用),就动态加载
//       /zly-wallpaper/wallpaper.js —— 它自带样式与 DOM 自举,页面无需刷新即出现壁纸。
// 自愈: 不限轮询次数;页面恢复可见 / 网络恢复时立即重试;引擎重启后自动重新挂载。
// 安全: 不发布服务、不触碰业务数据;只消费宿主 webServer(tapIndex + 一个前缀路由),
//       浏览器端仅本地轮询与脚本注入,无权限、无网络外发。

// ---- 浏览器端引导脚本(注入到每个 DSH 页面) ----
const BOOT_JS = [
  '(function(){',
  'function zlywReady(fn){if(document.readyState!==\'loading\'){fn()}else{document.addEventListener(\'DOMContentLoaded\',fn)}}',
  'function zlywStagePresent(){return !!(document.getElementById(\'zly-wallpaper-stage\')||document.getElementById(\'zly-wallpaper-bar\')||window.__zlywLoaded)}',
  'var zlywTimer=null;',
  'function zlywSchedule(delay){if(zlywTimer)return;zlywTimer=setTimeout(function(){zlywTimer=null;zlywPoll()},delay)}',
  'function zlywLoadWallpaper(){if(window.__zlywLoaded){return}window.__zlywLoaded=true;var s=document.createElement(\'script\');s.src=\'/zly-wallpaper/wallpaper.js\';s.async=true;s.onerror=function(){window.__zlywLoaded=false;zlywSchedule(3000)};document.head.appendChild(s)}',
  'function zlywPoll(){',
  '  if(zlywStagePresent()){return}',
  '  try{',
  '    fetch(\'/zly-wallpaper/state\',{cache:\'no-store\'}).then(function(r){if(!r.ok){return null}return r.json()}).then(function(j){',
  '      if(zlywStagePresent()){return}',
  '      if(j&&j.state&&j.state.ok){zlywLoadWallpaper()}else{zlywSchedule(2000)}',
  '    }).catch(function(){zlywSchedule(3000)})',
  '  }catch(e){zlywSchedule(3000)}',
  '}',
  'function zlywRetry(){if(zlywStagePresent())return;if(zlywTimer)return;zlywPoll()}',
  'zlywReady(function(){zlywPoll()})',
  'document.addEventListener(\'visibilitychange\',function(){if(!document.hidden)zlywRetry()})',
  'window.addEventListener(\'online\',function(){zlywRetry()})',
  'window.addEventListener(\'pageshow\',function(){zlywRetry()})',
  '})();'
].join('\n')

const BOOT_TAG = '<script src="/zly-wallpaper-boot/boot.js" async defer></script>'

module.exports = {
  inject: ['webServer'],
  apply(ctx) {
    const webServer = ctx.webServer
    if (!webServer) return
    const cleaners = []
    ctx.effect(() => () => { cleaners.forEach((f) => { try { f() } catch (e) {} }); cleaners.length = 0 })
    const addClean = (fn) => { if (typeof fn === 'function') cleaners.push(fn) }
    try {
      const disposeRoute = webServer.register({
        kind: 'prefix',
        path: '/zly-wallpaper-boot',
        handler: (req, res) => {
          try {
            const pathname = (req.url || '').split('?')[0]
            const rest = pathname.slice('/zly-wallpaper-boot'.length)
            if (rest === '/boot.js') {
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
              res.setHeader('Cache-Control', 'no-cache')
              res.end(BOOT_JS)
              return
            }
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (e) { try { res.statusCode = 500; res.end('err') } catch (e2) {} }
        },
      })
      addClean(() => { try { disposeRoute() } catch (e) {} })
    } catch (e) {
      console.log('[wallpaper-boot] route register failed:', String((e && e.message) || e))
    }
    try {
      const disposeTap = webServer.tapIndex((html) => {
        if (html.indexOf('/zly-wallpaper-boot/boot.js') >= 0) return html
        const at = html.indexOf('</body>')
        return at >= 0 ? html.slice(0, at) + BOOT_TAG + html.slice(at) : html + BOOT_TAG
      })
      addClean(() => { try { disposeTap() } catch (e) {} })
    } catch (e) {
      console.log('[wallpaper-boot] tapIndex failed:', String((e && e.message) || e))
    }
  },
}
