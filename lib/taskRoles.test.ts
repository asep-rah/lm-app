import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTaskAssignedToEmployee, tasksVisibleForEmployee, tasksVisibleForRole } from './taskRoles';

const ANDI = '11111111-1111-4111-8111-111111111111';
const BUDI = '22222222-2222-4222-8222-222222222222';

const timSupervisor = { id: 'x', title: 'Audit mesin', assigned_to_role: 'supervisor' };
const untukAndi = {
  id: 'y',
  title: 'Kunjungan Sampangan',
  assigned_to_role: 'supervisor',
  assigned_to_employee_id: ANDI
};
const untukBudi = {
  id: 'z',
  title: 'Kunjungan Dago',
  assigned_to_role: 'supervisor',
  assigned_to_employee_id: BUDI
};
const timFinance = { id: 'f', title: 'Rekonsiliasi', assigned_to_role: 'finance' };

const semua = [timSupervisor, untukAndi, untukBudi, timFinance];

describe('penugasan ke orang', () => {
  it('cocok hanya untuk id yang sama', () => {
    assert.equal(isTaskAssignedToEmployee(untukAndi, ANDI), true);
    assert.equal(isTaskAssignedToEmployee(untukAndi, BUDI), false);
  });

  it('task tanpa penerima bukan milik siapa pun secara khusus', () => {
    assert.equal(isTaskAssignedToEmployee(timSupervisor, ANDI), false);
  });
});

describe('inbox per orang', () => {
  const andi = { id: ANDI, role: 'supervisor' };

  it('memuat task tim dan task bernama miliknya', () => {
    const hasil = tasksVisibleForEmployee(semua, andi).map((t) => t.id);
    assert.deepEqual(hasil, ['x', 'y']);
  });

  it('menyembunyikan task yang sudah bernama orang lain', () => {
    assert.equal(tasksVisibleForEmployee(semua, andi).includes(untukBudi), false);
  });

  it('tidak membocorkan task role lain', () => {
    assert.equal(tasksVisibleForEmployee(semua, andi).includes(timFinance), false);
  });

  it('owner tetap melihat semuanya', () => {
    assert.equal(tasksVisibleForEmployee(semua, { id: 'o', role: 'owner' }).length, semua.length);
  });

  it('tanpa id sesi, hanya task tim yang terlihat', () => {
    const hasil = tasksVisibleForEmployee(semua, { id: '', role: 'supervisor' }).map((t) => t.id);
    assert.deepEqual(hasil, ['x']);
  });
});

describe('inbox per role lama tidak berubah', () => {
  it('masih mengembalikan seluruh task role tersebut', () => {
    const hasil = tasksVisibleForRole(semua, 'supervisor').map((t) => t.id);
    assert.deepEqual(hasil, ['x', 'y', 'z']);
  });
});
