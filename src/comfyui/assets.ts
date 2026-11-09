/** Download generation outputs into a per-run directory. */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ComfyClient, ComfyHistoryEntry } from './client.js'

export interface SavedOutput {
  dir: string
  files: { path: string; bytes: number }[]
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export async function saveOutputs(client: ComfyClient, entry: ComfyHistoryEntry, outRoot: string, tag = 'run'): Promise<SavedOutput> {
  const refs = client.collectFiles(entry)
  if (!refs.length) throw new Error('prompt finished but produced no output files')
  const dir = path.join(outRoot, `${timestamp()}-${tag.replace(/[^\w.-]+/g, '_')}`)
  await fs.mkdir(dir, { recursive: true })
  const files: { path: string; bytes: number }[] = []
  for (const ref of refs) {
    const { buffer } = await client.download(ref)
    const dest = path.join(dir, ref.subfolder ? path.join(ref.subfolder, ref.filename) : ref.filename)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, Buffer.from(buffer))
    files.push({ path: dest, bytes: buffer.byteLength })
  }
  return { dir, files }
}
