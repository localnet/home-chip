import { type Config, validateConfig } from "@home-chip/contract";

export function parseConfig(content: string, filePath: string): Config {
    try {
        return validateConfig(JSON.parse(content));
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Config error in ${filePath}: ${error.message}`);
        }
        throw error;
    }
}
