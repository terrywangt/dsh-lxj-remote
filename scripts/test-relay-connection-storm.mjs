/**
 * Fork regression: relay connection-storm controls.
 *
 * Upstream symptom (relay log, 24h): 122 `ws online` for one nodeId in the
 * pattern enroll → online → (10–60s) offline → enroll, with bursts of three
 * enrollments in three seconds. Root causes proven here:
 *   1. ensurePairingTicket(refresh) enrolls a second time while a socket is
 *      live and then connect()s a second socket for the same identity.
 *   2. reconnect backoff started at ~1s and reset on every `open`, so a socket
 *      evicted seconds later restarted the ladder instead of damping it.
 *   3. Two holders of one identity file (two installed plugin copies / two
 *      hosts sharing ~/.dsh) evict each other forever.
 */
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'

import { PublicRelayAgent, RelayTransportLease } from '../lib/public-relay-agent.js'

const root = mkdtempSync(path.join(tmpdir(), 'lxj-relay-storm-'))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (predicate()) return; await wait(10) }
  throw new Error(message)
}
/** Same as until() but reports how long the predicate took to become true. */
async function untilReturn(predicate, message, timeout = 15_000) {
  const started = Date.now()
  const deadline = started + timeout
  while (Date.now() < deadline) { if (predicate()) return Date.now() - started; await wait(10) }
  throw new Error(message)
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return server.address().port
}

/** A relay that behaves like the self-hosted one: one agent slot per nodeId. */
function makeRelay() {
  let enrollments = 0, online = 0, offline = 0
  const byNode = new Map()
  const server = createHttpServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/agents/enroll') {
      enrollments++
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ticket: `t${enrollments}`, expiresAt: Date.now() + 600_000 }))
      })
      return
    }
    res.writeHead(404); res.end()
  })
  const wss = new WebSocketServer({ server })
  wss.on('connection', (socket, request) => {
    const nodeId = new URL(request.url, 'http://x').searchParams.get('nodeId')
    const previous = byNode.get(nodeId)
    if (previous && previous !== socket) { previous.evicted = true; previous.close(4009, 'duplicate agent') }
    byNode.set(nodeId, socket)
    online++
    socket.on('close', () => { if (byNode.get(nodeId) === socket) { byNode.delete(nodeId); offline++ } })
    socket.send(JSON.stringify({ type: 'relay.ready', protocol: 1 }))
  })
  return {
    server, wss,
    counters: () => ({ enrollments, online, offline }),
    async close() {
      for (const socket of wss.clients) socket.terminate()
      await Promise.all([new Promise(r => wss.close(r)), new Promise(r => server.close(r))])
    },
  }
}

function agentFor(relayPort, identityPath, extra = {}) {
  return new PublicRelayAgent({ enabled: true, relayOrigin: `http://127.0.0.1:${relayPort}` }, {
    agentVersion: 'synthetic-local-only', identityPath,
    transportTiming: { pingIntervalMs: 200, pongTimeoutMs: 600, handshakeTimeoutMs: 500, connectSettleMs: 50 },
    onFrame() {}, ...extra,
  })
}

try {
  const relay = await (async () => { const r = makeRelay(); r.port = await listen(r.server); return r })()
  try {
    // ── 1. Pairing refresh must not open a second socket for one identity ──
    const identityPath = path.join(root, 'identity-single.json')
    const agent = agentFor(relay.port, identityPath)
    await agent.start()
    await until(() => relay.counters().online === 1, 'agent did not come online')
    const enrollAfterStart = relay.counters().enrollments
    // Upstream: the settings page polls the pairing surface, each call enrolls
    // and may connect() a second socket, and the evicted socket's close handler
    // schedules a third. Simulate three refreshes on a live transport.
    await Promise.all([
      agent.ensurePairingTicket(60_000, { refresh: true }),
      agent.ensurePairingTicket(60_000, { refresh: true }),
      agent.ensurePairingTicket(60_000, { refresh: true }),
    ])
    await wait(400)
    const after = relay.counters()
    assert.equal(after.online, 1, `pairing refresh opened extra sockets (online=${after.online})`)
    assert.equal(after.offline, 0, `pairing refresh evicted the live socket (offline=${after.offline})`)
    // Three concurrent explicit refreshes coalesce into ONE enrollment POST:
    // the pairing surface still gets a fresh single-use ticket, but no longer
    // multiplies enrollments (and therefore sockets) per page interaction.
    assert.equal(after.enrollments - enrollAfterStart, 1,
      `${after.enrollments - enrollAfterStart} concurrent pairing refreshes must coalesce into 1 enrollment`)
    assert.equal(agent.snapshot().state, 'online', 'pairing refresh must not drop the live transport')
    assert.equal(after.enrollments, 2, 'a background reconnect must not re-enroll while a ticket is still valid')
    console.log(`PASS concurrent pairing refreshes keep exactly one socket (online=${after.online}, offline=${after.offline})`)
    agent.stop()
    await relay.close()
  } catch (error) { await relay.close().catch(() => {}); throw error }

  // ── 2. Reconnect backoff must start above the eviction window ──
  {
    const flaky = makeRelay()
    flaky.port = await listen(flaky.server)
    try {
      const identityPath = path.join(root, 'identity-flap.json')
      const agent = agentFor(flaky.port, identityPath)
      await agent.start()
      await until(() => flaky.counters().online >= 1, 'flap fixture did not connect')
      // Force a transport loss and watch the retry cadence.
      for (const socket of flaky.wss.clients) socket.terminate()
      const firstRetryMs = await untilReturn(() => flaky.counters().online >= 2, 'no retry after eviction')
      assert(firstRetryMs >= 1000, `retry fired in ${firstRetryMs}ms — too fast, upstream started at ~1s and flapped`)
      console.log(`PASS reconnect first retry waited ${firstRetryMs}ms (floor is 5s in production timings)`)
      agent.stop()
    } finally { await flaky.close() }
  }

  // ── 3. Cross-process lease: a second holder must not enroll at all ──
  {
    const shared = makeRelay()
    shared.port = await listen(shared.server)
    try {
      const dir = path.join(root, 'lease-case'); mkdirSync(dir, { recursive: true })
      const leaseDir = path.join(root, 'leases')
      const first = new PublicRelayAgent({ enabled: true, relayOrigin: `http://127.0.0.1:${shared.port}` }, {
        agentVersion: 'synthetic', identityPath: path.join(dir, 'identity.json'),
        transportTiming: { pingIntervalMs: 200, pongTimeoutMs: 600 },
        lease: { enabled: true, directory: leaseDir }, onFrame() {},
      })
      const nodeId = first.identity.nodeId
      await first.start()
      await until(() => shared.counters().online === 1, 'leased agent did not connect')
      const enrollMid = shared.counters().enrollments

      // A second holder of the same identity (second installed plugin copy,
      // or a CLI host sharing the profile) must never touch the relay.
      const second = new PublicRelayAgent({ enabled: true, relayOrigin: `http://127.0.0.1:${shared.port}` }, {
        agentVersion: 'synthetic', identityPath: path.join(dir, 'identity.json'),
        transportTiming: { pingIntervalMs: 200, pongTimeoutMs: 600 },
        lease: { enabled: true, directory: leaseDir }, onFrame() {},
      })
      await second.start()
      await wait(700)
      assert.equal(shared.counters().enrollments, enrollMid, 'yielding process must not enroll')
      assert.equal(shared.counters().online, 1, 'exactly one socket per nodeId')
      assert.match(second.snapshot().lastError || '', /另一|租约/, 'yielding process explains itself')

      // Low-level lease semantics.
      const holder = new RelayTransportLease(nodeId, dir, { leaseDir, pid: process.pid + 1_000_000 })
      const foreign = new RelayTransportLease(nodeId, dir, { leaseDir, pid: 2_000_000_001 })
      assert.equal(holder.renew(), false, 'a non-holder cannot renew the live lease')
      assert.equal(foreign.acquire(), false, 'live-but-foreign holder is not stolen')
      second.stop()
      first.stop()
      assert.equal(foreign.acquire(), true, 'lease must be recoverable after the holder stops')
      foreign.release()
      console.log('PASS second process sharing one node identity yields instead of evicting')
    } finally { await shared.close() }
  }
  console.log('relay connection-storm regression: all checks passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
