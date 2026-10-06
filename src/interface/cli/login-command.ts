import type {
  ApprovalInstructions,
  CompleteLogin,
  GetAuthStatus,
  RequestDeviceApproval,
  StartLogin,
  VerifyLoginCode,
} from '../../application/identity/login.js';

export interface CliIo {
  prompt(question: string): Promise<string>;
  print(line: string): void;
}

export interface LoginCommandDeps {
  getAuthStatus: GetAuthStatus;
  startLogin: StartLogin;
  verifyLoginCode: VerifyLoginCode;
  requestDeviceApproval: RequestDeviceApproval;
  completeLogin: CompleteLogin;
}

/**
 * Interactive terminal login (`thndr-mcp login`). Uses the same use cases as the MCP login tools.
 * Returns the process exit code.
 */
export async function runLoginCommand(deps: LoginCommandDeps, io: CliIo, attempts = 5): Promise<number> {
  const status = await deps.getAuthStatus.execute();
  let instructions: ApprovalInstructions;
  if (status.identified) {
    io.print('Already identified with Thndr. Requesting a new approval on your phone…');
    instructions = await deps.requestDeviceApproval.execute();
  } else {
    const email = (await io.prompt('Thndr account email: ')).trim();
    io.print((await deps.startLogin.execute({ email })).message);
    const code = (await io.prompt('Verification code: ')).trim();
    instructions = await deps.verifyLoginCode.execute({ code });
  }
  io.print(instructions.message);
  io.print(`Deep link (open on your phone): ${instructions.deepLink}`);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await deps.completeLogin.execute({ timeoutSeconds: 60 });
    if (result.authenticated) {
      io.print(`✔ ${result.message} Session valid until ${result.sessionExpiresAt ?? 'the server ends it'}.`);
      return 0;
    }
    io.print(result.message);
    if (result.status !== 'pending' && result.status !== 'unknown') return 1;
  }
  io.print('Gave up waiting for approval.');
  return 1;
}
