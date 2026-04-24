// Post-build ESM extension patcher
// Adds .js to bare relative imports in compiled dist/.js files
// Skips: package imports, already-extensions, barrel directory paths (→ index.js)

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, relative, extname, dirname } from 'path';

const distDir = join(process.cwd(), 'dist');
const HAS_EXT_RE = /\.(js|ts|tsx|mjs|cjs|d\.ts)$/;

function patchFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return 0;
    throw e;
  }
  const fileDir = dirname(filePath);
  let count = 0;

  const newContent = content.replace(
    /\bfrom\s+['"](\.\.?[^'"]+)['"]/g,
    (match, rawPath) => {
      if (!rawPath.startsWith('.')) return match;
      if (HAS_EXT_RE.test(rawPath)) return match;

      const resolvedPath = join(fileDir, rawPath);

      if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
        count++;
        return `from '${rawPath}/index.js'`;
      }

      const jsPath = resolvedPath + '.js';
      if (existsSync(jsPath)) {
        count++;
        return `from '${rawPath}.js'`;
      }

      count++;
      return `from '${rawPath}.js'`;
    }
  );

  if (count > 0) {
    writeFileSync(filePath, newContent, 'utf8');
    console.log(`Patched (${count} hits): ${relative(distDir, filePath)}`);
  }
  return count;
}

function walkDir(dir) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return 0;
    throw e;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let st;
    try {
      st = statSync(fullPath);
    } catch (e) {
      if (e && e.code === 'ENOENT') continue;
      throw e;
    }
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      total += walkDir(fullPath);
    } else if (extname(fullPath) === '.js') {
      total += patchFile(fullPath);
    }
  }
  return total;
}

if (!existsSync(distDir)) {
  console.log('No dist/ folder; skipping patch-dist.');
  process.exit(0);
}

const count = walkDir(distDir);
if (count > 0 || process.env['PATCH_DIST_QUIET'] !== '1') {
  console.log(`\nTotal files patched: ${count}`);
}
