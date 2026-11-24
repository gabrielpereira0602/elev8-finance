// Teste ponta a ponta local: sobe a API com api/dev-router.php em localhost:8099 e roda `node e2e.mjs` (precisa de Chrome).

import puppeteer from 'puppeteer-core';
const B = 'http://localhost:8099';
const shot = (p, n) => p.screenshot({ path: `/home/claude/e2e/${n}.png`, fullPage: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const clickText = async (text, sel = 'button, a') => {
  const ok = await page.evaluate((t, s) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.replace(/\u00a0/g, ' ').trim().startsWith(t)); if (el) { el.click(); return true; } return false; }, text, sel);
  if (!ok) throw new Error('não achei: ' + text);
  await wait(500);
};
await page.goto(B + '/', { waitUntil: 'networkidle0' });
await shot(page, '01-login');
await page.type('input[type=email]', 'gabriel@teste.com');
await page.type('input[type=password]', 'senha-forte-123');
await clickText('Entrar');
await wait(800);
await shot(page, '02-onboarding');
await page.type('input[placeholder^="Cartão XP"]', 'Cartão XP');
const nums = await page.$$('input[type=number]');
await nums[0].type('5'); await nums[1].type('12');
await clickText('Adicionar');
await page.type('input[placeholder^="Cartão XP"]', 'Conta Inter');
await clickText('Conta');
await clickText('Adicionar');
await wait(500);
await shot(page, '03-cartoes');
await clickText('Continuar');
await shot(page, '04-instalar');
await clickText('Começar');
await wait(800);
await shot(page, '05-inicio-vazio');
// income by phrase
await page.goto(B + '/#/lancar', { waitUntil: 'networkidle0' });
await clickText('Entrou');
await page.type('.phrase input', 'Recebi 5000 salário');
await clickText('Revisar');
await shot(page, '06-rascunho-entrada');
await clickText('Confirmar');
await wait(800);
// installment purchase
await page.goto(B + '/#/lancar', { waitUntil: 'networkidle0' });
await page.type('.phrase input', 'Cadeira 480 em 4x cartão XP casa');
await clickText('Revisar');
await shot(page, '07-rascunho-cadeira');
await clickText('Compras', '.sheet button');
await shot(page, '07b-rascunho-cadeira');
await clickText('Confirmar');
await wait(800);
for (const t of ['Uber 28,50 hoje transporte', 'Mercado 87,90 ontem alimentação em casa', 'Academia 129,90 recorrente todo mês', 'Farmácia 48 ou 84']) {
  await page.goto(B + '/#/lancar?r=' + Math.random(), { waitUntil: 'networkidle0' });
  await page.evaluate(() => { location.hash = '#/lancar'; });
  await wait(300);
  await page.type('.phrase input', t);
  await clickText('Revisar');
  if (t.startsWith('Farmácia')) {
    await shot(page, '08-pergunta-valor');
    await clickText('R$ 48,00', '.sheet button');
    await shot(page, '09-pergunta-categoria');
    if (await page.$('.ask')) await clickText('Saúde', '.sheet button');
  }
  await clickText('Confirmar');
  await wait(700);
}
// duplicate guard
await page.evaluate(() => { location.hash = '#/lancar'; });
await wait(300);
await page.type('.phrase input', 'Uber 28,50 hoje transporte');
await clickText('Revisar');
await clickText('Confirmar');
await wait(600);
await shot(page, '10-duplicidade');
await clickText('Não lançar');
await page.evaluate(() => { location.hash = '#/inicio'; });
await wait(900);
await shot(page, '11-inicio');
for (const tab of ['geral', 'fluxo', 'categorias', 'tendencia', 'calendario', 'futuro']) {
  await page.evaluate((t) => { location.hash = '#/analises/' + t; }, tab);
  await wait(900);
  await shot(page, '12-analises-' + tab);
}
await page.evaluate(() => { location.hash = '#/aprender'; }); await wait(400); await shot(page, '13-aprender');
await page.evaluate(() => { location.hash = '#/aprender/pague-se'; }); await wait(400); await shot(page, '14-principio');
await page.evaluate(() => { location.hash = '#/ajustes'; }); await wait(400); await shot(page, '15-ajustes');
await page.evaluate(() => { location.hash = '#/lancamentos'; }); await wait(800); await shot(page, '16-lancamentos');
const first = await page.$eval('a.item', (a) => a.getAttribute('href'));
await page.evaluate((h) => { location.hash = h; }, first); await wait(800); await shot(page, '17-detalhe');
console.log('ERRORS', JSON.stringify(errors));
await browser.close();
