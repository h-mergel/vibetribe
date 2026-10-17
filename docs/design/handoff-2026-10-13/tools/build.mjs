import fs from 'fs';
import { Resvg } from '@resvg/resvg-js';
const adv = JSON.parse(fs.readFileSync('adv.json', 'utf8'));
const src = fs.readFileSync('src/tiles.js', 'utf8').replace('__ADV__', JSON.stringify(adv));
fs.mkdirSync('out/svg', { recursive: true }); fs.mkdirSync('out/png', { recursive: true });
fs.writeFileSync('out/bundle.js', src);
new Function(src)();
const VT = globalThis.VibeTribe;
const F = { fontFiles: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'], loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' };

export const SAMPLES = {
  'slot-needs_permission': { kind: 'slot', state: 'needs_permission', title: 'Mobile Entwicklung Northwind', badge: 'APP', wait: 42, frame: 'thick' },
  'slot-needs_permission-breath-035': { kind: 'slot', state: 'needs_permission', title: 'Mobile Entwicklung Northwind', badge: 'APP', wait: 3, frame: 'thick', level: 0.35 },
  'slot-needs_permission-breath-068': { kind: 'slot', state: 'needs_permission', title: 'Mobile Entwicklung Northwind', badge: 'APP', wait: 3, frame: 'thick', level: 0.675 },
  'slot-needs_permission-breath-100': { kind: 'slot', state: 'needs_permission', title: 'Mobile Entwicklung Northwind', badge: 'APP', wait: 3, frame: 'thick', level: 1 },
  'slot-needs_permission-seen': { kind: 'slot', state: 'needs_permission', title: 'Mobile Entwicklung Northwind', badge: 'APP', wait: 95, frame: 'thin' },
  'slot-needs_input': { kind: 'slot', state: 'needs_input', title: 'Spec-Review VibeTribe', badge: 'APP', wait: 65, frame: 'thick' },
  'slot-needs_input-breath-035': { kind: 'slot', state: 'needs_input', title: 'Spec-Review VibeTribe', badge: 'APP', wait: 4, frame: 'thick', level: 0.35 },
  'slot-needs_input-seen': { kind: 'slot', state: 'needs_input', title: 'Spec-Review VibeTribe', badge: 'APP', wait: 130, frame: 'thin' },
  'slot-error': { kind: 'slot', state: 'error', title: 'acme', badge: 'WSL', wait: 750, detail: 'server_error', frame: 'thick' },
  'slot-error-seen': { kind: 'slot', state: 'error', title: 'acme', badge: 'WSL', wait: 812, detail: 'billing_error', frame: 'thin' },
  'slot-done_unseen': { kind: 'slot', state: 'done_unseen', title: 'Refactor hub', badge: 'WIN', wait: 190, bgCount: 3 },
  'slot-throttled': { kind: 'slot', state: 'throttled', title: 'Datenmigration', badge: 'APP', detail: 'rate_limit' },
  'slot-working': { kind: 'slot', state: 'working', title: 'Mobile Entwicklung Northwind', badge: 'APP', detail: 'Edit', bgCount: 2, tick: 0 },
  'slot-working-tick1': { kind: 'slot', state: 'working', title: 'Mobile Entwicklung Northwind', badge: 'APP', detail: 'Edit', bgCount: 2, tick: 1 },
  'slot-working-subagent': { kind: 'slot', state: 'working', title: 'Notizen', badge: 'APP', detail: 'Subagent', tick: 2 },
  'slot-background': { kind: 'slot', state: 'background', title: 'Build Pipeline', badge: 'WSL', bgCount: 3, detail: '2 shell · 1 agent' },
  'slot-background-stale': { kind: 'slot', state: 'background', title: 'Build Pipeline', badge: 'WSL', bgStale: true, detail: '2 sh · 1 ag' },
  'slot-idle': { kind: 'slot', state: 'idle', title: 'Notizen', badge: 'APP' },
  'slot-no_signal': { kind: 'slot', state: 'no_signal', title: 'Remote Sandbox', badge: 'REM' },
  'slot-empty': { kind: 'empty' },
  'slot-jumping': { kind: 'slot', state: 'needs_permission', title: 'Mobile Entwicklung Northwind', badge: 'APP', wait: 42, frame: 'thin', jumping: true },
  'slot-title-long': { kind: 'slot', state: 'working', title: 'Mobile Entwicklung Northwind Backend Refactoring', badge: 'WIN', detail: 'Kompaktiert' },
  'slot-title-oneword': { kind: 'slot', state: 'idle', title: 'vibetribe-streamdeck-plugin', badge: 'WSL' },
  'slot-title-umlaut': { kind: 'slot', state: 'done_unseen', title: 'Überprüfung Änderungsprotokoll', badge: 'WSL', wait: 35940 },
  'slot-title-short': { kind: 'slot', state: 'needs_input', title: 'A', badge: '?', wait: 7, frame: 'thin' },
  'slot-title-emoji': { kind: 'slot', state: 'idle', title: '🚀 Launch Checkliste', badge: 'APP' },
  'inbox': { kind: 'inbox', waiting: 2, top: { title: 'Mobile Entwicklung Northwind', state: 'needs_permission', wait: 42 } },
  'inbox-cycling': { kind: 'inbox', waiting: 3, cycle: { index: 2, total: 3 }, top: { title: 'Spec-Review VibeTribe', state: 'needs_input' } },
  'inbox-overflow': { kind: 'inbox', waiting: 1, overflow: 3, top: { title: 'acme', state: 'error' } },
  'inbox-empty': { kind: 'inbox', waiting: 0, top: null },
  'limit-normal': { kind: 'limit', label: '5h', usedPct: 34, pacePct: 40, resetIn: '2h 15m', level: 'neutral' },
  'limit-amber-ahead': { kind: 'limit', label: 'Week', usedPct: 72, pacePct: 55, resetIn: '3d 4h', level: 'amber', ahead: true },
  'limit-red': { kind: 'limit', label: '5h', usedPct: 91, pacePct: 80, resetIn: '38m', level: 'red' },
  'limit-full': { kind: 'limit', label: '5h', usedPct: 100, pacePct: 96, resetIn: '12m', level: 'red', ahead: true },
  'limit-stale': { kind: 'limit', label: '5h', usedPct: 48, pacePct: 50, note: 'As of 14:32', level: 'neutral', stale: true },
  'limit-login': { kind: 'limit', label: 'Week', usedPct: 61, note: 'Sign in', level: 'amber' },
  'limit-empty': { kind: 'limit', label: '5h', usedPct: null, note: 'No data' },
  'limit-new-window': { kind: 'limit', label: '5h', usedPct: 0, pacePct: 0, note: 'New window', level: 'neutral' },
  'extra-normal': { kind: 'extra', used: '€12.40', limit: '€50.00', ratio: 0.248, level: 'neutral' },
  'extra-amber': { kind: 'extra', used: '€38.00', limit: '€50.00', ratio: 0.76, level: 'amber' },
  'extra-red': { kind: 'extra', used: '€47.50', limit: '€50.00', ratio: 0.95, level: 'red' },
  'extra-long': { kind: 'extra', used: '€1,234.56', limit: '€2,000.00', ratio: 0.617, level: 'amber' },
  'extra-nolimit': { kind: 'extra', used: '€12.40', limit: null, ratio: null },
  'extra-stale': { kind: 'extra', used: '€12.40', limit: '€50.00', ratio: 0.248, note: 'As of 14:32', stale: true },
  'extra-login': { kind: 'extra', used: '€12.40', limit: '€50.00', ratio: 0.248, note: 'Sign in' },
  'extra-empty': { kind: 'extra', used: null, limit: null, ratio: null, note: 'No data' },
  'extra-off': { kind: 'extra', used: null, limit: null, ratio: null, note: 'Disabled' },
  'status-expanded': { kind: 'status', expanded: true, rows: [{ source: 'WIN', health: 'ok' }, { source: 'WSL', health: 'stale' }, { source: 'REM', health: 'off' }, { source: 'LIM', health: 'ok' }] },
  'status-ok': { kind: 'status', rows: [{ source: 'WIN', health: 'ok' }, { source: 'WSL', health: 'ok' }, { source: 'REM', health: 'off' }, { source: 'LIM', health: 'ok' }] },
  'status-degraded': { kind: 'status', rows: [{ source: 'WIN', health: 'ok' }, { source: 'WSL', health: 'stale' }, { source: 'REM', health: 'off' }, { source: 'LIM', health: 'missing' }] },
  'status-alert': { kind: 'status', alert: 'Port in use', rows: [{ source: 'WIN', health: 'ok' }, { source: 'WSL', health: 'ok' }, { source: 'REM', health: 'off' }, { source: 'LIM', health: 'ok' }] },
  'status-alert-token': { kind: 'status', alert: 'No token', rows: [{ source: 'WIN', health: 'missing' }, { source: 'WSL', health: 'missing' }, { source: 'REM', health: 'off' }, { source: 'LIM', health: 'missing' }] }
};

let fails = 0;
fs.mkdirSync('out/svg-luftig', { recursive: true }); fs.mkdirSync('out/png-luftig', { recursive: true });
const report = [];
for (const [name, m, variant] of Object.entries(SAMPLES).flatMap(([k, v]) => [[k, v, 'dicht'], [k, v, 'luftig']])) {
  const s = VT.render(m, { variant });
  const sd = variant === 'luftig' ? 'svg-luftig' : 'svg', pd = variant === 'luftig' ? 'png-luftig' : 'png';
  fs.writeFileSync(`out/${sd}/${name}.svg`, s);
  for (const size of [144, 72]) {
    const png = new Resvg(s, { font: F, fitTo: { mode: 'width', value: size } }).render().asPng();
    fs.writeFileSync(`out/${pd}/${name}@${size}.png`, png);
  }
  // measure every <text>
  const texts = [...s.matchAll(/<text [^>]*>[^<]*<\/text>/g)].map(x => x[0]);
  for (const t of texts) {
    const one = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${t}</svg>`;
    const b = new Resvg(one, { font: F }).getBBox();
    if (!b) continue;
    const ok = b.x >= 10 - 0.5 && b.y >= 10 - 0.5 && b.x + b.width <= 134.5 && b.y + b.height <= 134.5;
    const id = /id="([^"]+)"/.exec(t)[1];
    if (!ok) { fails++; report.push(`FAIL ${variant} ${name} ${id} x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} r=${(b.x + b.width).toFixed(1)} b=${(b.y + b.height).toFixed(1)}`); }
    if (/font-size="(\d+)"/.exec(t)[1] < 18) { fails++; report.push(`FAIL size ${variant} ${name} ${id}`); }
  }
}
console.log(report.join('\n') || 'all text inside [10,134], all >= 18px');
console.log(Object.keys(SAMPLES).length, 'tiles, fails:', fails);
