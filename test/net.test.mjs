import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandCidr, mapLimit, tcpProbe, detectLocalCidrs, selectScanCidrs } from '../dist/discovery/net.js'

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
  // Regression: APIPA / virtual / oversized segments must never be auto-swept.
  for (const cidr of cidrs) {
    assert.ok(!cidr.startsWith('169.254.'), `link-local leaked: ${cidr}`)
    assert.ok(Number(cidr.split('/')[1]) >= 23, `too wide for auto sweep: ${cidr}`)
  }
})

const iface = (address, prefix, extra = {}) => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal: false,
  cidr: `${address}/${prefix}`,
  ...extra,
})

test('selectScanCidrs skips link-local, loopback and virtual adapters', () => {
  const cidrs = selectScanCidrs({
    以太网: [iface('192.168.5.37', 24)],
    '本地连接': [iface('169.254.232.249', 16)],
    'vEthernet (Default Switch)': [iface('172.29.128.1', 20)],
    'WSL (Hyper-V firewall)': [iface('172.29.176.1', 20)],
    'Loopback Pseudo-Interface 1': [iface('127.0.0.1', 8, { internal: true })],
    '蓝牙网络连接': [iface('169.254.57.91', 16)],
  })
  assert.deepEqual(cidrs, ['192.168.5.0/24'])
})

test('selectScanCidrs narrows an oversized LAN to its /24 but keeps /23+', () => {
  const cidrs = selectScanCidrs({
    eth0: [iface('10.1.2.3', 16)],
    eth1: [iface('192.168.6.9', 23)],
  })
  assert.deepEqual(cidrs.sort(), ['10.1.2.0/24', '192.168.6.0/23'])
})

test('scan deadline bounds a hopeless sweep', async () => {
  const { LanRegistry } = await import('../dist/discovery/registry.js')
  const registry = new LanRegistry({
    cidrsOnly: ['192.0.2.0/24'], // TEST-NET-1: nothing answers
    ports: [9],
    tcpTimeoutMs: 2000,
    concurrency: 64,
    scanDeadlineMs: 1000,
  })
  const started = Date.now()
  const records = await registry.scan()
  const took = Date.now() - started
  assert.deepEqual(records, [])
  assert.equal(registry.scanMeta.targets, 254)
  assert.ok(took < 5000, `scan took ${took}ms, deadline not enforced`)
})

