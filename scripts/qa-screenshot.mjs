import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs = [];
p.on('console', m => m.type() === 'error' && errs.push(m.text()));

await p.goto('http://26.73.129.112:3007/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.fill('#email', 'claude.qa@ntb-estoque.dev');
await p.fill('#password', 'claudeqa123456');
await p.click('button[type=submit]');
await p.waitForURL(/\/(home|resumo)/, { timeout: 10000 }).catch(() => {});
console.log('pos-login:', p.url());

await p.goto('http://127.0.0.1:3007/resumo?cat=auditoria', { waitUntil: 'networkidle', timeout: 20000 });
await p.screenshot({ path: 'C:/Users/media/OneDrive/Desktop/Screenshots/ntb-resumo-auditoria.png', fullPage: true });
console.log('screenshot salvo');
if (errs.length) console.error('erros de console:', errs.join('\n'));
await b.close();
