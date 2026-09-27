import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanPermissions, permissionsForRole, planAppSettingsWrite, sameSettingValue } from './accessControl';

describe('permissionsForRole', () => {
  it('owner always has everything, even if a row says otherwise', () => {
    const p = permissionsForRole('owner', { owner: [] });
    assert.ok(p.has('period.lock') && p.has('settings.profit_share'));
  });
  it('defaults: supervisor may change prices / vouchers / receipt and decide kasbon, not bagi hasil or void', () => {
    const p = permissionsForRole('supervisor', null);
    for (const k of ['settings.services', 'settings.vouchers', 'settings.receipt', 'kasbon.decide', 'view.finance_reports']) assert.ok(p.has(k), k);
    for (const k of ['settings.profit_share', 'settings.outlet_books', 'transaction.void', 'period.lock', 'finance.settlement']) assert.ok(!p.has(k), k);
  });
  it('stored row replaces the default; unknown keys dropped; aliases map to the role', () => {
    const stored = { finance: ['view.finance_reports', 'hack.everything'], kasir: [] };
    assert.deepEqual([...permissionsForRole('head_finance', stored)], ['view.finance_reports']);
    assert.equal(permissionsForRole('pos', stored).size, 0);
    assert.ok(permissionsForRole('supervisor', stored).has('kasbon.decide'));
    assert.deepEqual(cleanPermissions('["kasbon.decide","x"]'), ['kasbon.decide']);
  });
});

describe('planAppSettingsWrite', () => {
  const current = {
    basic_salary: 1500000,
    coa_categories: '["600006 · ATK"]',
    dynamic_services: '[{"id":"s1","price":7000}]',
    outlet_overrides: JSON.stringify({ o1: { s1: { price: 8000 } }, __outlet_books: { o1: { cash: 10 } }, __profit_share: { o1: 30 } })
  };
  const sup = permissionsForRole('supervisor', null);

  it('unchanged columns need no permission (string vs number, JSON string vs object)', () => {
    const { needed } = planAppSettingsWrite({ basic_salary: '1500000', coa_categories: ['600006 · ATK'] }, current, new Set());
    assert.deepEqual(needed, []);
    assert.ok(sameSettingValue('{"a":1,"b":2}', { b: 2, a: 1 }));
  });

  it('price change needs settings.services only', () => {
    const next = JSON.stringify({ ...JSON.parse(current.outlet_overrides), o1: { s1: { price: 9000 } } });
    const { needed } = planAppSettingsWrite({ basic_salary: 1500000, outlet_overrides: next }, current, sup);
    assert.deepEqual(needed, ['settings.services']);
  });

  it('stale copies of other features inside outlet_overrides are restored, not counted', () => {
    const stale = JSON.stringify({ o1: { s1: { price: 8000 } }, __outlet_books: { o1: { cash: 999 } }, __profit_share: { o1: 50 } });
    const { row, needed } = planAppSettingsWrite({ outlet_overrides: stale }, current, sup);
    assert.deepEqual(needed, []);
    const kept = JSON.parse(String(row.outlet_overrides));
    assert.deepEqual(kept.__outlet_books, { o1: { cash: 10 } });
    assert.deepEqual(kept.__profit_share, { o1: 30 });
  });

  it('owner changing bagi hasil through outlet_overrides needs settings.profit_share', () => {
    const owner = permissionsForRole('owner', null);
    const next = { ...JSON.parse(current.outlet_overrides), __profit_share: { o1: 40 } };
    const { row, needed } = planAppSettingsWrite({ profit_share_by_outlet: { o1: 40 }, outlet_overrides: next }, current, owner);
    assert.deepEqual(needed.sort(), ['settings.profit_share']);
    assert.deepEqual((row.outlet_overrides as Record<string, unknown>).__profit_share, { o1: 40 });
  });

  it('a role without the right still reports the change as needed (server refuses)', () => {
    const { needed } = planAppSettingsWrite({ profit_share_by_outlet: { o1: 90 } }, current, sup);
    assert.deepEqual(needed, ['settings.profit_share']);
  });
});
