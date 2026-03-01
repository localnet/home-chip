import * as v from "valibot";
import { ValidationError } from "../errors/validation.ts";

const LogLevelSchema = v.picklist(["fatal", "error", "warn", "notice", "info", "debug"]);

const LoggingSchema = v.strictObject({
    level: v.optional(LogLevelSchema, "info"),
    maxSize: v.optional(v.string(), "10M"),
    maxFiles: v.optional(v.number(), 5),
});

const MatterSchema = v.strictObject({
    networkInterface: v.optional(v.nullable(v.string()), null),
});

const ServerSchema = v.strictObject({
    host: v.optional(v.string(), "0.0.0.0"),
    port: v.optional(v.number(), 8080),
});

const ConfigSchema = v.strictObject({
    logging: v.optional(LoggingSchema, {}),
    matter: v.optional(MatterSchema, {}),
    server: v.optional(ServerSchema, {}),
});

export type Config = v.InferOutput<typeof ConfigSchema>;

export function validateConfig(data: unknown): Config {
    try {
        return v.parse(ConfigSchema, data);
    } catch (error) {
        if (error instanceof v.ValiError) {
            throw new ValidationError(formatIssue(error.issues[0]));
        }
        throw error;
    }
}

function formatIssue(issue: v.InferIssue<typeof ConfigSchema>) {
    const path = v.getDotPath(issue);

    if (path == null) {
        return issue.message;
    }

    return `${issue.message} in ${path}`;
}
