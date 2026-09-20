import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "rolldown";

interface Manifest {
    readonly name: string;
    readonly version?: string;
    readonly description?: string;
    readonly license?: string;
    readonly author?: string;
    readonly repository?: unknown;
    readonly engines?: Record<string, string>;
    readonly dependencies?: Record<string, string>;
}

/** Our own packages, which have no published form and so are compiled into the bundle. */
const WORKSPACE_SCOPE = "@home-chip/";

/**
 * The SDK isolation module, which the output must keep as a chunk of its own (see `codeSplitting`
 * below). Named once so the split and the check on it cannot disagree about which module it is.
 */
const SDK_CONFIG_MODULE = /packages\/matter\/src\/sdk-config\.ts$/;

/** The name the split gives that chunk, and so the stem of its file. */
const SDK_CONFIG_CHUNK = "sdk-config";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "..", "..");
const packages = join(workspace, "packages");
const outDir = join(here, "dist");

const readManifest = async (path: string): Promise<Manifest> =>
    JSON.parse(await readFile(join(path, "package.json"), "utf8")) as Manifest;

const ours = (id: string): boolean => id.startsWith(WORKSPACE_SCOPE);

/**
 * What the bundle imports at run time: every dependency of the packages the hub depends on that
 * is not one of our own packages. Read rather than restated, so a package that gains a dependency
 * cannot leave the deployed manifest short of it. Only the hub's direct dependencies are read,
 * which today is every package; one reached only through another would be missed, and the e2e
 * run against the installed package is what would say so.
 */
async function runtimeDependencies(hub: Manifest): Promise<Record<string, string>> {
    const collected: Record<string, string> = {};

    for (const name of Object.keys(hub.dependencies ?? {}).filter(ours)) {
        const manifest = await readManifest(join(packages, name.slice(WORKSPACE_SCOPE.length)));
        for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
            if (ours(dependency)) {
                continue;
            }
            const seen = collected[dependency];
            if (seen !== undefined && seen !== range) {
                throw new Error(`${dependency} is required as ${seen} and as ${range}; reconcile them first`);
            }
            collected[dependency] = range;
        }
    }
    return Object.fromEntries(Object.entries(collected).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Adds what turns the bundle into a package: the manifest that declares it and the licence that
 * covers it. Emitted as part of the output rather than written alongside it, so rolldown places
 * and reports them as it does the chunks.
 *
 * The manifest is the hub's own, minus what only makes sense inside the workspace. It carries no
 * `private` flag, which would refuse the publish this bundle exists for, and no `main`, which
 * names an entry for importers a final application does not have. What it names instead is a
 * `bin`: the thing to run, reachable by name once installed, rather than a path into the package
 * that whoever writes the service unit would have to know.
 *
 * Its `files` are what the build emitted, read off the bundle rather than listed by hand, so a new
 * chunk is packed without anyone adding it and nothing else left in the output directory rides
 * along: a tarball packed into it, packed again, would otherwise travel inside the next one. npm
 * adds the manifest and the licence on its own.
 */
function deployable(): Plugin {
    return {
        name: "home-chip-deployable",
        async generateBundle(_options, bundle) {
            const hub = await readManifest(here);
            // Taken before the two emits below, which npm packs whatever `files` says.
            const files = Object.keys(bundle).sort();

            // The licence travels with what it licenses. npm picks one up on its own, but only from
            // the package root, and the root here is the output directory, not the repository's.
            this.emitFile({
                type: "asset",
                fileName: "LICENSE",
                source: await readFile(join(workspace, "LICENSE"), "utf8"),
            });

            this.emitFile({
                type: "asset",
                fileName: "package.json",
                source: `${JSON.stringify(
                    {
                        name: hub.name,
                        version: hub.version,
                        description: hub.description,
                        author: hub.author,
                        license: hub.license,
                        repository: hub.repository,
                        type: "module",
                        engines: hub.engines,
                        bin: { "home-chip": "main.js" },
                        files,
                        dependencies: await runtimeDependencies(hub),
                    },
                    null,
                    2,
                )}\n`,
            });
        },
    };
}

/**
 * Fails the build unless the SDK isolation came out as `codeSplitting` promises: a chunk holding
 * that module alone.
 *
 * The split fails silently. A regex that no longer matches — the module renamed or moved — leaves
 * no group to fill, and rolldown builds the isolation into main.js without a warning; the hub then
 * dies at boot with the SDK refusing the assignments. A module that gained an import of our own
 * would pull it into the chunk ahead of the assignments, with the same result. The e2e catches
 * both, but only where the hub can start, which needs IPv6, and as a hub that would not boot.
 * Checked here, on every build, each fails the build and names its cause.
 *
 * That the entry imports the chunk first is not checked: rolldown places a chunk's import ahead of
 * everything else on its own, no source change was found to move it, and a hub whose isolation ran
 * late would fail the e2e at boot.
 */
function verifySdkIsolation(): Plugin {
    return {
        name: "home-chip-verify-sdk-isolation",
        generateBundle(_options, bundle) {
            const chunks = Object.values(bundle).filter((output) => output.type === "chunk");
            const isolation = chunks.find((chunk) => chunk.name === SDK_CONFIG_CHUNK);
            if (isolation === undefined) {
                this.error(
                    `no ${SDK_CONFIG_CHUNK} chunk was emitted: ${SDK_CONFIG_MODULE} matched no module, so the SDK isolation was bundled into main.js, where it runs too late. Point it at the isolation module.`,
                );
            }
            const [only, ...others] = isolation.moduleIds;
            if (only === undefined || !SDK_CONFIG_MODULE.test(only) || others.length > 0) {
                this.error(
                    `the ${SDK_CONFIG_CHUNK} chunk must hold the isolation module alone, and holds: ${isolation.moduleIds.join(", ")}`,
                );
            }
        },
    };
}

export default defineConfig({
    input: join(here, "src", "main.ts"),
    platform: "node",
    plugins: [deployable(), verifySdkIsolation()],
    // Ours is compiled in; everything published stays a plain import, resolved from the manifest
    // the plugin writes. Stated as what to keep rather than what to leave out, so a new
    // third-party dependency is external without anyone remembering to say so.
    external: (id) => !(ours(id) || id.startsWith(".") || id.startsWith("/")),
    output: {
        format: "esm",
        dir: outDir,
        cleanDir: true,
        entryFileNames: "main.js",
        chunkFileNames: "[name].js",
        // Makes the entry the executable the manifest's `bin` promises: without it the system
        // runs the first word of the file as a command. Rolldown does not derive it from a `bin`
        // field, and npm does not add one when it links the command. The other chunk is imported
        // rather than run, and saying otherwise there would only mislead whoever reads it.
        banner: (chunk) => (chunk.isEntry ? "#!/usr/bin/env node" : ""),
        // Rolldown drops ordinary comments already; this drops the JSDoc too, which is half the
        // output and is written for whoever reads the source, not for a deployed artifact. What
        // survives is what a stack trace needs: the names, the line breaks, and the region
        // markers naming the file each stretch of the bundle came from.
        comments: false,
        sourcemap: true,
        // The SDK isolation has to stay a module of its own. Bundled in with everything else its
        // assignments land in the body, and a body runs after every import of its module has been
        // evaluated — including the SDK it is meant to configure, which then refuses them. As a
        // separate chunk the ordering ESM already gave us is restored: main.js imports it first,
        // and an imported module is evaluated before the import that follows.
        codeSplitting: {
            groups: [{ name: SDK_CONFIG_CHUNK, test: SDK_CONFIG_MODULE }],
        },
    },
});
