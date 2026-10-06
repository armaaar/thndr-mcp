import { LoginFlow } from '../../../domain/identity/login-flow.js';
import type { LoginFlowRepository } from '../../../domain/identity/repository.js';

/** Process-local login flow store (tests, embedding). */
export class InMemoryLoginFlowRepository implements LoginFlowRepository {
  private flow: LoginFlow = LoginFlow.idle();

  /** Synchronous view of the stored flow (handy for tests and diagnostics). */
  get current(): LoginFlow {
    return this.flow;
  }

  async load(): Promise<LoginFlow> {
    return this.flow;
  }

  async save(flow: LoginFlow): Promise<void> {
    this.flow = flow;
  }
}
