import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listMounted,
  mountProvider,
  normalizeBaseUrl,
  providerIdFor,
  unmountProvider,
} from '../dist/panel/mount.js'

test('providerIdFor is a stable lan- key', () => {
  assert.equal(providerIdFor('http://192.168.5.115:8000'), 'lan-192-168-5-115-8000')
  assert.equal(providerIdFor('http://[::1]:8080'), 'lan-1-8080')
  assert.equal(providerIdFor('https://box.lan/v1'), 'lan-box-lan-443')
})

test('normalizeBaseUrl adds /v1 only to a bare origin', () => {
  assert.equal(normalizeBaseUrl('http://192.168.5.115:8000'), 'http://192.168.5.115:8000/v1')
  assert.equal(normalizeBaseUrl('http://192.168.5.115:8000/'), 'http://192.168.5.115:8000/v1')
  assert.equal(normalizeBaseUrl('http://192.168.5.115:8000/v1/'), 'http://192.168.5.115:8000/v1')
  assert.equal(normalizeBaseUrl('http://box:11434/v1/'), 'http://box:11434/v1')
  assert.throws(() => normalizeBaseUrl('ftp://box'), /只支持/)
})

function fakeCtx() {
  const entry = {
    id: 'llm-pi-ai',
    options: {
      name: '@deepseek-ai/dsh-llm-pi-ai',
      config: { providers: { deepseek: { displayName: 'DeepSeek', apiKeyEnv: 'DEEPSEEK_API_KEY' } } },
    },
  }
  let current = entry.options.config
  const editor = {
    entries: () => [entry],
    configuration: () => [{ entry, inherited: current, override: {} }],
    edit: async (_entry, change) => {
      current = change(current, current)
      entry.options.config = current
    },
  }
  return { configEditor: editor }
}

test('mount writes an openai-completions route and keeps other providers', async () => {
  const ctx = fakeCtx()
  const mounted = await mountProvider(ctx, {
    providerId: 'lan-192-168-5-115-8000',
    displayName: 'Mac oMLX',
    baseURL: 'http://192.168.5.115:8000',
    models: [{ id: 'qwen3.8-27b', name: 'Qwen3.8 27B' }],
  })
  assert.equal(mounted.baseURL, 'http://192.168.5.115:8000/v1')
  const providers = ctx.configEditor.entries()[0].options.config.providers
  assert.equal(providers.deepseek.displayName, 'DeepSeek')
  assert.deepEqual(providers['lan-192-168-5-115-8000'].models, [{ id: 'qwen3.8-27b', name: 'Qwen3.8 27B' }])
  assert.equal(providers['lan-192-168-5-115-8000'].api, 'openai-completions')
  assert.deepEqual(
    listMounted(ctx).map((m) => m.providerId),
    ['lan-192-168-5-115-8000'],
  )
})

test('unmount removes only this plugin route', async () => {
  const ctx = fakeCtx()
  await mountProvider(ctx, {
    providerId: 'lan-box-8000',
    displayName: 'box',
    baseURL: 'http://box:8000',
    models: [{ id: 'm1' }],
  })
  await unmountProvider(ctx, 'lan-box-8000')
  const providers = ctx.configEditor.entries()[0].options.config.providers
  assert.deepEqual(Object.keys(providers), ['deepseek'])
  await assert.rejects(() => unmountProvider(ctx, 'deepseek'), /只能卸载/)
})

test('mount refuses non-lan ids and empty model lists', async () => {
  const ctx = fakeCtx()
  await assert.rejects(
    () => mountProvider(ctx, { providerId: 'deepseek', displayName: 'x', baseURL: 'http://box:8000', models: [{ id: 'm' }] }),
    /非法 provider id/,
  )
  await assert.rejects(
    () => mountProvider(ctx, { providerId: 'lan-x', displayName: 'x', baseURL: 'http://box:8000', models: [] }),
    /没有可装载的模型/,
  )
})
