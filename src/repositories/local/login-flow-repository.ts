import type { LoginFlowRecord, SessionFile } from '../../data-sources/local/session-file';
import { DeviceApprovalRequest } from '../../domain/identity/device-approval';
import { Email } from '../../domain/identity/email';
import { LoginFlow } from '../../domain/identity/login-flow';
import type { LoginFlowRepository } from '../../domain/identity/repository';

/** Stores the pending login in the owner-only session file so CLI steps and MCP restarts can resume it. */
export class FileLoginFlowRepository implements LoginFlowRepository {
  constructor(private readonly file: SessionFile) {}

  async load(): Promise<LoginFlow> {
    const record = (await this.file.read()).loginFlow;
    if (!record) return LoginFlow.idle();
    try {
      return LoginFlow.restore({
        stage: record.stage,
        email: record.email ? Email.of(record.email) : null,
        verificationId: record.verificationId,
        approval: record.approval
          ? DeviceApprovalRequest.of({ ...record.approval, createdAt: new Date(record.approval.createdAt) })
          : null,
      });
    } catch {
      return LoginFlow.idle();
    }
  }

  async save(flow: LoginFlow): Promise<void> {
    const record: LoginFlowRecord | null =
      flow.stage === 'IDLE'
        ? null
        : {
            stage: flow.stage,
            email: flow.email?.value ?? null,
            verificationId: flow.verificationId,
            approval: flow.approval
              ? {
                  id: flow.approval.id,
                  secret: flow.approval.secret,
                  humanId: flow.approval.humanId,
                  createdAt: flow.approval.createdAt.toISOString(),
                }
              : null,
          };
    await this.file.update((content) => {
      content.loginFlow = record;
    });
  }
}
