import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PR_STATUS,
  isPrApprovedAwaiting,
  isPrAwaitingOwner,
  isPrNeedsRevision,
  isPrPaid,
  prStatusLabel
} from './cmsRequisition';
import {
  amountsSimilar,
  findDuplicateSuspicions,
  tokenOverlap,
  textTokens
} from './requisitionVerify';
import {
  expenseAttemptsFor,
  isDuplicateExpenseError,
  needsProofUpload,
  ownerPaymentBlocker
} from './requisitionPayment';

const day = 86400000;
const iso = (offsetDays: number) => new Date(Date.now() - offsetDays * day).toISOString();

describe('status pengajuan', () => {
  it('antrean Admin Ops tidak menangkap status baru Awaiting Owner Payment', () => {
    // Penjaga bug substring 'awaiting': tanpa ini, pengajuan yang sudah
    // diteruskan ke owner muncul kembali di antrean verifikasi Admin Ops.
    assert.equal(isPrApprovedAwaiting({ status: PR_STATUS.AWAITING_OWNER }), false);
    assert.equal(isPrApprovedAwaiting({ status: PR_STATUS.NEEDS_REVISION }), false);
    assert.equal(isPrApprovedAwaiting({ status: PR_STATUS.APPROVED }), true);
  });

  it('status lama yang bervariasi tetap masuk antrean Admin Ops', () => {
    assert.equal(isPrApprovedAwaiting({ status: 'Approved - awaiting admin' }), true);
  });

  it('Awaiting Owner Payment bukan Paid', () => {
    assert.equal(isPrPaid({ status: PR_STATUS.AWAITING_OWNER }), false);
    assert.equal(isPrAwaitingOwner({ status: PR_STATUS.AWAITING_OWNER }), true);
    assert.equal(isPrNeedsRevision({ status: PR_STATUS.NEEDS_REVISION }), true);
  });

  it('label status baru terbaca manusia', () => {
    assert.equal(prStatusLabel({ status: PR_STATUS.AWAITING_OWNER }), 'Menunggu Bayar Owner');
    assert.equal(prStatusLabel({ status: PR_STATUS.NEEDS_REVISION }), 'Perlu Revisi');
    assert.equal(prStatusLabel({ status: PR_STATUS.PAID }), 'Paid');
  });
});

describe('gerbang pembayaran owner', () => {
  const awaiting = { id: 'r1', status: PR_STATUS.AWAITING_OWNER, amount: 150000 };

  it('owner boleh membayar yang sudah diverifikasi', () => {
    assert.equal(ownerPaymentBlocker(awaiting), null);
  });

  it('owner tidak boleh membayar yang belum diverifikasi Admin Ops', () => {
    const blocker = ownerPaymentBlocker({ id: 'r2', status: PR_STATUS.APPROVED });
    assert.match(String(blocker), /belum diverifikasi/i);
  });

  it('pengajuan yang sudah dibayar ditolak', () => {
    assert.match(String(ownerPaymentBlocker({ id: 'r3', status: PR_STATUS.PAID })), /sudah dibayar/i);
  });
});

describe('pencatatan biaya', () => {
  it('semua jalur fallback menyertakan requisition_id', () => {
    // Inti bug lama: dua jalur fallback menulis biaya tanpa penunjuk ke
    // pengajuan, sehingga biaya ganda tidak bisa dilacak balik.
    const attempts = expenseAttemptsFor({
      req: { id: 'req-9', outlet_id: 'o1', category: 'Bahan', title: 'Deterjen', amount: 90000 },
      paidAmount: 90000
    });
    assert.ok(attempts.length >= 2);
    attempts.forEach((row) => assert.equal(row.requisition_id, 'req-9'));
    attempts.forEach((row) => assert.equal(row.amount, 90000));
  });

  it('pelanggaran indeks unik dikenali sebagai sudah tercatat', () => {
    assert.equal(isDuplicateExpenseError({ code: '23505' }), true);
    assert.equal(
      isDuplicateExpenseError({ message: 'duplicate key value violates unique constraint "expenses_requisition_uniq"' }),
      true
    );
    assert.equal(isDuplicateExpenseError({ message: 'column ghost does not exist' }), false);
  });

  it('Paid tanpa bukti transfer masuk antrean unggah bukti, bukan dianggap error', () => {
    assert.equal(needsProofUpload({ status: PR_STATUS.PAID }), true);
    assert.equal(needsProofUpload({ status: PR_STATUS.PAID, payment_proof_url: 'x.jpg' }), false);
    assert.equal(needsProofUpload({ status: PR_STATUS.AWAITING_OWNER }), false);
  });
});

describe('dugaan pengajuan kembar', () => {
  const base = {
    id: 'a',
    outlet_id: 'o1',
    status: PR_STATUS.APPROVED,
    category: 'Bahan Baku',
    title: 'Restock deterjen 5L',
    amount: 500000,
    created_at: iso(1),
    requested_by: 'Rina'
  };

  it('menandai pengajuan mirip di outlet sama dalam 14 hari', () => {
    const twin = { ...base, id: 'b', created_at: iso(3), amount: 510000 };
    const hits = findDuplicateSuspicions(base, [base, twin]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, 'b');
    assert.ok(hits[0].score >= 0.5);
    assert.ok(hits[0].reasons.some((r) => /nominal mirip/.test(r)));
  });

  it('outlet berbeda bukan kembaran', () => {
    const other = { ...base, id: 'b', outlet_id: 'o2', created_at: iso(3) };
    assert.equal(findDuplicateSuspicions(base, [base, other]).length, 0);
  });

  it('di luar rentang 14 hari tidak ditandai', () => {
    const old = { ...base, id: 'b', created_at: iso(40) };
    assert.equal(findDuplicateSuspicions(base, [base, old]).length, 0);
  });

  it('pengajuan yang sudah ditolak atau dikembalikan tidak ditandai', () => {
    const rejected = { ...base, id: 'b', status: PR_STATUS.REJECTED, created_at: iso(2) };
    const returned = { ...base, id: 'c', status: PR_STATUS.NEEDS_REVISION, created_at: iso(2) };
    assert.equal(findDuplicateSuspicions(base, [base, rejected, returned]).length, 0);
  });

  it('barang berbeda dengan nominal berbeda tidak ditandai', () => {
    const unrelated = {
      ...base,
      id: 'b',
      title: 'Perbaikan mesin dryer',
      category: 'Perawatan',
      amount: 1750000,
      created_at: iso(2)
    };
    assert.equal(findDuplicateSuspicions(base, [base, unrelated]).length, 0);
  });

  it('diurutkan dari yang paling mirip', () => {
    const exact = { ...base, id: 'b', created_at: iso(2) };
    const loose = { ...base, id: 'c', title: 'Deterjen tambahan', amount: 900000, created_at: iso(2) };
    const hits = findDuplicateSuspicions(base, [base, loose, exact]);
    assert.equal(hits[0].id, 'b');
    assert.ok(hits[0].score >= (hits[1]?.score ?? 0));
  });
});

describe('kemiripan teks', () => {
  it('stopword dan angka tidak ikut dihitung', () => {
    const tokens = textTokens('Restock deterjen untuk outlet 2 galon');
    assert.ok(tokens.has('deterjen'));
    assert.ok(tokens.has('galon'));
    assert.equal(tokens.has('untuk'), false);
    assert.equal(tokens.has('outlet'), false);
    assert.equal(tokens.has('2'), false);
  });

  it('deskripsi panjang tidak menenggelamkan kemiripan judul pendek', () => {
    const short = textTokens('Deterjen Attack');
    const long = textTokens('Deterjen Attack dan pewangi Molto serta plastik kemasan besar');
    assert.equal(tokenOverlap(short, long), 1);
  });

  it('nominal mirip dalam toleransi 10%', () => {
    assert.equal(amountsSimilar(500000, 520000), true);
    assert.equal(amountsSimilar(500000, 700000), false);
    assert.equal(amountsSimilar(0, 0), true);
  });
});
