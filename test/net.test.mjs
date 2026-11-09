import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandCidr, mapLimit, tcpProbe, detectLocalCidrs } from '../dist/discovery/net.js'

test('expandCidr /24 skips network+broadcast', () => {
  const hosts = expandCidr('192.168.5.0/24')
  assert.equal(hosts.length, 254)
  assert.equal(hosts[0], '192.168.5.1')
  assert.equal(hosts.at(-1), '192.168.5.254')
})

test('expandCidr /32 single host', () => {
  assert.deepEqual(expandCidr('10.0.0.7/32'), ['10.0.0.7'])
})

test('expandCidr /31 both hosts', () => {
  assert.deepEqual(expandCidr('10.0.0.0/31'), ['10.0.0.0', '10.0.0.1'])
})

test('expandCidr rejects too-wide or invalid', () => {
  assert.throws(() => expandCidr('10.0.0.0/8'))
  assert.throws(() => expandCidr('not-a-cidr'))
  assert.throws(() => expandCidr('10.0.0.0/33'))
})

test('mapLimit preserves order and bounds concurrency', async () => {
  let running = 0
  let peak = 0
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    running++
    peak = Math.max(peak, running)
    await new Promise((r) => setTimeout(r, 10))
    running--
    return n * 10
  })
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70, 80])
  assert.ok(peak <= 3)
})

test('tcpProbe finds an open port and rejects a closed one', async () => {
  const server = (await import('node:http')).createServer((_q, res) => res.end())
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  assert.equal(await tcpProbe('127.0.0.1', port, 500), true)
  assert.equal(await tcpProbe('127.0.0.1', 1, 200), false) // port 1 nothing listens
  await new Promise((r) => server.close(r))
})

test('detectLocalCidrs returns loopback or lan cidrs', () => {
  const cidrs = detectLocalCidrs()
  assert.ok(Array.isArray(cidrs))
})
