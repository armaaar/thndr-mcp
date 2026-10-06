import { LoginFlow } from '../../domain/identity/login-flow.js';

/** In-process holder of the interactive login state machine (shared by the login use cases). */
export class LoginFlowHolder {
  private flow: LoginFlow = LoginFlow.idle();

  get current(): LoginFlow {
    return this.flow;
  }

  set(flow: LoginFlow): void {
    this.flow = flow;
  }

  reset(): void {
    this.flow = LoginFlow.idle();
  }
}
