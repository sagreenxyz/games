import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';
const MOCK = readFileSync('tests/peerjs-mock.js', 'utf8');
const [,, slug, out, nPlayers = '2', w = '1200'] = process.argv;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: Number(w), height: 900 } });
const pages = [];
for (let i = 0; i < Number(nPlayers); i++) {
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: MOCK }));
  await p.goto(`http://localhost:4321/games/${slug}/`);
  pages.push(p);
}
const [host, ...guests] = pages;
await host.fill('#playerName', 'Ann'); await host.click('#btnNew');
await host.locator('#waitingRoom').waitFor({ state: 'visible' });
const code = (await host.locator('#displayRoomCode').textContent()).trim();
for (const [i, g] of guests.entries()) {
  await g.fill('#playerName', ['Ben', 'Cat', 'Dan', 'Eve', 'Fay'][i]); await g.click('#btnJoin');
  await g.fill('#roomCode', code); await g.click('#btnJoinConfirm');
  await g.locator('#waitingRoom').waitFor({ state: 'visible' });
}
await host.click('#btnStart');
await host.locator('#gameTable').waitFor({ state: 'visible' });
await host.waitForTimeout(400);
if (process.env.STEPS) await eval(process.env.STEPS);
await host.waitForTimeout(300);
await host.screenshot({ path: out, fullPage: true });
await b.close();
