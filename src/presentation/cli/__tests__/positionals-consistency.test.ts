import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../config';
import { compose } from '../../../container';
import { CLI_POSITIONALS } from '../positionals';

describe('CLI_POSITIONALS', () => {
  it('only names registered use cases and fields of their input contracts', () => {
    const sessionFile = join(mkdtempSync(join(tmpdir(), 'thndr-pos-')), 's.json');
    const { useCases } = compose({ ...loadConfig({}), sessionFile, logLevel: 'silent' });
    const problems = Object.entries(CLI_POSITIONALS).flatMap(([name, fields]) => {
      const useCase = useCases.find((u) => u.name === name);
      if (!useCase) return [`${name}: no such use case`];
      return fields.filter((f) => !(f in useCase.input)).map((f) => `${name}.${f}: no such input field`);
    });
    expect(problems).toEqual([]);
  });
});
