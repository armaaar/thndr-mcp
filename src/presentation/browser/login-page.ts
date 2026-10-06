/**
 * The browser login page (ADR 0017): one self-contained document that polls `state` and posts the user's answers.
 * Every value from the server is inserted as text, except the QR code SVG, which the server renders itself.
 */
const DARK =
  'color-scheme: dark; --surface-a: #070707; --gradient-highlight: #0d0d0f; --surface-b: #171717; ' +
  '--surface-c: #2d2d2d; --outline: #2a2a2a; --field-border: #6c6c6c; --text-primary: #fff; --text-inverse: #000; ' +
  '--text-secondary: #9a9a9a; --brand: #8899ff; --error: #ff3d5a; --green: #75cc43;';
const LIGHT =
  'color-scheme: light; --surface-a: #fff; --gradient-highlight: #fff; --surface-b: #ececec; --surface-c: #f7f7f7; ' +
  '--outline: #ddd; --field-border: #8b8b8b; --text-primary: #07080d; --text-inverse: #fff; ' +
  '--text-secondary: #6c6c6c; --brand: #4656e8; --error: #a81e47; --green: #1e6325;';

export function renderLoginPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>thndr-mcp · Log in to Thndr</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,800&display=swap">
<style>
  /*
   * ThndrX design system (x.thndr.app): its CSS colour tokens and Ant Design theme — square corners (borderRadius 0),
   * transparent outlined inputs, primary buttons in the text colour (white on dark, black on light), DM Sans, the
   * diagonal "thndrx-bg" gradient, indigo brand only as an accent.
   */
  /* Theme: the system's by default; the header button pins one with data-theme on <html>. */
  :root { ${DARK} }
  :root[data-theme="light"] { ${LIGHT} }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { ${LIGHT} } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; color: var(--text-primary);
    background: linear-gradient(to top right, var(--surface-a), var(--gradient-highlight));
    font: 16px/1.5 "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 20px 24px;
    border-bottom: 1px solid var(--outline); flex-wrap: wrap; }
  .wordmark { font-weight: 800; font-size: 20px; letter-spacing: -0.02em; }
  .header-end { display: flex; align-items: center; gap: 16px; }
  .unofficial { color: var(--text-secondary); font-size: 13px; }
  button.theme { width: 36px; height: 36px; padding: 0; display: grid; place-items: center; background: transparent;
    color: var(--text-primary); border: 1px solid var(--field-border); font-size: 16px; line-height: 1; }
  button.theme:hover { border-color: var(--text-primary); opacity: 1; }
  main { flex: 1; display: grid; place-items: center; padding: 32px 16px; }
  .content { width: 100%; max-width: 400px; text-align: center; }
  h1 { font-size: 30px; line-height: 1.2; font-weight: 800; margin: 0 0 8px; }
  .muted { color: var(--text-secondary); font-size: 15px; margin: 0; }
  form { display: grid; gap: 16px; margin-top: 32px; text-align: start; }
  label { color: var(--text-secondary); font-size: 14px; }
  .field { display: grid; gap: 6px; }
  input { font: inherit; height: 48px; padding: 0 14px; border-radius: 0; border: 1px solid var(--field-border);
    background: transparent; color: var(--text-primary); outline: none; transition: border-color 0.2s; }
  input::placeholder { color: var(--text-secondary); }
  input:focus { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
  input.code { letter-spacing: 0.5em; font-size: 26px; font-weight: 500; text-align: center; }
  button { font: inherit; font-weight: 500; height: 48px; padding: 0 16px; border-radius: 0; border: 1px solid var(--text-primary);
    background: var(--text-primary); color: var(--text-inverse); cursor: pointer; transition: opacity 0.2s; }
  button:hover { opacity: 0.88; }
  button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  button.link { background: none; border: 0; color: var(--text-secondary); height: auto; padding: 8px; margin-top: 24px;
    font-size: 14px; }
  button.link:hover { color: var(--text-primary); opacity: 1; }
  .qr { background: #fff; border-radius: 0.375rem; padding: 12px; display: inline-block; margin: 28px 0 16px;
    box-shadow: 0 0 20px rgba(141, 150, 255, 0.5); }
  .qr svg { width: 220px; height: 220px; display: block; }
  .request { display: inline-block; background: color-mix(in srgb, var(--brand) 15%, transparent); color: var(--brand);
    border-radius: 999px; padding: 4px 14px; font-weight: 500; font-size: 15px; margin-bottom: 12px; }
  .status { display: inline-flex; align-items: center; gap: 10px; color: var(--text-secondary); font-size: 15px; margin: 0; }
  .status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--brand);
    box-shadow: 0 0 10px var(--brand); animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  @media (prefers-reduced-motion: reduce) { .status::before { animation: none; } }
  .error { color: var(--error); font-size: 14px; min-height: 1.5em; margin: 16px 0 0; }
  .ok { color: var(--green); font-weight: 500; font-size: 18px; }
  .done-icon { width: 56px; height: 56px; margin: 0 auto 16px; display: grid; place-items: center; font-size: 28px;
    color: var(--green); border: 1px solid var(--green); }
  .done-icon:empty { display: none; }
  a { color: var(--text-secondary); font-size: 12px; word-break: break-all; }
  footer { padding: 16px 24px; color: var(--text-secondary); font-size: 12px; text-align: center; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<header>
  <div class="wordmark">thndr-mcp</div>
  <div class="header-end">
    <div class="unofficial">Unofficial community tool · not affiliated with Thndr</div>
    <button class="theme" id="theme" type="button"></button>
  </div>
</header>
<main>
<div class="content">
  <h1 id="heading">Log in to Thndr</h1>

  <section id="working"><p class="status">Working…</p></section>

  <section id="email" hidden>
    <p class="muted">We will email you a verification code.</p>
    <form id="email-form">
      <div class="field">
        <label for="email-input">Email of your Thndr account</label>
        <input id="email-input" type="email" autocomplete="email" placeholder="you@example.com" required autofocus>
      </div>
      <button type="submit">Send code</button>
    </form>
  </section>

  <section id="code" hidden>
    <p id="code-sent" class="muted"></p>
    <form id="code-form">
      <div class="field">
        <label for="code-input">Verification code</label>
        <input id="code-input" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required>
      </div>
      <button type="submit">Verify</button>
    </form>
  </section>

  <section id="approval" hidden>
    <p class="muted">Scan with your phone camera or the Thndr app, then approve the login in the Thndr app.
      Thndr sends no notification for it.</p>
    <div class="qr" id="approval-qr"></div>
    <div><span class="request" id="approval-request"></span></div>
    <p class="status" id="approval-status" aria-live="polite">Waiting for your approval…</p>
    <p><a id="approval-link"></a></p>
  </section>

  <section id="done" hidden>
    <div class="done-icon" id="done-icon" aria-hidden="true"></div>
    <p id="done-message"></p>
    <p id="done-next" class="muted"></p>
    <form id="retry-form" hidden><button id="retry" type="button">Try again</button></form>
  </section>

  <p class="error" id="error" role="alert"></p>
  <button class="link" id="cancel" type="button">Cancel login</button>
</div>
</main>
<footer>Your email and code go only to this computer's thndr-mcp, which talks to Thndr for you.</footer>
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
    if (state.step !== 'done') $('heading').textContent = 'Log in to Thndr';
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
      $('heading').textContent = state.ok ? "You're logged in" : 'Login did not finish';
      // Server messages are plain text; drop the terminal check mark and show dates in the user's locale.
      $('done-message').textContent = state.message
        .replace(/^✔\\s*/, '')
        .replace(/\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z/g, (iso) => new Date(iso).toLocaleString());
      $('done-message').className = state.ok ? 'ok' : 'error';
      $('done-icon').textContent = state.ok ? '✓' : '';
      $('done-next').textContent = state.ok ? 'You can close this tab and go back to your MCP client.' : '';
      $('retry-form').hidden = state.ok || state.message === 'Login cancelled.';
    }
    if (state.step !== current) {
      current = state.step;
      const input = state.step === 'email' ? $('email-input') : state.step === 'code' ? $('code-input') : null;
      if (input) { input.value = ''; input.focus(); }
    }
  }

  async function poll() {
    try { render(await (await fetch('state')).json()); } catch { $('error').textContent = 'The login page has closed.'; return; }
    if (current !== 'done' || !$('retry-form').hidden) setTimeout(poll, 1000);
  }

  const dark = () =>
    document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
  function paintThemeButton() {
    const isDark = dark();
    $('theme').textContent = isDark ? '☀' : '☾';
    $('theme').setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    $('theme').title = $('theme').getAttribute('aria-label');
  }
  $('theme').addEventListener('click', () => {
    document.documentElement.dataset.theme = dark() ? 'light' : 'dark';
    paintThemeButton();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeButton);
  paintThemeButton();

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
