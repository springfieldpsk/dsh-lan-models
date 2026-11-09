import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client', 'client.js'), 'utf8')

function loadClient() {
  let loaded = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          loaded = entry
        },
      },
    },
    console,
    document: { documentElement: { lang: 'zh-CN' } },
    navigator: { language: 'zh-CN' },
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(loaded, 'the bundle must call window.__ModuleLoader__.load')
  assert.equal(loaded.id, 'dsh-lan-models')
  return loaded
}

test('client bundle loads and declares the plugin exports', () => {
  const entry = loadClient()
  const fakeReact = { createElement() {}, useState() {}, useEffect() {}, useCallback() {} }
  const mod = entry.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require: ${name}`)
  })
  assert.equal(typeof mod.apply, 'function')
  assert.equal(Array.from(mod.inject).length, 0)
})

test('client registers one settings section page', () => {
  const entry = loadClient()
  const fakeReact = { createElement() {}, useState() {}, useEffect() {}, useCallback() {} }
  const mod = entry.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require: ${name}`)
  })

  const registered = []
  let generator = null
  const slots = {
    inject(name, factory) {
      assert.equal(name, 'settings.section')
      generator = factory()
      const step = generator.next()
      // The generator yields the register() result; collecting it is enough.
      registered.push(step.value)
    },
    register(options, component) {
      registered.push({ options, component })
      return () => {}
    },
  }
  const ctx = {
    inject(names, run) {
      assert.equal(Array.from(names).join(','), 'slots')
      run({ slots })
    },
  }
  mod.apply(ctx)
  const opts = registered.find((r) => r && r.options)
  assert.ok(opts, 'settings.section must be registered')
  assert.equal(opts.options.name, 'settings.section')
  assert.equal(opts.options.id, 'lan-models')
  assert.equal(typeof opts.component, 'function')
})
