/** The `lan-models` skill: how to use the LAN model mesh and how to write image/video prompts. */
import type { Config } from './config.js';
interface SkillsService {
    register(reg: {
        name: string;
        description: string;
        whenToUse?: string;
        content: string;
    }): () => void;
}
export declare function registerSkills(skills: SkillsService | undefined, config: Config): void;
export {};
