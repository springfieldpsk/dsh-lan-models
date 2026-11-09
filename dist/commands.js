/** `/lan` slash command: one-shot LAN dashboard without an agent round-trip. */
import { formatScan } from './format.js';
export function registerCommands(commands, config, registry) {
    if (!commands)
        return;
    commands.register({
        name: 'lan',
        description: '扫描局域网模型服务并显示总览（输入 refresh 强制重扫）',
        input: { hint: 'refresh（可选）' },
        handler: async ({ rawInput }) => {
            const refresh = /refresh|重扫|强制/i.test(rawInput);
            try {
                const services = await registry.scan({ refresh });
                return { kind: 'success', text: formatScan(services) };
            }
            catch (err) {
                return { kind: 'error', text: err instanceof Error ? err.message : String(err) };
            }
        },
    });
}
