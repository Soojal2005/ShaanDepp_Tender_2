/**
 * The Excel data sheet behind every chart: one worksheet per chart, with the
 * numbers exactly as in the snapshot. Anything not published is written as
 * text so it cannot be mistaken for zero.
 */
import ExcelJS from 'exceljs';

const NAVY = 'FF0B2545';
const NA = 'Not available';

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16, style: c.format ? { numFmt: c.format } : {} }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  rows.forEach((r) => ws.addRow(r));
  return ws;
}

export async function bundleWorkbook(s) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Shan-Deep Tender Intelligence';
  wb.created = new Date(s.generatedAt);

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 44 }, { width: 40 }];
  const info = [
    ['Weekly tender intelligence', ''], ['Organization', s.organization.name], ['Week', s.period.label],
    ['Scope', s.scope.basis], ['Categories', s.scope.categories.join(', ') || 'All'], ['States', s.scope.states.join(', ') || 'All'],
    ['Departments', s.scope.departments.join(', ') || 'All'], ['', ''],
    ['Tenders published this week', s.summary.count], ['Previous week', s.summary.prevWeekCount],
    ['Change vs previous week (%)', s.summary.changeVsPrevWeekPct ?? NA], ['Average of the previous four weeks', s.summary.priorFourWeekAvgCount],
    ['Change vs four-week average (%)', s.summary.changeVsAveragePct ?? NA],
    ['Published value this week (INR)', s.summary.value], ['Tenders with no published value', s.summary.undisclosed],
    ['Submission deadlines in the next two weeks', s.summary.closingWithinTwoWeeks], ['', ''], ...s.notes.map((n) => ['Note', n]),
  ];
  info.forEach((row) => summary.addRow(row));
  summary.getRow(1).font = { bold: true, size: 15 };
  summary.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  sheet(wb, 'Volume trend', [
    { header: 'Week starting', key: 'label', width: 16 }, { header: 'Tenders published', key: 'count', width: 18 },
    { header: 'Published value (INR)', key: 'value', width: 22, format: '#,##0' }, { header: 'No published value', key: 'undisclosed', width: 18 },
  ], s.volumeTrend);

  sheet(wb, 'States', [
    { header: 'State / UT', key: 'name', width: 34 }, { header: 'Code', key: 'code', width: 8 }, { header: 'Tenders', key: 'count', width: 10 },
    { header: 'Published value (INR)', key: 'value', width: 22, format: '#,##0' }, { header: 'In your scope', key: 'scope', width: 14 },
  ], s.states.map((x) => ({ ...x, scope: x.inScope ? 'Yes' : 'No' })));

  sheet(wb, 'Departments', [
    { header: 'Rank', key: 'rank', width: 7 }, { header: 'Department', key: 'department', width: 44 }, { header: 'Tenders', key: 'count', width: 10 },
    { header: 'Previous week', key: 'prevCount', width: 14 }, { header: 'Change', key: 'change', width: 10 },
    { header: 'Published value (INR)', key: 'value', width: 22, format: '#,##0' },
  ], s.departments);

  sheet(wb, 'Value bands', [{ header: 'Band', key: 'label', width: 28 }, { header: 'Tenders', key: 'count', width: 12 }], s.valueBands);

  sheet(wb, 'Category demand', [
    { header: 'Category', key: 'category', width: 34 },
    ...s.volumeTrend.map((w, i) => ({ header: `Week of ${w.label}`, key: `w${i}`, width: 16 })),
    { header: 'Previous 4-week average', key: 'prevAvg', width: 20 }, { header: 'Change (%)', key: 'change', width: 12 },
  ], s.categoryDemand.map((c) => ({ category: c.category, ...Object.fromEntries(c.weeks.map((n, i) => [`w${i}`, n])), prevAvg: c.prevAvg, change: c.change ?? NA })));

  sheet(wb, 'Pricing pattern', [
    { header: 'Category', key: 'category', width: 34 }, { header: 'Median value this week (INR)', key: 'now', width: 26, format: '#,##0' },
    { header: 'Median, previous four weeks (INR)', key: 'prior', width: 30, format: '#,##0' }, { header: 'Change (%)', key: 'change', width: 12 },
    { header: 'Values behind this week', key: 'nNow', width: 18 }, { header: 'Values behind prior weeks', key: 'nPrior', width: 20 },
  ], s.categoryPricing.map((p) => ({
    category: p.category, now: p.medianThisWeek ?? NA, prior: p.medianPrior4Weeks ?? NA, change: p.changePct ?? NA, nNow: p.samplesThisWeek, nPrior: p.samplesPrior,
  })));

  sheet(wb, 'Competition', [
    { header: 'Department', key: 'department', width: 44 }, { header: 'Results (last 120 days)', key: 'awards', width: 22 },
    { header: 'Average bidders', key: 'avgBidders', width: 16 }, { header: 'Average technically qualified', key: 'avgQualified', width: 26 },
  ], s.competition.map((c) => ({ ...c, avgBidders: c.available ? c.avgBidders : 'Not enough result data', avgQualified: c.available ? c.avgQualified ?? NA : '' })));

  sheet(wb, 'Critical dates', [
    { header: 'Date', key: 'date', width: 14 }, { header: 'What', key: 'type', width: 20 }, { header: 'Tender', key: 'title', width: 70 }, { header: 'Department', key: 'department', width: 36 },
  ], s.calendar.flatMap((d) => d.items.map((i) => ({ date: d.date, type: i.type, title: i.title, department: i.department ?? '' }))));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
