import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const hits = [];
const server = createServer((req, res) => { hits.push(req.url); res.writeHead(200, {'content-type':'text/html'}); res.end('<h3>thndr-mcp opener test (' + req.url + ') — you can close this tab</h3>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const candidates = {
  explorer: ['explorer.exe', [`http://127.0.0.1:${port}/explorer`]],
  rundll32: ['rundll32.exe', ['url.dll,FileProtocolHandler', `http://127.0.0.1:${port}/rundll32`]],
};
const which = process.argv[2];
const [cmd, args] = candidates[which];
const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
child.on('error', (e) => console.log(which, 'spawn error', e.message));
child.on('exit', (code) => console.log(which, 'exit', code));
child.unref();
await new Promise(r => setTimeout(r, 8000));
console.log(which, 'hits:', JSON.stringify(hits));
server.close(); process.exit(0);
