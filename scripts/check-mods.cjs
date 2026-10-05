// Validates every Mod in mods/ (or the folders given) without starting the app; used by the Mod PR workflow.
// Usage: node scripts/check-mods.cjs [mods/<id> ...]
const fs = require('node:fs');
const path = require('node:path');
const mods = require('../mods.cjs');
const root = process.env.MODS_ROOT || path.join(__dirname, '..', 'mods');
const only = new Set(process.argv.slice(2).map(arg => path.basename(path.resolve(arg))));
const ALLOWED = /\.(json|png|webp|vrm|md|txt)$/i;
const MAX_FOLDER = 60 * 1024 * 1024;
const problems = [];
for (const id of fs.readdirSync(root)) {
  if (only.size && !only.has(id)) continue;
  const dir = path.join(root, id);
  if (!fs.statSync(dir).isDirectory()) continue;
  // The loader checks each declared asset; this also rejects files a Mod ships but never declares.
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const stat = fs.lstatSync(path.join(dir, name));
    if (!stat.isFile()) problems.push(`${id}: ${name} is not a plain file`);
    else if (!ALLOWED.test(name)) problems.push(`${id}: ${name} has a file type Mods may not ship`);
    total += stat.size;
  }
  if (total > MAX_FOLDER) problems.push(`${id}: folder is ${(total / 1048576).toFixed(1)} MB; the limit is 60 MB`);
}
const errors = [];
let catalog = [];
try { catalog = mods.loadCatalog(root, { onError: (id, error) => errors.push(`${id}: ${error.message}`) }); } catch (error) { if (!errors.length) problems.push(error.message); }
for (const error of errors) if (!only.size || only.has(error.split(':')[0])) problems.push(error);
// Bundled Mods ship to everyone who clones the repository: open licence and a named author or source, or the Mod fails.
const failed = new Set();
for (const mod of catalog) if (!only.size || only.has(mod.id)) for (const problem of mods.bundledLicenceProblems(mod)) { problems.push(`${mod.id}: ${problem}`); failed.add(mod.id); }
for (const mod of catalog) if ((!only.size || only.has(mod.id)) && !failed.has(mod.id)) console.log(`ok    ${mod.id} (${mod.renderer || 'builtin'}, ${mod.skins.length} skin${mod.skins.length === 1 ? '' : 's'}, ${mod.personas.length} persona${mod.personas.length === 1 ? '' : 's'})`);
for (const problem of problems) console.log(`FAIL  ${problem}`);
const missing = [...only].filter(id => !fs.existsSync(path.join(root, id)));
for (const id of missing) console.log(`gone  ${id} (removed in this change)`);
process.exit(problems.length ? 1 : 0);
