/**
 * The branded PDF of a weekly bundle, drawn with vector graphics (no image
 * files, no headless browser) from the same snapshot as the on-screen charts.
 *
 * pdfkit's built-in fonts cover Western characters only, so rupee amounts are
 * written "Rs" and any non-Latin text from a tender title is dropped rather
 * than printed as garbage; the Excel workbook in the same bundle keeps it all.
 */
import PDFDocument from 'pdfkit';
import { TILE_COLUMNS, TILE_ROWS } from './tilemap.js';

const C = { navy: '#0B2545', blue: '#0066FF', ink: '#0F172A', body: '#334155', mute: '#64748B', line: '#E2E8F0', pale: '#F1F5F9', green: '#047857', red: '#B91C1C', amber: '#B45309' };
const M = 40;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const W = PAGE_W - 2 * M;

const latin = (text) => {
  const clean = String(text ?? '').replace(/₹\s*/g, 'Rs ').replace(/[^\x20-\x7E -ÿ]/g, '').replace(/\s+/g, ' ').trim();
  return clean || '(title not in English)';
};
const rs = (v) => {
  if (v === null || v === undefined) return 'Not published';
  const n = Number(v);
  if (n >= 1e7) return `Rs ${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `Rs ${(n / 1e5).toFixed(2)} Lakh`;
  return `Rs ${Math.round(n).toLocaleString('en-IN')}`;
};
const change = (v) => (v === null || v === undefined ? 'n/a' : `${v > 0 ? '+' : ''}${v}%`);
const changeColor = (v) => (v === null || v === undefined || v === 0 ? C.mute : v > 0 ? C.green : C.red);

function ensure(doc, height) {
  if (doc.y + height > PAGE_H - 60) doc.addPage();
}

/** `need` is how much room the section's first block needs, so a heading is never left alone at a page bottom. */
function heading(doc, text, note, need = 110) {
  ensure(doc, need);
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.navy).text(text, M, doc.y);
  if (note) doc.font('Helvetica').fontSize(8.5).fillColor(C.mute).text(note, M, doc.y + 1, { width: W });
  doc.moveTo(M, doc.y + 4).lineTo(M + W, doc.y + 4).strokeColor(C.line).lineWidth(0.8).stroke();
  doc.y += 12;
}

/** Simple table: columns = [{ header, width, align, value(row), color(row) }]. */
function table(doc, columns, rows, { empty = 'Nothing to show for this week.' } = {}) {
  if (!rows.length) { doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.mute).text(empty, M, doc.y); doc.moveDown(0.5); return; }
  const total = columns.reduce((s, c) => s + c.width, 0);
  const scale = W / total;
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(M, y, W, 18).fill(C.navy);
    let x = M;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
    for (const c of columns) { doc.text(c.header, x + 4, y + 5, { width: c.width * scale - 8, align: c.align ?? 'left', lineBreak: false }); x += c.width * scale; }
    doc.y = y + 20;
  };
  drawHeader();
  rows.forEach((row, i) => {
    if (doc.y + 18 > PAGE_H - 60) { doc.addPage(); drawHeader(); }
    const y = doc.y;
    if (i % 2 === 1) doc.rect(M, y - 2, W, 17).fill(C.pale);
    let x = M;
    doc.font('Helvetica').fontSize(8.5);
    for (const c of columns) {
      doc.fillColor(c.color ? c.color(row) : C.body)
        .text(String(c.value(row)), x + 4, y + 1, { width: c.width * scale - 8, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
      x += c.width * scale;
    }
    doc.y = y + 15;
  });
  doc.moveDown(0.3);
}

function kpi(doc, x, y, w, label, value, sub, subColor = C.mute) {
  doc.roundedRect(x, y, w, 62, 6).fillAndStroke('#FFFFFF', C.line);
  doc.font('Helvetica').fontSize(8).fillColor(C.mute).text(label.toUpperCase(), x + 10, y + 9, { width: w - 20 });
  doc.font('Helvetica-Bold').fontSize(17).fillColor(C.ink).text(value, x + 10, y + 22, { width: w - 20, lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(subColor).text(sub, x + 10, y + 46, { width: w - 20, lineBreak: false });
}

function columnChart(doc, data, { height = 120 } = {}) {
  ensure(doc, height + 40);
  const top = doc.y + 6;
  const max = Math.max(1, ...data.map((d) => d.count));
  const slot = W / data.length;
  data.forEach((d, i) => {
    const h = (d.count / max) * (height - 26);
    const x = M + i * slot + slot * 0.2;
    const last = i === data.length - 1;
    doc.rect(x, top + (height - 26) - h + 10, slot * 0.6, h).fill(last ? C.blue : '#93C5FD');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(String(d.count), x - 6, top + (height - 26) - h - 2, { width: slot * 0.6 + 12, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(C.mute).text(d.label, x - 8, top + height - 2, { width: slot * 0.6 + 16, align: 'center', lineBreak: false });
  });
  doc.y = top + height + 14;
}

function horizontalBars(doc, items, { labelWidth = 130 } = {}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  for (const item of items) {
    ensure(doc, 20);
    const y = doc.y;
    doc.font('Helvetica').fontSize(8.5).fillColor(C.body).text(item.label, M, y + 2, { width: labelWidth, lineBreak: false, ellipsis: true });
    const barW = (W - labelWidth - 50) * (item.count / max);
    doc.rect(M + labelWidth, y + 1, Math.max(item.count ? 2 : 0, barW), 11).fill(item.color ?? C.blue);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(String(item.count), M + labelWidth + barW + 6, y + 2, { lineBreak: false });
    doc.y = y + 17;
  }
}

function tileMap(doc, states) {
  const size = 36;
  const gap = 3;
  const gridW = TILE_COLUMNS * (size + gap);
  const gridH = TILE_ROWS * (size + gap);
  ensure(doc, gridH + 30);
  const left = M + (W - gridW) / 2;
  const top = doc.y + 4;
  const max = Math.max(1, ...states.map((s) => s.count));
  for (const s of states) {
    if (!s.tile) continue;
    const x = left + s.tile[0] * (size + gap);
    const y = top + s.tile[1] * (size + gap);
    const t = s.count / max;
    const fill = !s.inScope ? '#F8FAFC' : s.count === 0 ? '#EEF2F7' : `#${[0x93 - Math.round(0x93 * t * 0.7), 0xC5 - Math.round(0xC5 * t * 0.55), 0xFD - Math.round(0xFD * t * 0.1)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    doc.roundedRect(x, y, size, size, 4).fill(fill);
    const dark = s.inScope && t > 0.45;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(dark ? '#FFFFFF' : s.inScope ? C.navy : '#CBD5E1').text(s.code ?? '', x, y + 8, { width: size, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor(dark ? '#FFFFFF' : s.inScope ? C.body : '#CBD5E1').text(String(s.count), x, y + 21, { width: size, align: 'center', lineBreak: false });
  }
  doc.y = top + gridH + 4;
  doc.font('Helvetica').fontSize(7.5).fillColor(C.mute).text('Each square is one state or UT. Darker blue = more tenders published this week. Pale = outside your scope.', M, doc.y, { width: W, align: 'center' });
}

export function bundlePdf(s) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: 50, left: M, right: M }, bufferPages: true, info: { Title: `Weekly tender intelligence ${s.period.label}`, Author: 'Shan-Deep Management Advisory', Subject: s.organization.name } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Cover band
    doc.rect(0, 0, PAGE_W, 96).fill(C.navy);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#93C5FD').text('SHAN-DEEP TENDER INTELLIGENCE  ·  procure-brain.com', M, 24);
    doc.font('Helvetica-Bold').fontSize(21).fillColor('#FFFFFF').text('Weekly Tender Intelligence', M, 40);
    doc.font('Helvetica').fontSize(11).fillColor('#BFDBFE').text(`${latin(s.organization.name)}  ·  Week of ${s.period.label}`, M, 68);
    doc.y = 112;

    const scopeLine = [s.scope.categories.length ? `Categories: ${s.scope.categories.join(', ')}` : 'All categories', s.scope.states.length ? `States: ${s.scope.states.join(', ')}` : 'All states', s.scope.departments.length ? `Departments: ${s.scope.departments.join(', ')}` : 'All departments'].join('   ·   ');
    doc.font('Helvetica').fontSize(8.5).fillColor(C.mute).text(`Scope (from your ${s.scope.basis}): ${latin(scopeLine)}`, M, doc.y, { width: W });
    doc.moveDown(0.6);

    const y0 = doc.y;
    const kw = (W - 24) / 4;
    const m = s.summary;
    kpi(doc, M, y0, kw, 'Tenders published', String(m.count), `${change(m.changeVsPrevWeekPct)} vs last week`, changeColor(m.changeVsPrevWeekPct));
    kpi(doc, M + kw + 8, y0, kw, 'Published value', rs(m.value), `${change(m.valueChangeVsAveragePct)} vs 4-wk avg`, changeColor(m.valueChangeVsAveragePct));
    kpi(doc, M + 2 * (kw + 8), y0, kw, 'No published value', String(m.undisclosed), `${m.undisclosedSharePct}% of tenders`);
    kpi(doc, M + 3 * (kw + 8), y0, kw, 'Deadlines ahead', String(m.closingWithinTwoWeeks), 'in the next 2 weeks', C.amber);
    doc.y = y0 + 74;

    heading(doc, '1. Volume and value trend', 'Tenders published per week, this week against the previous four.');
    columnChart(doc, s.volumeTrend);
    table(doc, [
      { header: 'Week starting', width: 90, value: (r) => r.label }, { header: 'Tenders', width: 60, align: 'right', value: (r) => r.count },
      { header: 'Published value', width: 110, align: 'right', value: (r) => rs(r.value) }, { header: 'No value published', width: 100, align: 'right', value: (r) => r.undisclosed },
    ], s.volumeTrend);

    heading(doc, '2. Where tenders are being floated', 'State-wise tender map for this week.', 360);
    tileMap(doc, s.states);
    doc.moveDown(0.5);
    const top = s.states.filter((x) => x.count > 0).slice(0, 8);
    table(doc, [
      { header: 'State / UT', width: 160, value: (r) => r.name }, { header: 'Tenders', width: 70, align: 'right', value: (r) => r.count },
      { header: 'Published value', width: 130, align: 'right', value: (r) => rs(r.value) },
    ], top);
    if (s.unmatchedStates) doc.font('Helvetica-Oblique').fontSize(8).fillColor(C.mute).text(`${s.unmatchedStates} further tenders did not name a recognised state and are not on the map.`, M, doc.y);

    heading(doc, '3. Department opportunity', 'Top departments by tenders published, with movement since last week.');
    table(doc, [
      { header: '#', width: 24, value: (r) => r.rank }, { header: 'Department', width: 230, value: (r) => latin(r.department) },
      { header: 'Tenders', width: 55, align: 'right', value: (r) => r.count }, { header: 'vs last week', width: 70, align: 'right', value: (r) => (r.change > 0 ? `+${r.change}` : String(r.change)), color: (r) => changeColor(r.change) },
      { header: 'Published value', width: 100, align: 'right', value: (r) => rs(r.value) },
    ], s.departments);
    if (s.departmentsByValue.length) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.navy).text('Largest by published value', M, doc.y + 2);
      doc.y += 4;
      table(doc, [{ header: 'Department', width: 260, value: (r) => latin(r.department) }, { header: 'Published value', width: 120, align: 'right', value: (r) => rs(r.value) }, { header: 'Tenders', width: 60, align: 'right', value: (r) => r.count }], s.departmentsByValue);
    }

    heading(doc, '4. Value bands', 'Tenders by estimated value. Tenders that published no value form their own band.');
    horizontalBars(doc, s.valueBands.map((b, i) => ({ label: latin(b.label), count: b.count, color: i === 3 ? '#CBD5E1' : C.blue })));

    heading(doc, '5. Demand and pricing pattern', 'Tenders per week in your leading categories, and how typical tender values are moving.');
    table(doc, [
      { header: 'Category', width: 170, value: (r) => latin(r.category) },
      ...s.volumeTrend.map((w, i) => ({ header: w.label, width: 44, align: 'right', value: (r) => r.weeks[i] })),
      { header: 'Change', width: 56, align: 'right', value: (r) => change(r.change), color: (r) => changeColor(r.change) },
    ], s.categoryDemand);
    table(doc, [
      { header: 'Category', width: 150, value: (r) => latin(r.category) }, { header: 'Median this week', width: 100, align: 'right', value: (r) => (r.medianThisWeek === null ? 'too few values' : rs(r.medianThisWeek)) },
      { header: 'Median, prior 4 weeks', width: 110, align: 'right', value: (r) => (r.medianPrior4Weeks === null ? 'too few values' : rs(r.medianPrior4Weeks)) },
      { header: 'Change', width: 60, align: 'right', value: (r) => change(r.changePct), color: (r) => changeColor(r.changePct) },
    ], s.categoryPricing);

    heading(doc, '6. Competition density', 'Average bidders per tender in each leading department, from published results of the last 120 days.');
    table(doc, [
      { header: 'Department', width: 220, value: (r) => latin(r.department) }, { header: 'Results used', width: 80, align: 'right', value: (r) => r.awards },
      { header: 'Avg bidders', width: 80, align: 'right', value: (r) => (r.available ? r.avgBidders : 'not enough data') },
      { header: 'Avg qualified', width: 80, align: 'right', value: (r) => (r.available && r.avgQualified !== null ? r.avgQualified : '-') },
    ], s.competition);

    heading(doc, '7. Critical dates, next two weeks', 'Submission deadlines, pre-bid meetings and bid openings, so nothing lapses while this report is being read.');
    if (!s.calendar.length) doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.mute).text('No critical dates fall in the next two weeks for your scope.', M, doc.y);
    for (const day of s.calendar) {
      ensure(doc, 34);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.navy).text(new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }), M, doc.y + 3);
      for (const item of day.items.slice(0, 12)) {
        ensure(doc, 14);
        doc.font('Helvetica').fontSize(8.5).fillColor(item.type === 'Submission deadline' ? C.red : C.body)
          .text(`${item.type}: ${latin(item.title)}${item.department ? ` (${latin(item.department)})` : ''}`, M + 12, doc.y + 1, { width: W - 12, lineBreak: false, ellipsis: true });
        doc.y += 1;
      }
      if (day.items.length > 12) doc.font('Helvetica-Oblique').fontSize(8).fillColor(C.mute).text(`+ ${day.items.length - 12} more on this day (see the Excel sheet)`, M + 12, doc.y + 1);
    }

    heading(doc, 'About these figures');
    s.notes.forEach((n) => doc.font('Helvetica').fontSize(8.5).fillColor(C.mute).text(`•  ${n}`, M, doc.y + 2, { width: W }));
    doc.font('Helvetica').fontSize(8.5).fillColor(C.mute).text('•  The full data behind every chart is in the Excel sheet delivered with this report.', M, doc.y + 2, { width: W });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      // Footer text sits inside the bottom margin; without this pdfkit would add a blank page after every page.
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(C.mute)
        .text(`Shan-Deep Management Advisory, Bhopal  ·  procure-brain.com  ·  Generated ${new Date(s.generatedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}`, M, PAGE_H - 32, { width: W - 60, lineBreak: false })
        .text(`Page ${i + 1} of ${range.count}`, PAGE_W - M - 60, PAGE_H - 32, { width: 60, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
