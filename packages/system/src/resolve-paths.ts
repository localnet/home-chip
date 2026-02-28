import { join } from "node:path";
import type { Paths } from "@home-chip/contract";

export function resolvePaths(env: NodeJS.ProcessEnv, cwd: string): Paths {
    const base = join(cwd, ".home-chip");

    return {
        configFile: env.HOMECHIP_CONFIG_FILE || join(base, "config.json"),
        storagePath: env.HOMECHIP_STORAGE_PATH || join(base, "storage"),
        logPath: env.HOMECHIP_LOG_PATH || join(base, "log"),
    };
}
