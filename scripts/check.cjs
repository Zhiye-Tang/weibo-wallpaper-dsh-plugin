'use strict'
// 发布质量检查(推送前自检):  node scripts/check.cjs
// 检查项:
//   1. 两个插件目录完整: index.cjs / package.json(name+version) / config.example.json
//   2. 每个 JS 文件通过 node --check 语法校验
//   3. 源码不携带作者本机路径 / 敏感信息(Cookie 等)
//   4. 运行目录里没有误入库的个人数据(state.json/ui.json/albums)
//   5. 安装补丁示例 install/cordis.patch.snippet.yml 存在且含两个 id
//   6. README 存在
const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const ROOT = path.join(__dirname, '..')
const errors = []
const warn = []
const note = (m) => console.log('  -', m)
const fail = (m) => { errors.push(m); note('FAIL ' + m) }
const okNote = (m) => note('ok   ' + m)

const PLUGINS = ['zly-wallpaper-engine', 'zly-wallpaper-boot']

console.log('[check] 目录: ' + ROOT)
for (const p of PLUGINS) {
  const dir = path.join(ROOT, 'plugins', p)
  console.log('[check] 检查插件 ' + p)
  if (!fs.existsSync(dir)) { fail(p + '/ 目录不存在'); continue }
  const idx = path.join(dir, 'index.cjs')
  const pkgFile = path.join(dir, 'package.json')
  if (!fs.existsSync(idx)) fail(p + '/index.cjs 缺失')
  if (!fs.existsSync(pkgFile)) fail(p + '/package.json 缺失')
  else {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
      if (!pkg.name || !pkg.version) fail(p + '/package.json 必须同时含 name 与 version(否则 REQUEST_EXTENSION)')
      else okNote('package.json name=' + pkg.name + ' version=' + pkg.version)
      if (!pkg.license) warn.push(p + '/package.json 未声明 license')
    } catch (e) { fail(p + '/package.json 解析失败: ' + e.message) }
  }
  // 语法(node --check 输出直通控制台;stdout 走 inherit 以兼容受限 shell)
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.cjs') || f.endsWith('.js'))) {
    try { cp.execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'inherit' }); okNote(f + ' 语法通过') }
    catch (e) { fail(p + '/' + f + ' 语法错误(见上方输出)') }
  }
  // 个人数据误入库
  for (const bad of ['state.json', 'ui.json', 'albums', 'config.json']) {
    if (fs.existsSync(path.join(dir, bad))) fail(p + '/ 内发现个人数据文件 ' + bad + ' —— 它不属于仓库')
  }
  if (p === 'zly-wallpaper-engine' && !fs.existsSync(path.join(dir, 'config.example.json'))) fail(p + '/config.example.json 缺失')
}

// 敏感信息扫描(源码范围内)
console.log('[check] 扫描敏感信息')
const scanFiles = []
for (const p of PLUGINS) {
  const dir = path.join(ROOT, 'plugins', p)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir)) if (/\.(cjs|js|json)$/.test(f)) scanFiles.push(path.join(dir, f))
}
scanFiles.push(path.join(ROOT, 'test', 'smoke.cjs'))
const sensitive = [
  [/D:\\DSH_Project/i, '作者本机工作区路径'],
  [/Lenovo/i, '作者本机用户名'],
  [/SUB=_/i, '疑似微博 Cookie'],
  [/(?:"|')([A-Za-z0-9+/=]{60,})(?:"|')/, '疑似长密钥串'],
]
for (const f of scanFiles) {
  if (!fs.existsSync(f)) continue
  const txt = fs.readFileSync(f, 'utf8')
  for (const [re, label] of sensitive) {
    const m = re.exec(txt)
    if (m) fail(path.relative(ROOT, f) + ' 命中敏感模式: ' + label)
  }
}

// 安装示例
console.log('[check] 安装示例与 README')
const snippet = path.join(ROOT, 'install', 'cordis.patch.snippet.yml')
if (!fs.existsSync(snippet)) fail('install/cordis.patch.snippet.yml 缺失')
else {
  const s = fs.readFileSync(snippet, 'utf8')
  if (s.indexOf('zly-wallpaper-engine') < 0 || s.indexOf('zly-wallpaper-boot') < 0 || s.indexOf('- insert:') < 0) fail('安装示例缺少 insert 行或插件 id')
  else okNote('安装示例含两个 insert 插件行')
}
if (!fs.existsSync(path.join(ROOT, 'README.md'))) fail('README.md 缺失')
if (!fs.existsSync(path.join(ROOT, 'LICENSE'))) fail('LICENSE 缺失')
if (!fs.existsSync(path.join(ROOT, 'test', 'smoke.cjs'))) warn.push('test/smoke.cjs 缺失(可选,发布前建议运行 npm test)')

console.log('[check] 结果: ' + (errors.length ? errors.length + ' 个错误' : '全部通过') + (warn.length ? '; ' + warn.length + ' 个警告' : ''))
for (const w of warn) note('warn ' + w)
process.exit(errors.length ? 1 : 0)
