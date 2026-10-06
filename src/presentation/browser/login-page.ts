/**
 * The browser login page (ADR 0017): one self-contained document that polls `state` and posts the user's answers.
 * Every value from the server is inserted as text, except the QR code SVG, which the server renders itself.
 */
export function renderLoginPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thndr login</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap">
<style>
  /* ThndrX design tokens (x.thndr.app): dark first, DM Sans, indigo primary. */
  :root { color-scheme: dark; --background: #090909; --surface-a: #070707; --surface-b: #171717;
    --surface-c: #2d2d2d; --outline: #2a2a2a; --primary: #8d96ff; --on-primary: #000; --text: #fff;
    --text-secondary: #9a9a9a; --error: #ff3d5a; --green: #75cc43; --hover: #28282c; }
  @media (prefers-color-scheme: light) { :root { color-scheme: light; --background: #eee; --surface-a: #fff;
    --surface-b: #ececec; --surface-c: #f7f7f7; --outline: #ddd; --primary: #4656e8; --on-primary: #fff;
    --text: #07080d; --text-secondary: #6c6c6c; --error: #f23645; --green: #0d8f16; --hover: #e5e5e5; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--background);
    color: var(--text); font: 16px/1.5 "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { background: var(--surface-b); border: 1px solid var(--outline); border-radius: 1.5rem; padding: 32px 28px;
    width: 100%; max-width: 400px; text-align: center; }
  .brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 18px; }
  .brand .bolt { width: 28px; height: 28px; border-radius: 50%; background: var(--primary); color: var(--on-primary);
    display: grid; place-items: center; font-size: 15px; }
  .unofficial { color: var(--text-secondary); font-size: 12px; margin: 4px 0 24px; }
  h1 { font-size: 24px; line-height: 1.25; font-weight: 700; margin: 0 0 6px; }
  .muted { color: var(--text-secondary); font-size: 14px; margin: 0; }
  form { display: grid; gap: 12px; margin-top: 20px; text-align: left; }
  label { color: var(--text-secondary); font-size: 14px; }
  input { font: inherit; padding: 14px 16px; border-radius: 0.75rem; border: 1px solid var(--outline);
    background: var(--surface-c); color: var(--text); outline: none; }
  input:focus { border-color: var(--primary); }
  input.code { letter-spacing: 0.5em; font-size: 24px; font-weight: 700; text-align: center; }
  button { font: inherit; font-weight: 700; padding: 14px 16px; border-radius: 999px; border: 0; background: var(--primary);
    color: var(--on-primary); cursor: pointer; }
  button:hover { filter: brightness(1.08); }
  button.link { background: none; color: var(--text-secondary); font-weight: 500; font-size: 14px; padding: 8px; margin-top: 8px; }
  button.link:hover { color: var(--text); filter: none; }
  button:disabled { opacity: 0.6; cursor: default; }
  .qr { background: #fff; border-radius: 1rem; padding: 10px; display: inline-block; margin: 20px 0 12px; }
  .qr svg { width: 232px; height: 232px; display: block; }
  .request { display: inline-block; background: var(--surface-c); border: 1px solid var(--outline); border-radius: 999px;
    padding: 4px 14px; font-weight: 700; margin-bottom: 8px; }
  .status { display: inline-flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 14px; }
  .status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--primary);
    animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  .error { color: var(--error); font-size: 14px; min-height: 1.5em; margin: 12px 0 0; }
  .ok { color: var(--green); font-weight: 700; }
  .done-icon { font-size: 40px; line-height: 1; margin-bottom: 8px; }
  a { color: var(--text-secondary); font-size: 12px; word-break: break-all; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <div class="brand"><span class="bolt" aria-hidden="true">⚡</span>thndr-mcp</div>
  <p class="unofficial">Unofficial community tool · not affiliated with Thndr</p>
  <h1>Log in to Thndr</h1>

  <section id="working"><p class="status">Working…</p></section>

  <section id="email" hidden>
    <p class="muted">We will email you a verification code.</p>
    <form id="email-form">
      <label for="email-input">Email of your Thndr account</label>
      <input id="email-input" type="email" autocomplete="email" required autofocus>
      <button type="submit">Send code</button>
    </form>
  </section>

  <section id="code" hidden>
    <p id="code-sent" class="muted"></p>
    <form id="code-form">
      <input id="code-input" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required>
      <button type="submit">Verify</button>
    </form>
  </section>

  <section id="approval" hidden>
    <p class="muted">Scan with your phone camera or the Thndr app, then approve the login in the Thndr app.
      Thndr sends no notification for it.</p>
    <div class="qr" id="approval-qr"></div>
    <div><span class="request" id="approval-request"></span></div>
    <p class="status" id="approval-status">Waiting for your approval…</p>
    <p><a id="approval-link"></a></p>
  </section>

  <section id="done" hidden>
    <div class="done-icon" id="done-icon" aria-hidden="true"></div>
    <p id="done-message"></p>
    <p id="done-next" class="muted"></p>
    <button id="retry" type="button" hidden>Try again</button>
  </section>

  <p class="error" id="error" role="alert"></p>
  <button class="link" id="cancel" type="button">Cancel login</button>
</main>
<script nonce="${nonce}">
  const $ = (id) => document.getElementById(id);
  const sections = ['working', 'email', 'code', 'approval', 'done'];
  let current = '';
  let qr = '';

  async function post(route, body) {
    $('error').textContent = '';
    const res = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}) });
    const data = await res.json();
    if (!res.ok) { $('error').textContent = data.error || 'Something went wrong.'; return; }
    render(data);
  }

  function render(state) {
    for (const id of sections) $(id).hidden = id !== state.step;
    $('cancel').hidden = state.step === 'done';
    if (state.step === 'code') $('code-sent').textContent = state.sent;
    if (state.step === 'approval') {
      $('approval-request').textContent = state.request ? 'Request ' + state.request : 'Login request';
      if (qr !== state.qrSvg) { qr = state.qrSvg; $('approval-qr').innerHTML = state.qrSvg; }
      $('approval-status').textContent = state.notes.length ? state.notes[state.notes.length - 1] : 'Waiting for your approval…';
      $('approval-link').textContent = state.deepLink;
      $('approval-link').href = state.deepLink;
    }
    if (state.step === 'done') {
      $('done-message').textContent = state.message;
      $('done-message').className = state.ok ? 'ok' : 'error';
      $('done-icon').textContent = state.ok ? '✓' : '';
      $('done-next').textContent = state.ok ? 'You can close this tab and go back to your MCP client.' : '';
      $('retry').hidden = state.ok || state.message === 'Login cancelled.';
    }
    if (state.step !== current) {
      current = state.step;
      const input = state.step === 'email' ? $('email-input') : state.step === 'code' ? $('code-input') : null;
      if (input) { input.value = ''; input.focus(); }
    }
  }

  async function poll() {
    try { render(await (await fetch('state')).json()); } catch { $('error').textContent = 'The login page has closed.'; return; }
    if (current !== 'done' || !$('retry').hidden) setTimeout(poll, 1000);
  }

  $('email-form').addEventListener('submit', (e) => { e.preventDefault(); post('email', { email: $('email-input').value }); });
  $('code-form').addEventListener('submit', (e) => { e.preventDefault(); post('code', { code: $('code-input').value }); });
  $('retry').addEventListener('click', () => post('retry'));
  $('cancel').addEventListener('click', () => post('cancel'));
  poll();
</script>
</body>
</html>
`;
}
