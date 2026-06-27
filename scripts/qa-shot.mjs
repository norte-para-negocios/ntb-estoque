import { chromium } from 'playwright';

const rota = process.argv[2] || '/nota-fiscal';
const nome = process.argv[3] || 'ntb-shot';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 } });
const p = await ctx.newPage();
const errs = [];
p.on('console', m => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

await p.goto('http://127.0.0.1:3007/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.fill('#email', 'claude.qa@ntb-estoque.dev');
await p.fill('#password', 'claudeqa123456');
await p.click('button[type=submit]');
await p.waitForURL(/\/(home|resumo)/, { timeout: 10000 }).catch(() => {});

await p.goto('http://127.0.0.1:3007' + rota, { waitUntil: 'networkidle', timeout: 25000 });
await p.waitForTimeout(800);
const out = `C:/Users/media/OneDrive/Desktop/Screenshots/${nome}.png`;
await p.screenshot({ path: out, fullPage: true });
console.log('URL final:', p.url());
console.log('screenshot:', out);
console.log(errs.length ? 'ERROS CONSOLE:\n' + errs.join('\n') : 'console limpo');
await b.close();
