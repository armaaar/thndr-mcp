#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../../config';
import { compose } from '../../container';
import { VERSION } from '../../version';
import { runCli } from './cli';
import { runLoginCommand } from './login-command';

const app = compose(loadConfig());
const out = (text: string) => process.stdout.write(`${text}\n`);

runCli(process.argv.slice(2), {
  useCases: app.useCases,
  version: VERSION,
  logger: app.logger,
  io: { out, err: (text) => process.stderr.write(`${text}\n`) },
  interactiveLogin: async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await runLoginCommand(app.useCases, { prompt: (q) => rl.question(q), print: out });
    } finally {
      rl.close();
    }
  },
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`thndr: fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
