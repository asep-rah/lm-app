import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { N8N_EVENT, buildEnvelope } from './n8nEvents';
import { hashToken, isExpired, normalizePhone, parseApprovalDecision, phonesMatch } from './approvalTokens';
import {
  buildRequisitionQueue,
  buildTaskDigest,
  dueSoonTasks,
  openCountByRole,
  overdueTasks
} from './taskDigest';
import { PR_STATUS } from './cmsRequisition';

const hour = 3_600_000;
const NOW = new Date('2026-09-20T12:00:00Z').getTime();
const at = (offsetHours: number) => new Date(NOW + offsetHours * hour).toISOString();

describe('amplop kejadian n8n', () => {
  it('bentuknya stabil — workflow n8n bergantung padanya', () => {
    const env = buildEnvelope(N8N_EVENT.TASK_OVERDUE, { tasks: [] }, new Date(NOW));
    assert.equal(env.event, 'task.overdue');
    assert.equal(env.source, 'lm-app');
    assert.equal(env.sentAt, '2026-09-20T12:00:00.000Z');
    assert.deepEqual(env.data, { tasks: [] });
  });
});

describe('normalisasi nomor WhatsApp', () => {
  it('semua bentuk nomor Indonesia jadi satu', () => {
    // Evolution API bisa mengirim keempat bentuk ini untuk nomor yang sama.
    const forms = ['081234567890', '+6281234567890', '6281234567890', '6281234567890@s.whatsapp.net'];
    const normalized = forms.map(normalizePhone);
    assert.deepEqual(new Set(normalized), new Set(['6281234567890']));
  });

  it('spasi dan tanda hubung tidak membuat nomor berbeda', () => {
    assert.equal(normalizePhone('0812-3456-7890'), '6281234567890');
    assert.equal(normalizePhone(' 0812 3456 7890 '), '6281234567890');
  });

  it('nomor berbeda tidak cocok', () => {
    assert.equal(phonesMatch('081234567890', '6281234567890'), true);
    assert.equal(phonesMatch('081234567890', '081234567891'), false);
  });

  it('nomor kosong tidak pernah cocok', () => {
    // Kalau kosong dianggap cocok, token tanpa nomor bisa dipakai siapa pun.
    assert.equal(phonesMatch('', ''), false);
    assert.equal(phonesMatch(null, '6281234567890'), false);
    assert.equal(normalizePhone(undefined), '');
  });
});

describe('token approval', () => {
  it('hash stabil dan tidak mengembalikan token mentah', () => {
    const h = hashToken('rahasia');
    assert.equal(h, hashToken('rahasia'));
    assert.equal(h.length, 64);
    assert.notEqual(h, 'rahasia');
    assert.notEqual(hashToken('rahasia'), hashToken('rahasia2'));
  });

  it('tanggal kedaluwarsa yang tidak terbaca dianggap kedaluwarsa', () => {
    // Gagal-tertutup: tanggal rusak tidak boleh berarti token abadi.
    assert.equal(isExpired('bukan tanggal', NOW), true);
    assert.equal(isExpired(null, NOW), true);
    assert.equal(isExpired(at(1), NOW), false);
    assert.equal(isExpired(at(-1), NOW), true);
  });

  it('kedaluwarsa tepat saat batas waktu', () => {
    assert.equal(isExpired(new Date(NOW).toISOString(), NOW), true);
  });
});

describe('ringkasan tugas', () => {
  const task = (over: Record<string, unknown>) => ({
    id: Math.random().toString(36).slice(2),
    title: 'Tugas',
    status: 'pending',
    assigned_to_role: 'supervisor',
    ...over
  });

  it('segera jatuh tempo tidak memuat yang sudah terlambat', () => {
    const tasks = [
      task({ due_date: at(-3) }),
      task({ due_date: at(4) }),
      task({ due_date: at(30) })
    ];
    const soon = dueSoonTasks(tasks, NOW, 12);
    assert.equal(soon.length, 1);
    assert.equal(soon[0].hoursLeft, 4);
  });

  it('terlambat tidak memuat yang sudah selesai', () => {
    const tasks = [
      task({ due_date: at(-3) }),
      task({ due_date: at(-5), status: 'completed' })
    ];
    assert.equal(overdueTasks(tasks, NOW).length, 1);
  });

  it('paling mendesak lebih dulu', () => {
    const soon = dueSoonTasks([task({ due_date: at(8) }), task({ due_date: at(2) })], NOW, 12);
    assert.equal(soon[0].hoursLeft, 2);
  });

  it('tugas tanpa tenggat tidak masuk kedua kategori', () => {
    const tasks = [task({ due_date: null })];
    assert.equal(dueSoonTasks(tasks, NOW).length, 0);
    assert.equal(overdueTasks(tasks, NOW).length, 0);
  });

  it('hitungan terbuka per role mengabaikan yang selesai', () => {
    const counts = openCountByRole([
      task({ assigned_to_role: 'supervisor' }),
      task({ assigned_to_role: 'supervisor' }),
      task({ assigned_to_role: 'finance' }),
      task({ assigned_to_role: 'finance', status: 'completed' })
    ]);
    assert.deepEqual(counts, { supervisor: 2, finance: 1 });
  });

  it('digest lengkap membawa ambang yang dipakai', () => {
    const digest = buildTaskDigest([task({ due_date: at(6) })], NOW, 12);
    assert.equal(digest.dueSoonHours, 12);
    assert.equal(digest.generatedAt, '2026-09-20T12:00:00.000Z');
    assert.equal(digest.dueSoon.length, 1);
    assert.equal(digest.overdue.length, 0);
  });
});

describe('membaca keputusan dari balasan WhatsApp', () => {
  it('kata persetujuan dan penolakan yang dikenali', () => {
    ['approve', 'setuju', 'ya', 'YES', ' Ok '].forEach((w) =>
      assert.equal(parseApprovalDecision(w), 'approve', w)
    );
    ['reject', 'tolak', 'no', 'TIDAK'].forEach((w) =>
      assert.equal(parseApprovalDecision(w), 'reject', w)
    );
  });

  it('kalimat yang MENGANDUNG kata setuju tidak dibaca sebagai setuju', () => {
    // Ini yang membedakan cocok-persis dari cocok-substring. "jangan disetujui"
    // yang terbaca sebagai persetujuan berarti uang keluar atas kalimat yang
    // artinya sebaliknya.
    assert.equal(parseApprovalDecision('jangan disetujui dulu'), null);
    assert.equal(parseApprovalDecision('belum ya'), null);
    assert.equal(parseApprovalDecision('tidak setuju'), null);
  });

  it('kosong dan sampah ditolak, tidak ditebak', () => {
    assert.equal(parseApprovalDecision(''), null);
    assert.equal(parseApprovalDecision(null), null);
    assert.equal(parseApprovalDecision(undefined), null);
    assert.equal(parseApprovalDecision('👍'), null);
    assert.equal(parseApprovalDecision({}), null);
  });
});

describe('antrean pengajuan untuk n8n', () => {
  const pr = (over: Record<string, unknown>) => ({
    id: Math.random().toString(36).slice(2),
    title: 'Beli deterjen',
    amount: 150000,
    created_at: at(-2),
    ...over
  });

  it('memisahkan menurut siapa yang sedang ditunggu', () => {
    const q = buildRequisitionQueue(
      [
        pr({ status: PR_STATUS.PENDING }),
        pr({ status: PR_STATUS.APPROVED }),
        pr({ status: PR_STATUS.AWAITING_OWNER }),
        pr({ status: PR_STATUS.PAID })
      ],
      NOW
    );
    assert.equal(q.pendingApproval.length, 1);
    assert.equal(q.awaitingAdminOpsVerification, 1);
    assert.equal(q.awaitingOwnerPayment.length, 1);
  });

  it('membawa id dan nominal — n8n butuh id untuk meminta token approval', () => {
    const q = buildRequisitionQueue([pr({ id: 'pr-1', status: PR_STATUS.PENDING })], NOW);
    assert.equal(q.pendingApproval[0].id, 'pr-1');
    assert.equal(q.pendingApproval[0].amount, 150000);
    assert.equal(q.pendingApproval[0].ageHours, 2);
  });

  it('nominal jatuh ke estimated_cost bila amount belum diisi', () => {
    const q = buildRequisitionQueue(
      [pr({ status: PR_STATUS.PENDING, amount: null, estimated_cost: 90000 })],
      NOW
    );
    assert.equal(q.pendingApproval[0].amount, 90000);
  });

  it('yang paling lama menunggu lebih dulu', () => {
    const q = buildRequisitionQueue(
      [
        pr({ id: 'baru', status: PR_STATUS.PENDING, created_at: at(-1) }),
        pr({ id: 'lama', status: PR_STATUS.PENDING, created_at: at(-40) })
      ],
      NOW
    );
    assert.deepEqual(q.pendingApproval.map((r) => r.id), ['lama', 'baru']);
  });

  it('tahap verifikasi Admin Ops hanya dihitung, rinciannya tidak dikirim keluar', () => {
    const q = buildRequisitionQueue([pr({ status: PR_STATUS.APPROVED })], NOW);
    assert.equal(q.awaitingAdminOpsVerification, 1);
    assert.equal(Array.isArray((q as Record<string, unknown>).awaitingAdminOps), false);
  });

  it('daftar kosong tidak meledak', () => {
    const q = buildRequisitionQueue([], NOW);
    assert.deepEqual(q, { pendingApproval: [], awaitingAdminOpsVerification: 0, awaitingOwnerPayment: [] });
  });
});
