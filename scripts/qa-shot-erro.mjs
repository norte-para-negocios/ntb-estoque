import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const errs = [];
p.on('console', m => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

await p.goto('http://127.0.0.1:3007/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.fill('#email', 'claude.qa@ntb-estoque.dev');
await p.fill('#password', 'claudeqa123456');
await p.click('button[type=submit]');
await p.waitForURL(/\/(home|resumo)/, { timeout: 10000 }).catch(() => {});

await p.goto('http://127.0.0.1:3007/resumo?cat=erros&loja=5', { waitUntil: 'networkidle', timeout: 25000 });
await p.waitForTimeout(600);
await p.screenshot({ path: 'C:/Users/media/OneDrive/Desktop/Screenshots/ntb-erros-lista.png', fullPage: true });

// Clica no primeiro selo de erro (botao "Resolver"/"Ver erro"/"Temporário")
const botao = p.locator('table button').first();
if (await botao.count()) {
  await botao.click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'C:/Users/media/OneDrive/Desktop/Screenshots/ntb-erros-popup.png' });
  console.log('popup capturado');
} else {
  console.log('nenhum botao de erro encontrado');
}
console.log(errs.length ? 'ERROS CONSOLE:\n' + errs.join('\n') : 'console limpo');
await b.close();
