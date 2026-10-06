import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionFile } from '../../data-sources/local/session-file';
import { DeviceApprovalRequest } from '../../domain/identity/device-approval';
import { Email } from '../../domain/identity/email';
import { LoginFlow } from '../../domain/identity/login-flow';
import { FileLoginFlowRepository } from '../local/login-flow-repository';
import { InMemoryLoginFlowRepository } from '../memory/login-flow-repository';

const approval = DeviceApprovalRequest.of({
  id: 'req-1',
  secret: 's3cret',
  humanId: 'H7',
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

describe('FileLoginFlowRepository', () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thndr-flow-'));
    path = join(dir, 'session.json');
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('starts idle and round-trips every stage across instances (process boundaries)', async () => {
    const writer = new FileLoginFlowRepository(new SessionFile(path));
    expect((await writer.load()).stage).toBe('IDLE');

    await writer.save(LoginFlow.idle().codeSent(Email.of('a@b.co'), 'vid-1'));
    const reader = new FileLoginFlowRepository(new SessionFile(path));
    expect((await reader.load()).requireCodeSent()).toEqual({
      email: Email.of('a@b.co'),
      verificationId: 'vid-1',
    });

    await writer.save((await writer.load()).awaitingApproval(approval));
    const restored = (await reader.load()).requireAwaitingApproval();
    expect(restored).toEqual(approval);
    expect((await reader.load()).email?.value).toBe('a@b.co');

    await writer.save(LoginFlow.idle());
    expect((await reader.load()).stage).toBe('IDLE');
    expect(JSON.parse(await readFile(path, 'utf8')).loginFlow).toBeNull();
  });

  it('persists a re-approval flow without email', async () => {
    const repo = new FileLoginFlowRepository(new SessionFile(path));
    await repo.save(LoginFlow.idle().awaitingApproval(approval));
    const flow = await repo.load();
    expect(flow.email).toBeNull();
    expect(flow.requireAwaitingApproval().secret).toBe('s3cret');
  });

  it('falls back to idle on a corrupted record', async () => {
    await writeFile(path, JSON.stringify({ loginFlow: { stage: 'CODE_SENT', email: 'not-an-email' } }));
    expect((await new FileLoginFlowRepository(new SessionFile(path)).load()).stage).toBe('IDLE');
  });
});

describe('InMemoryLoginFlowRepository', () => {
  it('stores the flow in memory', async () => {
    const repo = new InMemoryLoginFlowRepository();
    expect(repo.current.stage).toBe('IDLE');
    await repo.save(LoginFlow.idle().awaitingApproval(approval));
    expect((await repo.load()).stage).toBe('AWAITING_APPROVAL');
    expect(repo.current.stage).toBe('AWAITING_APPROVAL');
  });
});
