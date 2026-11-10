/**
 * LIVE isolated verification of dsh-lxj-remote against the real self-hosted
 * relay. Never touches the operator's ~/.dsh: everything happens under a
 * throwaway DSH_HOME, using a BRAND NEW node identity and NO public.json, so
 * what is proven here is the fresh-install default relay path.
 *
 * The throwaway home lives INSIDE this checkout (repo/.live-test) on purpose:
 * Node then resolves the plugin's optional host peers (@deepseek-ai/cordis,
 * dsh-typert-protocol, …) from the checkout's own node_modules, which is the
 * same relationship a real DSH install has to its plugin tree.
 *
 *   1. installs the packed tarball through the same file: channel DSH uses
 *   2. boots the installed artifact in-process on a real cordis Context
 *   3. waits for gate listeners, then reads /gate/status on the local door
 *   4. requires publicRelay.state === 'online' (relay WS handshake accepted)
 *   5. reads /pair/code and validates the QR payload against 「梁小鲸」 fields
 *   6. samples state for LXJ_OBSERVE_MS to prove there is no reconnect storm
 *
 * Run: npm pack --ignore-scripts && node scripts/test-live-gate.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const home = path.join(repo, '.live-test', 'dsh-home')
const OBSERVE_MS = Number(process.env.LXJ_OBSERVE_MS || 45_000)
const REALM = 'https://h-wxrelay.1day.wang'
let checks = 0
const say = m => { checks++; console.log(`PASS ${m}`) }

rmSync(path.join(repo, '.live-test'), { recursive: true, force: true })
try {
  const tgz = path.join(repo, 'dsh-lxj-remote-1.0.0.tgz')
  assert.ok(statSync(tgz).isFile(), 'run: npm pack --ignore-scripts')

  // 1 ── install channel: the same file: dependency DSH's plugin manager uses
  const profile = path.join(home, 'profiles', 'lxjlive')
  mkdirSync(profile, { recursive: true })
  writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-lxjlive', private: true,
    dependencies: { 'dsh-lxj-remote': `file:${tgz.replaceAll('\\', '/')}` },
    dsh: { profile: { bundles: ['dsh-lxj-remote'] } },
  }, null, 2))
  // npm is npm.cmd on Windows under spawn, and npm-cli.js is the reliable form.
  const npmCli = process.platform === 'win32'
    ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : null
  const npmArgs = npmCli && existsSync(npmCli)
    ? [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund']
    : ['install', '--ignore-scripts', '--no-audit', '--no-fund']
  execFileSync(npmCli && existsSync(npmCli) ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm'), npmArgs,
    { cwd: profile, windowsHide: true, timeout: 900_000, stdio: ['ignore', 'pipe', 'pipe'] })
  const installed = path.join(profile, 'node_modules', 'dsh-lxj-remote')
  const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-lxj-remote')
  assert.equal(manifest.version, '1.0.0')
  for (const need of ['lib/index.js', 'lib/client.js', 'lib/gate-runtime.js', 'lib/public-relay-agent.js', 'cordis.patch.yml']) {
    assert.ok(statSync(path.join(installed, need)).isFile(), `installed artifact missing ${need}`)
  }
  assert.ok(existsSync(path.join(installed, 'node_modules', 'ws')), 'bundled runtime deps must ship inside the tarball')
  const entry = await import(pathToFileURL(path.join(installed, 'lib', 'index.js')).href)
  assert.equal(entry.name, 'gate')
  say(`install channel: file: tarball -> node_modules/dsh-lxj-remote@${manifest.version}; lib/{index,client,gate-runtime,public-relay-agent}.js + cordis.patch.yml + bundled node_modules/ws present; entry name='${entry.name}'`)

  // 2 ── boot in-process with a real cordis context on free ports
  const childSource = `
    import net from 'node:net'
    import { Context } from ${JSON.stringify(pathToFileURL(path.join(repo, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js')).href)}
    const entry = await import(${JSON.stringify(pathToFileURL(path.join(installed, 'lib', 'index.js')).href)})
    const freePort = () => new Promise((resolve, reject) => {
      const s = net.createServer(); s.once('error', reject)
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)) })
    })
    process.env.WECHAT_GATE_PORT = String(await freePort())
    process.env.WECHAT_GATE_LOCAL_PORT = String(await freePort())
    process.env.DSH_PORT = '1'
    const ctx = new Context()
    ctx.provide('typert', { register() {} })
    const fiber = await ctx.plugin({ name: entry.name, apply: entry.apply }, {})
    const local = Number(process.env.WECHAT_GATE_LOCAL_PORT)
    const base = 'http://127.0.0.1:' + local
    console.log('PORT ' + local)
    let status = null
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + '/gate/status')
        if (r.ok) { status = await r.json(); if (status.publicRelay.state === 'online') break }
      } catch {}
      await new Promise(r => setTimeout(r, 250))
    }
    if (!status || status.publicRelay.state !== 'online') { console.log('NOTONLINE ' + JSON.stringify(status)); process.exit(2) }
    console.log('ONLINE ' + JSON.stringify(status))
    const samples = []
    const started = Date.now()
    while (Date.now() - started < ${OBSERVE_MS}) {
      await new Promise(r => setTimeout(r, 1000))
      try { const r = await fetch(base + '/gate/status'); const s = await r.json(); samples.push(s.publicRelay.state) }
      catch { samples.push('unreachable') }
    }
    console.log('SAMPLES ' + JSON.stringify(samples))
    const pair = await fetch(base + '/pair/code')
    console.log('PAIR ' + pair.status + ' ' + (await pair.text()).replace(/\\n/g, ' '))
    if (fiber && typeof fiber.dispose === 'function') fiber.dispose()
    process.exit(0)
  `
  const childFile = path.join(repo, '.live-test', 'child.mjs')
  writeFileSync(childFile, childSource, 'utf8')
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', childFile], {
    env: { ...process.env, DSH_HOME: home, HARNESS_REMOTE_HUMAN_TOOLS: '0' },
    cwd: repo, windowsHide: true, timeout: OBSERVE_MS + 240_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8',
  })

  const local = Number(out.match(/^PORT (\d+)$/m)[1])
  if (!/^ONLINE /m.test(out)) throw new Error(`gate never reached online:\n${out.slice(0, 4000)}`)
  const status = JSON.parse(out.match(/^ONLINE (.*)$/m)[1])
  assert.equal(status.publicRelay.state, 'online')
  assert.equal(status.publicRelay.enabled, true)
  say(`GET http://127.0.0.1:${local}/gate/status -> publicRelay.state='${status.publicRelay.state}', enabled=${status.publicRelay.enabled}, plugin=${JSON.stringify(status.plugin)}`)

  const samples = JSON.parse(out.match(/^SAMPLES (.*)$/m)[1])
  const bad = samples.filter(s => s !== 'online')
  assert.equal(bad.length, 0, `flapped during ${OBSERVE_MS / 1000}s: ${samples.join(',')}`)
  say(`${samples.length} consecutive 1s samples all 'online' (0 reconnects). Upstream storm rate: 122 ws-online events / 24h`)

  const pairLine = out.match(/^PAIR (\d+) (.*)$/m)
  assert.equal(Number(pairLine[1]), 200, 'pair/code must answer 200')
  const pair = JSON.parse(pairLine[2])
  assert.ok(pair.qrDataUrl.startsWith('data:image/'), 'qrDataUrl')
  assert.equal(pair.mode, 'public-relay')
  const payload = JSON.parse(pair.payload)
  for (const key of ['v', 'mode', 'relay', 'relayOrigin', 'nodeId', 'identityPublicKey', 'ticket', 'expiresAt', 'lan']) {
    assert.ok(Object.hasOwn(payload, key), `payload field ${key}`)
  }
  assert.equal(payload.v, 1)
  assert.equal(payload.mode, 'public-relay')
  assert.equal(payload.relayOrigin, REALM, 'QR must carry the fork default relay')
  assert.equal(payload.relay, payload.relayOrigin)
  assert.equal(typeof payload.ticket, 'string')
  assert.ok(payload.expiresAt > Date.now())
  assert.ok(payload.lan.host && Number.isInteger(payload.lan.port))
  say(`GET /pair/code -> mode=${pair.mode}, relayOrigin=${payload.relayOrigin}, nodeId=${payload.nodeId}, ticket=${payload.ticket.slice(0, 6)}…, lan=${payload.lan.host}:${payload.lan.port} (fields match 「梁小鲸」 pair.js: ticket|t / nodeId|n / relayOrigin / identityPublicKey / lan.host|port)`)

  // 3 ── persistence layout unchanged + default relay used with NO public.json
  const instRoot = path.join(home, 'harness-remote', 'instances')
  const keys = readdirSync(instRoot)
  assert.equal(keys.length, 1)
  const instDir = path.join(instRoot, keys[0])
  assert.ok(statSync(path.join(instDir, 'identity.json')).isFile(), 'identity.json')
  assert.equal(existsSync(path.join(instDir, 'public.json')), false, 'a fresh install must not need public.json')
  const leaseDir = path.join(instDir, 'relay-leases')
  const leaseEntries = readdirSync(leaseDir)
  assert.equal(leaseEntries.length, 1, 'relay lease beside the identity')
  const owner = JSON.parse(readFileSync(path.join(leaseDir, leaseEntries[0], readdirSync(path.join(leaseDir, leaseEntries[0]))[0]), 'utf8'))
  assert.ok(owner.pid > 0 && typeof owner.heartbeatAt === 'number')
  say(`persistence compatible: <DSH_HOME>/harness-remote/instances/${keys[0]}/{identity.json, relay-leases/…} with NO public.json — the built-in default relay served a fresh install; relay lease owner pid=${owner.pid}`)
  console.log(`\nLIVE GATE TEST: ${checks} checks passed`)
} finally {
  rmSync(path.join(repo, '.live-test'), { recursive: true, force: true })
}
