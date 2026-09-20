import { NextResponse, type NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { getSessionProfile } from '@/lib/supabase/server';
import { reportById, visibleColumns, type ColumnKind } from '@/lib/reports/registry';
import { runReport } from '@/lib/reports/run';
import { businessDate } from '@/lib/format';

/**
 * A report as a real workbook.
 *
 * Built on the server from the same `runReport` the screen uses, so the
 * spreadsheet and the page are the same numbers. Money goes in as a number
 * with a 2-decimal format rather than as text: the accountant is going to
 * select the column and expect a sum, and a column of text sums to nothing.
 * The value is exact — a fixed-point string with two decimals converts to a
 * double and back without loss at any figure this station will see.
 *
 * Bangla renders correctly because Excel does its own text shaping. That is
 * not true of PDF generators, which is why the PDF route is the browser's own
 * print rather than a server-side renderer.
 */

const NUMBER_FORMAT: Partial<Record<ColumnKind, string>> = {
  money: '#,##0.00',
  litres: '#,##0.000',
  percent: '0.0000"%"',
  number: '#,##0',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await getSessionProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const { id } = await params;
  const report = reportById(id);
  if (!report) {
    return NextResponse.json({ error: `No report called ${id}` }, { status: 404 });
  }
  if (!report.roles.includes(profile.role)) {
    return NextResponse.json({ error: 'That report is not open to your role' }, { status: 403 });
  }

  const url = new URL(request.url);
  const today = businessDate();
  const from = url.searchParams.get('from') ?? today;
  const to = url.searchParams.get('to') ?? today;
  const lang = url.searchParams.get('lang') === 'bn' ? 'bn' : 'en';

  const canSeeCost = profile.role === 'admin' || profile.role === 'md';
  const result = await runReport(id, from, to, canSeeCost);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'J.H.M. Filling Station';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(lang === 'bn' ? report.bn : report.en, {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  // ---- a header block, so a printed sheet says what it is -----------------
  sheet.addRow([lang === 'bn' ? 'জে.এইচ.এম. ফিলিং স্টেশন' : 'M/S. J.H.M. Filling Station']);
  sheet.addRow([lang === 'bn' ? report.bn : report.en]);
  sheet.addRow([
    report.period === 'day'
      ? `${lang === 'bn' ? 'তারিখ' : 'Date'}: ${to}`
      : `${lang === 'bn' ? 'সময়কাল' : 'Period'}: ${from} — ${to}`,
  ]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.getRow(2).font = { bold: true, size: 12 };
  sheet.getRow(3).font = { italic: true, size: 10 };

  // The two page-shaped reports have no column grid, so they are written as
  // label/value pairs rather than forced into a table that would misrepresent
  // them.
  if (report.layout) {
    sheet.addRow([]);
    const flat = flatten(result.statement ?? result.sheet);
    sheet.addRow([lang === 'bn' ? 'বিবরণ' : 'Line', lang === 'bn' ? 'পরিমাণ' : 'Value']);
    sheet.getRow(sheet.rowCount).font = { bold: true };
    for (const [label, value] of flat) {
      const row = sheet.addRow([label, value]);
      if (typeof value === 'number') row.getCell(2).numFmt = NUMBER_FORMAT.money!;
    }
    sheet.getColumn(1).width = 44;
    sheet.getColumn(2).width = 20;
  } else {
    const columns = visibleColumns(report, canSeeCost);

    sheet.addRow([]);
    const headerRow = sheet.addRow(columns.map((c) => (lang === 'bn' ? c.bn : c.en)));
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
      cell.border = { bottom: { style: 'thin' } };
    });

    columns.forEach((column, index) => {
      const col = sheet.getColumn(index + 1);
      col.width = column.width ?? (column.kind === 'text' ? 22 : 15);
      const format = NUMBER_FORMAT[column.kind];
      if (format) col.numFmt = format;
    });

    for (const row of result.rows) {
      sheet.addRow(
        columns.map((c) => {
          const value = row[c.key];
          if (value === null || value === undefined || value === '') return null;
          if (c.kind === 'money' || c.kind === 'litres' || c.kind === 'number' || c.kind === 'percent') {
            return Number(value);
          }
          return String(value);
        }),
      );
    }

    if (Object.keys(result.totals).length > 0) {
      const totalRow = sheet.addRow(
        columns.map((c, i) =>
          i === 0
            ? lang === 'bn'
              ? 'মোট'
              : 'Total'
            : result.totals[c.key] !== undefined
              ? Number(result.totals[c.key])
              : null,
        ),
      );
      totalRow.font = { bold: true };
      totalRow.eachCell((cell) => {
        cell.border = { top: { style: 'double' } };
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${id}_${report.period === 'day' ? to : `${from}_${to}`}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** A nested result object as label/value pairs, deepest key last. */
function flatten(value: unknown, prefix = ''): Array<[string, string | number]> {
  const out: Array<[string, string | number]> = [];
  if (value === null || value === undefined) return out;

  if (Array.isArray(value)) {
    value.forEach((item, index) => out.push(...flatten(item, `${prefix}[${index + 1}]`)));
    return out;
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.push(...flatten(child, prefix ? `${prefix} › ${key}` : key));
    }
    return out;
  }

  if (typeof value === 'number') out.push([prefix, value]);
  else if (typeof value === 'boolean') out.push([prefix, value ? 'yes' : 'no']);
  else out.push([prefix, String(value)]);
  return out;
}
