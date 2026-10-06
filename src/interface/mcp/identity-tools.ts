import { z } from 'zod';
import type {
  CompleteLogin,
  GetAuthStatus,
  ImportSession,
  Logout,
  RequestDeviceApproval,
  StartLogin,
  VerifyLoginCode,
} from '../../application/identity/login.js';
import { type AnyTool, defineTool, READ_ONLY, WRITE, WRITE_IDEMPOTENT } from './tool.js';

export interface IdentityUseCases {
  getAuthStatus: GetAuthStatus;
  startLogin: StartLogin;
  verifyLoginCode: VerifyLoginCode;
  requestDeviceApproval: RequestDeviceApproval;
  completeLogin: CompleteLogin;
  importSession: ImportSession;
  logout: Logout;
}

export function identityTools(useCases: IdentityUseCases): AnyTool[] {
  return [
    defineTool({
      name: 'auth_status',
      title: 'Thndr session status',
      description:
        'Shows whether the server is logged in to Thndr, when the session expires, and which login step is pending. ' +
        'Call this first if another tool returns NOT_AUTHENTICATED or SESSION_EXPIRED.',
      input: {},
      annotations: { ...READ_ONLY, openWorldHint: false },
      handler: () => useCases.getAuthStatus.execute(),
    }),
    defineTool({
      name: 'login_start',
      title: 'Start Thndr login',
      description:
        'Step 1 of 3. Sends a 6-digit verification code to the email address of the Thndr account. ' +
        'Ask the user for their Thndr email if you do not know it. Next: login_verify_code.',
      input: { email: z.string().describe('Email address registered with Thndr') },
      annotations: WRITE,
      handler: ({ email }) => useCases.startLogin.execute({ email }),
    }),
    defineTool({
      name: 'login_verify_code',
      title: 'Verify Thndr email code',
      description:
        'Step 2 of 3. Verifies the emailed code and creates a login request that the user must approve in the ' +
        'Thndr mobile app. Show the user the returned message (and deep link). Next: login_complete.',
      input: { code: z.string().describe('The 6-digit code from the email') },
      annotations: WRITE,
      handler: ({ code }) => useCases.verifyLoginCode.execute({ code }),
    }),
    defineTool({
      name: 'login_request_approval',
      title: 'Request phone approval',
      description:
        'Creates a new login request for an already identified user (no email code needed). Use it when the session ' +
        'expired (SESSION_EXPIRED). The user approves it in the Thndr mobile app. Next: login_complete.',
      input: {},
      annotations: WRITE,
      handler: () => useCases.requestDeviceApproval.execute(),
    }),
    defineTool({
      name: 'login_complete',
      title: 'Complete Thndr login',
      description:
        'Step 3 of 3. Waits (up to timeout_seconds) for the user to approve the login in the Thndr mobile app, then ' +
        'stores the session. If it returns authenticated=false with status pending, call it again after the user approves.',
      input: {
        timeout_seconds: z
          .number()
          .int()
          .min(0)
          .max(300)
          .default(60)
          .describe('How long to wait for approval'),
      },
      annotations: WRITE_IDEMPOTENT,
      handler: ({ timeout_seconds }) => useCases.completeLogin.execute({ timeoutSeconds: timeout_seconds }),
    }),
    defineTool({
      name: 'login_import_session',
      title: 'Import browser session',
      description:
        'Fallback login for accounts that use Google/Apple sign-in: the user logs in at https://x.thndr.app in a ' +
        'browser and pastes the Cookie request header of any x.thndr.app/api request (DevTools → Network).',
      input: { cookie_header: z.string().min(3).describe('Value of the Cookie header sent to x.thndr.app') },
      annotations: WRITE,
      handler: ({ cookie_header }) => useCases.importSession.execute({ cookieHeader: cookie_header }),
    }),
    defineTool({
      name: 'logout',
      title: 'Log out of Thndr',
      description:
        'Ends the Thndr session and deletes stored tokens. With forget_identity=true also signs out of Firebase.',
      input: { forget_identity: z.boolean().default(false) },
      annotations: { ...WRITE_IDEMPOTENT, destructiveHint: true },
      handler: ({ forget_identity }) => useCases.logout.execute({ forgetIdentity: forget_identity }),
    }),
  ];
}
