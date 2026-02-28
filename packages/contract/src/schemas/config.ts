import * as v from "valibot";

const LogLevelSchema = v.picklist(["fatal", "error", "warn", "notice", "info", "debug"]);

const LoggingSchema = v.object({
    level: v.optional(LogLevelSchema, "info"),
    maxSize: v.optional(v.string(), "10M"),
    maxFiles: v.optional(v.number(), 5),
});

const MatterSchema = v.object({
    networkInterface: v.optional(v.nullable(v.string()), null),
});

const ServerSchema = v.object({
    host: v.optional(v.string(), "0.0.0.0"),
    port: v.optional(v.number(), 8080),
});

export const ConfigSchema = v.object({
    logging: v.optional(LoggingSchema, {}),
    matter: v.optional(MatterSchema, {}),
    server: v.optional(ServerSchema, {}),
});

export type Config = v.InferOutput<typeof ConfigSchema>;
