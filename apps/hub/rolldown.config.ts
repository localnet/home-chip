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

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "..", "..");
const packages = join(workspace, "packages");
const outDir = join(here, "dist");

const readManifest = async (path: string): Promise<Manifest> =>
    JSON.parse(await readFile(join(path, "package.json"), "utf8")) as Manifest;

const ours = (id: string): boolean => id.startsWith(WORKSPACE_SCOPE);

/**
 * What the bundle imports at run time: every dependency of our own packages that is not one of
 * our own packages. Read rather than restated, so a package that gains a dependency cannot leave
 * the deployed manifest short of it — a mismatch that would only surface on the target host.
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
 */
function deployable(): Plugin {
    return {
        name: "home-chip-deployable",
        async generateBundle() {
            const hub = await readManifest(here);

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
                        dependencies: await runtimeDependencies(hub),
                    },
                    null,
                    2,
                )}\n`,
            });
        },
    };
}

export default defineConfig({
    input: join(here, "src", "main.ts"),
    platform: "node",
    plugins: [deployable()],
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
            groups: [{ name: "sdk-config", test: /packages\/matter\/src\/sdk-config\.ts$/ }],
        },
    },
});
