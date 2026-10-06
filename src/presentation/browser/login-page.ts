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
<style>
  :root { --bg: #f4f4f5; --card: #fff; --text: #18181b; --muted: #71717a; --accent: #6d28d9; --error: #b91c1c;
    --ok: #15803d; --border: #e4e4e7; }
  @media (prefers-color-scheme: dark) { :root { --bg: #09090b; --card: #18181b; --text: #fafafa; --muted: #a1a1aa;
    --accent: #a78bfa; --error: #f87171; --ok: #4ade80; --border: #27272a; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg);
    color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  main { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 32px;
    width: 100%; max-width: 400px; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: var(--muted); font-size: 14px; }
  form { display: grid; gap: 12px; margin-top: 20px; }
  input { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--bg); color: var(--text); text-align: center; }
  input.code { letter-spacing: 0.4em; font-size: 22px; }
  button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 0; background: var(--accent); color: #fff;
    cursor: pointer; }
  button.link { background: none; color: var(--muted); font-size: 14px; padding: 4px; }
  button:disabled { opacity: 0.6; cursor: default; }
  .qr { background: #fff; border-radius: 12px; padding: 8px; display: inline-block; margin-top: 16px; }
  .qr svg { width: 240px; height: 240px; display: block; }
  .error { color: var(--error); font-size: 14px; min-height: 1.5em; margin: 8px 0 0; }
  .ok { color: var(--ok); }
  a { color: var(--muted); font-size: 12px; word-break: break-all; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>Log in to Thndr</h1>
  <p class="muted">thndr-mcp — unofficial MCP server and CLI</p>

  <section id="working"><p class="muted">Working…</p></section>

  <section id="email" hidden>
    <form id="email-form">
      <label class="muted" for="email-input">Email of your Thndr account</label>
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
    <p id="approval-request"><strong></strong></p>
    <p class="muted">Scan with your phone camera or the Thndr app, then approve the login in the Thndr app.
      Thndr sends no notification for it.</p>
    <div class="qr" id="approval-qr"></div>
    <p class="muted" id="approval-status">Waiting for your approval…</p>
    <p><a id="approval-link"></a></p>
  </section>

  <section id="done" hidden>
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
      $('approval-request').firstElementChild.textContent = state.request ? 'Login request ' + state.request : 'Login request';
      if (qr !== state.qrSvg) { qr = state.qrSvg; $('approval-qr').innerHTML = state.qrSvg; }
      $('approval-status').textContent = state.notes.length ? state.notes[state.notes.length - 1] : 'Waiting for your approval…';
      $('approval-link').textContent = state.deepLink;
      $('approval-link').href = state.deepLink;
    }
    if (state.step === 'done') {
      $('done-message').textContent = state.message;
      $('done-message').className = state.ok ? 'ok' : 'error';
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
