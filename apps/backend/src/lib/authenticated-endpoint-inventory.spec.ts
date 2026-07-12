import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

function filesBelow(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe('authenticated endpoint inventory', () => {
  const backendRoot = process.cwd();
  const controllers = filesBelow(join(backendRoot, 'src/modules'))
    .filter(path => path.endsWith('.controller.ts'))
    .map(path => basename(path))
    .sort();
  const inventory = readFileSync(
    join(backendRoot, '../../docs/security/authenticated-endpoint-inventory.md'),
    'utf8',
  );
  const documented = [...inventory.matchAll(/^\| `([^`]+\.controller\.ts)` \|/gm)]
    .map(match => match[1]!)
    .sort();

  it('classifies every controller exactly once', () => {
    expect(controllers).toHaveLength(26);
    expect(new Set(documented).size).toBe(documented.length);
    expect(documented).toEqual(controllers);
  });

  it('documents why partial shadow wiring is safer than generic enforcement', () => {
    expect(inventory).toContain('All existing decisions remain final');
    expect(inventory).toContain('credential, billing, membership, webhook, or operational endpoints');
    expect(inventory).toContain('resource-specific action decision');
  });
});
