/**
 * The browser login page (ADR 0017): one self-contained document that polls `state` and posts the user's answers.
 * Every value from the server is inserted as text, except the QR code SVG, which the server renders itself.
 */
/*
 * Thndr's brand (its logo, app and App Store listing): bright yellow #ffff00 with black, rounded cards, pill buttons,
 * green for gains. Light: an off-white page, a white card and yellow pill buttons. Dark: a near-black page, a dark
 * card and yellow pill buttons. Every text colour meets WCAG AA on the surface it sits on.
 */
const LIGHT =
  'color-scheme: light; --page: #f6f6f1; --page-text: #000; --page-muted: #555; --card: #fff; --text: #000; ' +
  '--muted: #6c6c6c; --field: #fafafa; --field-border: #7a7a7a; --primary: #ffff00; --on-primary: #000; ' +
  '--primary-edge: #d6d600; --accent: #000; --pill: #ffff00; --on-pill: #000; --error: #a81e47; --green: #1e6325; ' +
  '--outline: #e5e5e5; --glow: 0 8px 32px rgba(0, 0, 0, 0.08);';
const DARK =
  'color-scheme: dark; --page: #0a0a0a; --page-text: #fff; --page-muted: #9a9a9a; --card: #1a1a1a; --text: #fff; ' +
  '--muted: #9a9a9a; --field: #0f0f0f; --field-border: #6c6c6c; --primary: #ffff00; --on-primary: #000; ' +
  '--primary-edge: #ffff00; ' +
  '--accent: #ffff00; --pill: #ffff00; --on-pill: #000; --error: #ff3d5a; --green: #75cc43; --outline: #2a2a2a; ' +
  '--glow: 0 0 28px rgba(255, 255, 0, 0.3);';

export function renderLoginPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>thndr-mcp · Log in to Thndr</title>
<style>
  /* Theme: the system's by default; the header button pins one with data-theme on <html>. */
  :root { ${DARK} }
  :root[data-theme="light"] { ${LIGHT} }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { ${LIGHT} } }
  /* DM Sans is served by this page (font.woff2), so it loads nothing from the internet. */
  @font-face { font-family: "DM Sans"; src: url("font.woff2") format("woff2"); font-weight: 100 1000;
    font-style: normal; font-display: swap; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; background: var(--page);
    color: var(--page-text); font: 16px/1.5 "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { display: flex; align-items: center; gap: 16px; padding: 20px 24px; }
  header .unofficial { margin-inline-start: auto; }
  .wordmark { font-weight: 800; font-size: 22px; letter-spacing: -0.02em; }
  .unofficial { color: var(--page-muted); font-size: 13px; }
  button.theme { width: 38px; height: 38px; padding: 0; display: grid; place-items: center; border-radius: 50%;
    background: transparent; color: var(--page-text); border: 1.5px solid var(--page-text); font-size: 16px; line-height: 1; }
  button.theme:hover { opacity: 0.7; }
  main { flex: 1; display: grid; place-items: center; padding: 16px; }
  .card { width: 100%; max-width: 440px; background: var(--card); color: var(--text); border-radius: 24px;
    padding: 36px 32px; text-align: center; box-shadow: var(--glow); }
  h1 { font-size: 30px; line-height: 1.2; font-weight: 800; margin: 0 0 8px; letter-spacing: -0.01em; }
  .muted { color: var(--muted); font-size: 15px; margin: 0; }
  form { display: grid; gap: 16px; margin-top: 28px; text-align: start; }
  label { color: var(--muted); font-size: 14px; }
  .field { display: grid; gap: 6px; }
  input { font: inherit; height: 52px; padding: 0 16px; border-radius: 12px; border: 1.5px solid var(--field-border);
    background: var(--field); color: var(--text); outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
  input::placeholder { color: var(--muted); }
  input:focus { border-color: var(--accent); box-shadow: 0 0 0 1.5px var(--accent); }
  input.code { letter-spacing: 0.5em; font-size: 26px; font-weight: 500; text-align: center; }
  button { font: inherit; font-weight: 700; height: 52px; padding: 0 20px; border-radius: 999px;
    border: 1px solid var(--primary-edge); background: var(--primary); color: var(--on-primary); cursor: pointer;
    transition: opacity 0.2s; }
  button:hover { opacity: 0.85; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  button.link { background: none; border: 0; color: var(--muted); height: auto; padding: 8px; margin-top: 20px; font-weight: 500;
    font-size: 14px; }
  button.link:hover { color: var(--text); opacity: 1; }
  .qr { background: #fff; border-radius: 16px; padding: 14px; display: inline-block; margin: 24px 0 16px;
    border: 1px solid var(--outline); box-shadow: var(--glow); }
  .qr svg { width: 216px; height: 216px; display: block; }
  .request { display: inline-block; background: var(--pill); color: var(--on-pill); border-radius: 999px;
    padding: 4px 16px; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
  .status { display: inline-flex; align-items: center; gap: 10px; color: var(--muted); font-size: 15px; margin: 0; }
  .status::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.25; } }
  @media (prefers-reduced-motion: reduce) { .status::before { animation: none; } }
  .error { color: var(--error); font-size: 14px; min-height: 1.5em; margin: 16px 0 0; }
  .error:empty { min-height: 0; margin: 0; }
  .ok { color: var(--green); font-weight: 700; font-size: 17px; }
  .done-icon { width: 60px; height: 60px; margin: 8px auto 16px; display: grid; place-items: center; font-size: 30px;
    font-weight: 700; border-radius: 50%; background: var(--pill); color: var(--on-pill); }
  .done-icon:empty { display: none; }
  a { color: var(--muted); font-size: 12px; word-break: break-all; }
  .notice { margin: 24px 0 0; padding-top: 16px; border-top: 1px solid var(--outline); color: var(--muted);
    font-size: 12.5px; line-height: 1.55; }
  .notice strong { color: var(--text); }
  [hidden] { display: none !important; }
  @media (max-width: 520px) {
    header { flex-wrap: wrap; padding: 14px 16px; row-gap: 4px; }
    header .theme { order: 2; margin-inline-start: auto; width: 34px; height: 34px; }
    header .unofficial { order: 3; width: 100%; margin: 0; font-size: 12px; }
    .wordmark { font-size: 20px; }
    main { place-items: start center; padding: 8px 12px 16px; }
    .card { padding: 28px 20px; border-radius: 20px; }
    h1 { font-size: 24px; }
    .muted { font-size: 14px; }
    form { margin-top: 22px; }
    input.code { font-size: 22px; letter-spacing: 0.35em; }
    .qr svg { width: min(216px, 62vw); height: min(216px, 62vw); }
  }
</style>
</head>
<body>
<header>
  <div class="wordmark">thndr-mcp</div>
  <div class="unofficial">Unofficial community tool · not affiliated with Thndr</div>
  <button class="theme" id="theme" type="button"></button>
</header>
<main>
<div class="card">
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
  <p class="notice" id="notice"><strong>Unofficial</strong> — not affiliated with Thndr. Everything runs locally on
    your computer and no data is collected: your email and code go only to thndr-mcp on this machine, which sends them
    straight to Thndr.</p>
</div>
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

  // Emails and codes never contain whitespace: drop what a copy/paste brings along, as the user types.
  for (const id of ['email-input', 'code-input']) {
    $(id).addEventListener('input', (e) => {
      const input = e.target;
      const clean = input.value.replace(/\\s+/g, '');
      if (clean !== input.value) input.value = clean;
    });
  }

  $('email-form').addEventListener('submit', (e) => { e.preventDefault(); post('email', { email: $('email-input').value.trim() }); });
  $('code-form').addEventListener('submit', (e) => { e.preventDefault(); post('code', { code: $('code-input').value.replace(/\\s+/g, '') }); });
  $('retry').addEventListener('click', () => post('retry'));
  $('cancel').addEventListener('click', () => post('cancel'));
  poll();
</script>
</body>
</html>
`;
}
