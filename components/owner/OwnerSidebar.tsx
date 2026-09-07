'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell, ChevronDown, Menu, X } from 'lucide-react';
import { type SettingsPanel } from '@/components/owner/ownerNav';

export type { SettingsPanel };

type Props = {
  open: boolean;
  onClose: () => void;
  activeTab: string;
  settingsPanel: SettingsPanel;
  settingsExpanded: boolean;
  onToggleSettings: () => void;
  onGo: (tab: string, panel?: SettingsPanel) => void;
  canSettings: boolean;
  isOwner: boolean;
  showApprovals?: boolean;
  approvalCount?: number;
  onLogout: () => void;
};

const itemCls = (on: boolean) =>
  `w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition ${
    on ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-100'
  }`;

const subCls = (on: boolean) =>
  `block w-full text-left px-3 py-2 rounded-xl text-xs font-bold ${
    on ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

const PROMO_TABS = ['promos', 'promos-voucher', 'promos-poin', 'crm'];
const LAPORAN_TABS = ['laba-rugi', 'jurnal', 'buku-besar', 'perubahan-modal', 'neraca'];
const PERFORMA_TABS = [
  'kpi',
  'kpi-settings',
  'delegasi',
  'performa-outlet',
  'performa-layanan',
  'performa-karyawan',
  'grafik-pendapatan',
  'grafik-biaya',
  'grafik-promosi'
];

export default function OwnerSidebar({
  open,
  onClose,
  activeTab,
  settingsPanel,
  settingsExpanded,
  onToggleSettings,
  onGo,
  canSettings,
  isOwner,
  showApprovals,
  approvalCount = 0,
  onLogout
}: Props) {
  const [promoOpen, setPromoOpen] = useState(PROMO_TABS.includes(activeTab));
  const [laporanOpen, setLaporanOpen] = useState(LAPORAN_TABS.includes(activeTab));
  const [performaOpen, setPerformaOpen] = useState(PERFORMA_TABS.includes(activeTab));

  useEffect(() => {
    if (PROMO_TABS.includes(activeTab)) setPromoOpen(true);
    if (LAPORAN_TABS.includes(activeTab)) setLaporanOpen(true);
    if (PERFORMA_TABS.includes(activeTab)) setPerformaOpen(true);
  }, [activeTab]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const go = (tab: string, panel?: SettingsPanel) => {
    onGo(tab, panel);
    onClose();
  };

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Tutup menu"
          className="fixed inset-0 z-[70] bg-black/40"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed top-0 left-0 z-[80] h-full w-[min(88vw,300px)] bg-white shadow-2xl border-r border-slate-200 flex flex-col transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Laundrivery</p>
            <p className="text-sm font-black text-slate-900">Menu Owner</p>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center" aria-label="Tutup">
            <X className="w-4 h-4" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <button type="button" onClick={() => go('pnl')} className={itemCls(activeTab === 'pnl')}>Dashboard</button>
          <button type="button" onClick={() => go('history')} className={itemCls(activeTab === 'history')}>Transaksi</button>
          <button type="button" onClick={() => go('loans')} className={itemCls(activeTab === 'loans')}>Kasbon Crew</button>
          {showApprovals && (
            <button type="button" onClick={() => go('approvals')} className={`relative ${itemCls(activeTab === 'approvals')}`}>
              Persetujuan
              {approvalCount > 0 && (
                <span className="ml-2 bg-rose-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{approvalCount > 99 ? '99+' : approvalCount}</span>
              )}
            </button>
          )}

          {canSettings && (
            <div className="pt-1">
              <button
                type="button"
                onClick={onToggleSettings}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold ${
                  activeTab === 'settings' ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                Pengaturan Umum
                <ChevronDown className={`w-4 h-4 transition ${settingsExpanded ? 'rotate-180' : ''}`} />
              </button>
              {settingsExpanded && (
                <div className="mt-1 ml-2 pl-2 border-l-2 border-indigo-100 space-y-0.5">
                  <button type="button" onClick={() => go('settings', 'services')} className={itemCls(activeTab === 'settings' && settingsPanel === 'services')}>Tambah / kelola layanan</button>
                  <button type="button" onClick={() => go('settings', 'outlets')} className={itemCls(activeTab === 'settings' && settingsPanel === 'outlets')}>Kelola outlet</button>
                  <Link href="/owner/settings/outlets" onClick={onClose} className="block px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100">Profil outlet & Google</Link>
                  <Link href="/owner/machines" onClick={onClose} className="block px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100">Manajemen mesin</Link>
                  <button type="button" onClick={() => go('settings', 'supervisor')} className={itemCls(activeTab === 'settings' && settingsPanel === 'supervisor')}>Edit supervisor</button>
                  <button type="button" onClick={() => go('settings', 'receipt')} className={itemCls(activeTab === 'settings' && settingsPanel === 'receipt')}>Edit cetak struk</button>
                  <button type="button" onClick={() => go('settings', 'payroll')} className={itemCls(activeTab === 'settings' && settingsPanel === 'payroll')}>Gaji & COA</button>
                </div>
              )}
            </div>
          )}

          {canSettings && (
            <button type="button" onClick={() => go('employees')} className={itemCls(activeTab === 'employees')}>Karyawan</button>
          )}

          <div>
            <button
              type="button"
              onClick={() => setPromoOpen((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold ${
                PROMO_TABS.includes(activeTab) ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              Promosi
              <ChevronDown className={`w-4 h-4 transition ${promoOpen ? 'rotate-180' : ''}`} />
            </button>
            {promoOpen && (
              <div className="mt-1 ml-2 pl-2 border-l-2 border-amber-100 space-y-0.5">
                <button type="button" onClick={() => go('promos')} className={subCls(activeTab === 'promos')}>Promo / Banner</button>
                <button type="button" onClick={() => go('promos-voucher')} className={subCls(activeTab === 'promos-voucher')}>Voucher</button>
                <button type="button" onClick={() => go('promos-poin')} className={subCls(activeTab === 'promos-poin' || activeTab === 'crm')}>Poin Loyalty</button>
              </div>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setLaporanOpen((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold ${
                LAPORAN_TABS.includes(activeTab) ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              Laporan Keuangan
              <ChevronDown className={`w-4 h-4 transition ${laporanOpen ? 'rotate-180' : ''}`} />
            </button>
            {laporanOpen && (
              <div className="mt-1 ml-2 pl-2 border-l-2 border-emerald-100 space-y-0.5">
                <button type="button" onClick={() => go('laba-rugi')} className={subCls(activeTab === 'laba-rugi')}>Laba Rugi</button>
                <button type="button" onClick={() => go('jurnal')} className={subCls(activeTab === 'jurnal')}>Jurnal</button>
                <button type="button" onClick={() => go('buku-besar')} className={subCls(activeTab === 'buku-besar')}>Buku Besar</button>
                <button type="button" onClick={() => go('perubahan-modal')} className={subCls(activeTab === 'perubahan-modal')}>Perubahan Modal</button>
                <button type="button" onClick={() => go('neraca')} className={subCls(activeTab === 'neraca')}>Neraca</button>
              </div>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setPerformaOpen((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold ${
                PERFORMA_TABS.includes(activeTab) ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              Performa Usaha
              <ChevronDown className={`w-4 h-4 transition ${performaOpen ? 'rotate-180' : ''}`} />
            </button>
            {performaOpen && (
              <div className="mt-1 ml-2 pl-2 border-l-2 border-sky-100 space-y-0.5">
                <button type="button" onClick={() => go('performa-outlet')} className={subCls(activeTab === 'performa-outlet')}>Performa Outlet</button>
                <button type="button" onClick={() => go('performa-layanan')} className={subCls(activeTab === 'performa-layanan')}>Performa Layanan</button>
                <button type="button" onClick={() => go('performa-karyawan')} className={subCls(activeTab === 'performa-karyawan')}>Performa Karyawan</button>
                <button type="button" onClick={() => go('grafik-pendapatan')} className={subCls(activeTab === 'grafik-pendapatan')}>Grafik Pendapatan</button>
                <button type="button" onClick={() => go('grafik-biaya')} className={subCls(activeTab === 'grafik-biaya')}>Grafik Biaya</button>
                <button type="button" onClick={() => go('grafik-promosi')} className={subCls(activeTab === 'grafik-promosi')}>Grafik Promosi</button>
                <button type="button" onClick={() => go('kpi')} className={subCls(activeTab === 'kpi')}>Tabel KPI</button>
                {isOwner && (
                  <button type="button" onClick={() => go('kpi-settings')} className={subCls(activeTab === 'kpi-settings')}>KPI Settings</button>
                )}
                <button type="button" onClick={() => go('delegasi')} className={subCls(activeTab === 'delegasi')}>Delegasi & SLA</button>
              </div>
            )}
          </div>
        </nav>
        <div className="p-3 border-t border-slate-100">
          <button type="button" onClick={onLogout} className="w-full bg-rose-50 text-rose-600 font-bold text-xs py-2.5 rounded-xl">Keluar</button>
        </div>
      </aside>
    </>
  );
}

export function OwnerMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-sm"
      aria-label="Buka menu"
    >
      <Menu className="w-5 h-5" />
    </button>
  );
}

export function OwnerBellButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-10 h-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center hover:bg-slate-200 shrink-0"
      aria-label="Notifikasi pengajuan hapus"
    >
      <Bell className="w-5 h-5" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
