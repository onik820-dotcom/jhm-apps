import { describe, expect, it } from 'vitest';
import { REPORTS, reportById, reportsForRole, visibleColumns } from './registry';

/**
 * The registry decides who sees which report and which columns. Getting that
 * wrong shows an owner's margin to a pump manager, so it is worth holding in
 * place with tests rather than trusting a reading of the table.
 */
describe('the report registry', () => {
  it('gives every report an id, both languages and a description', () => {
    for (const r of REPORTS) {
      expect(r.id, 'id').toBeTruthy();
      expect(r.en, `${r.id} en`).toBeTruthy();
      expect(r.bn, `${r.id} bn`).toBeTruthy();
      expect(r.descriptionEn, `${r.id} description en`).toBeTruthy();
      expect(r.descriptionBn, `${r.id} description bn`).toBeTruthy();
      expect(r.roles.length, `${r.id} roles`).toBeGreaterThan(0);
    }
  });

  it('has no duplicate ids', () => {
    const ids = REPORTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps profit away from a manager', () => {
    const pl = reportById('profit-loss')!;
    expect(pl.roles).not.toContain('manager');
    expect(pl.roles).toContain('admin');
    expect(pl.roles).toContain('md');
    expect(reportsForRole('manager').map((r) => r.id)).not.toContain('profit-loss');
  });

  it('keeps the audit log to the admin', () => {
    expect(reportById('audit-log')!.roles).toEqual(['admin']);
    expect(reportsForRole('md').map((r) => r.id)).not.toContain('audit-log');
    expect(reportsForRole('manager').map((r) => r.id)).not.toContain('audit-log');
  });

  it('never offers a report to a dispenser', () => {
    for (const r of REPORTS) {
      expect(r.roles, `${r.id}`).not.toContain('dispenser');
    }
  });

  it('strips cost columns from anyone who may not see cost', () => {
    const purchase = reportById('purchase-register')!;

    const owner = visibleColumns(purchase, true).map((c) => c.key);
    expect(owner).toContain('depot_rate');
    expect(owner).toContain('value');

    const manager = visibleColumns(purchase, false).map((c) => c.key);
    expect(manager).not.toContain('depot_rate');
    expect(manager).not.toContain('value');
    // The operational columns stay: a manager still records the delivery.
    expect(manager).toContain('received_litres');
    expect(manager).toContain('shortage_litres');
  });

  it('only totals a column that can be added up', () => {
    for (const r of REPORTS) {
      for (const c of r.columns.filter((x) => x.total)) {
        expect(['money', 'litres', 'number'], `${r.id}.${c.key}`).toContain(c.kind);
      }
    }
  });

  it('gives the two page-shaped reports no columns, and the rest some', () => {
    for (const r of REPORTS) {
      if (r.layout) expect(r.columns, `${r.id}`).toHaveLength(0);
      else expect(r.columns.length, `${r.id}`).toBeGreaterThan(0);
    }
  });

  it('asks for a single date where a range would be meaningless', () => {
    // A daily sheet covers one business day; an ageing report is a snapshot.
    expect(reportById('daily-sheet')!.period).toBe('day');
    expect(reportById('customer-ageing')!.period).toBe('day');
    expect(reportById('profit-loss')!.period).toBe('range');
  });
});
