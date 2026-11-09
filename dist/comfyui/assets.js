/** Download generation outputs into a per-run directory. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
export async function saveOutputs(client, entry, outRoot, tag = 'run') {
    const refs = client.collectFiles(entry);
    if (!refs.length)
        throw new Error('prompt finished but produced no output files');
    const dir = path.join(outRoot, `${timestamp()}-${tag.replace(/[^\w.-]+/g, '_')}`);
    await fs.mkdir(dir, { recursive: true });
    const files = [];
    for (const ref of refs) {
        const { buffer } = await client.download(ref);
        const dest = path.join(dir, ref.subfolder ? path.join(ref.subfolder, ref.filename) : ref.filename);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, Buffer.from(buffer));
        files.push({ path: dest, bytes: buffer.byteLength });
    }
    return { dir, files };
}
