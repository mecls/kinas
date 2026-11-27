// `npx convex codegen` needs a deployment, and there is none until the captain makes the dev one (build spec §12 7.3).
// Until then the generated files are written by Convex's own templates, here, from the module list. The first
// `npx convex dev` on the dev deployment rewrites them; commit what it writes.
//
//   bun cloud/scripts/codegen-offline.ts
import { readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { apiCodegen } from "../node_modules/convex/dist/esm/cli/codegen_templates/api.js";
import { serverCodegen } from "../node_modules/convex/dist/esm/cli/codegen_templates/server.js";

// dataModel.js imports Convex's component lib (and with it the CLI's own packages) for a function this doesn't use, so its
// imports are cut and its common.js is named by path; the text it makes for a TypeScript schema is unchanged.
const templates = join(dirname(createRequire(import.meta.url).resolve("convex/package.json")), "dist/esm/cli/codegen_templates");
const patched = readFileSync(join(templates, "dataModel.js"), "utf8")
  .replace(/import \{\s*toComponentDefinitionPath\s*\} from "[^"]+";/, "")
  .replace('import { compareStrings, header } from "./common.js";', `import { header } from "${pathToFileURL(join(templates, "common.js")).href}";`)
  .replace(/import \{ validatorToType \} from "[^"]+";/, "");
const scratch = mkdtempSync(join(tmpdir(), "kinas-codegen-"));
writeFileSync(join(scratch, "dataModel.mjs"), patched);
const { dynamicDataModelTS } = await import(pathToFileURL(join(scratch, "dataModel.mjs")).href);

const convex = join(dirname(fileURLToPath(import.meta.url)), "..", "convex");
const out = join(convex, "_generated");

// Every module that defines functions: a .ts file in convex/ or convex/lib/, never a test or the schema or _generated.
const modules: string[] = [];
const walk = (dir: string, prefix: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith("_") || e.name === "schema.ts") continue;
    if (e.isDirectory()) walk(join(dir, e.name), `${prefix}${e.name}/`);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) modules.push(`${prefix}${e.name.slice(0, -3)}`);
  }
};
walk(convex, "");
modules.sort();

writeFileSync(join(out, "api.ts"), apiCodegen(modules, { useTypeScript: true }).TS);
writeFileSync(join(out, "server.ts"), serverCodegen({ useTypeScript: true }).TS);
writeFileSync(join(out, "dataModel.ts"), dynamicDataModelTS());
console.log(`wrote _generated for ${modules.length} modules`);
