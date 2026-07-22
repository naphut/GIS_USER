import React, { useMemo, useState, useEffect } from 'react';
import { generateAllModulesExcelBlob } from '../../services/telegramBot';

// Storage helper
const getStorageData = (key) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
};

const extractUnit = (item) => {
  if (item.unit) return item.unit;
  const str = String(item.exportWarehouse || item.warehouse || item.unitEntering || item.importRequestCode || item.requestExportCode || item.codeReceipt || '').toUpperCase();
  const VALID_UNITS = [
    'BAN', 'BAT', 'CHA', 'CHH', 'KAM', 'KAN', 'KANZ1', 'KOH', 'KRA',
    'MON', 'ODD', 'PNP', 'PNPZ1', 'PNPZ2', 'PRE', 'PRH', 'PUR', 'ROT',
    'SIE', 'SIH', 'SPE', 'STU', 'SVA', 'TAK', 'THO'
  ];
  for (const u of VALID_UNITS) {
    if (str.includes(u)) return u;
  }
  if (str.includes('KANZ')) return 'KANZ1';
  if (str.includes('PNPZ')) return 'PNPZ1';
  return null;
};

const MainDashboard = ({ onNavigate, user }) => {
  const [isDarkMode] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Filter helper for unit users
  const isUnitUser = user && user.role === 'unit' && user.unit;
  const userUnit = user?.unit;

  const handleExportAll = () => {
    try {
      const unit = isUnitUser ? userUnit : 'ALL';
      const blob = generateAllModulesExcelBlob(unit);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `GIS_DASHBOARD_${unit}_${new Date().toISOString().split('T')[0]}.xls`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export dashboard data:', error);
    }
  };

  // Load data for Module 1: Confirmed Hand Over
  const confirmedStats = useMemo(() => {
    let stockout = getStorageData('kpi_stockout_data') || [];
    let nocreate = getStorageData('kpi_nocreate_data') || [];
    let notconfirmed = getStorageData('kpi_notconfirmed_data') || [];

    let stockoutHistory = getStorageData('kpi_stockout_completionHistory') || [];
    let nocreateHistory = getStorageData('kpi_nocreate_completionHistory') || [];
    let notconfirmedHistory = getStorageData('kpi_notconfirmed_completionHistory') || [];

    if (isUnitUser) {
      const filterFn = item => item.unit === userUnit || extractUnit(item) === userUnit;
      stockout = stockout.filter(filterFn);
      nocreate = nocreate.filter(filterFn);
      notconfirmed = notconfirmed.filter(filterFn);
      stockoutHistory = stockoutHistory.filter(filterFn);
      nocreateHistory = nocreateHistory.filter(filterFn);
      notconfirmedHistory = notconfirmedHistory.filter(filterFn);
    }

    const total = stockout.length + nocreate.length + notconfirmed.length;
    const completed = stockoutHistory.length + nocreateHistory.length + notconfirmedHistory.length;
    const pending = Math.max(0, total - completed);
    const rate = total > 0 ? (completed / total) * 100 : 0;

    return { total, completed, pending, rate };
  }, [isUnitUser, userUnit]);

  // Load data for Module 2: Import CA & Export CA (Signed CA)
  const caStats = useMemo(() => {
    let exportData = getStorageData('export_ca_data') || [];
    let importData = getStorageData('import_ca_data') || [];

    if (isUnitUser) {
      const filterFn = item => item.unit === userUnit || extractUnit(item) === userUnit;
      exportData = exportData.filter(filterFn);
      importData = importData.filter(filterFn);
    }

    const outSigning = exportData.filter(item => item.statusCA === 'Is signing' || item.statusCA === 'Signing');
    const outUnsigned = exportData.filter(item => item.statusCA === 'Unsigned' || !item.statusCA);
    const inSigning = importData.filter(item => item.statusCA === 'Is signing' || item.statusCA === 'Signing');
    const inUnsigned = importData.filter(item => item.statusCA === 'Unsigned' || !item.statusCA);

    const signing = outSigning.length + inSigning.length;
    const unsigned = outUnsigned.length + inUnsigned.length;
    const total = signing + unsigned;
    const rate = total > 0 ? (signing / total) * 100 : 0;

    return { total, signing, unsigned, rate };
  }, [isUnitUser, userUnit]);

  // Load data for Module 3: Restock Requests
  const restockStats = useMemo(() => {
    let restockIn = getStorageData('restock_in_data') || [];
    let restockOut = getStorageData('restock_out_data') || [];
    let restockInHistory = getStorageData('restock_in_completionHistory') || [];
    let restockOutHistory = getStorageData('restock_out_completionHistory') || [];

    if (isUnitUser) {
      const filterFn = item => item.unit === userUnit || extractUnit(item) === userUnit;
      restockIn = restockIn.filter(filterFn);
      restockOut = restockOut.filter(filterFn);
      restockInHistory = restockInHistory.filter(filterFn);
      restockOutHistory = restockOutHistory.filter(filterFn);
    }
    
    const total = restockIn.length + restockOut.length;
    const completed = restockInHistory.length + restockOutHistory.length;
    const pending = Math.max(0, total - completed);
    const rate = total > 0 ? (completed / total) * 100 : 0;

    return { total, completed, pending, rate };
  }, [isUnitUser, userUnit]);

  // Get recent activities
  const recentActivities = useMemo(() => {
    const activities = [];
    
    // Get last 5 completions from stockout
    let stockoutHistory = getStorageData('kpi_stockout_completionHistory') || [];
    if (isUnitUser) {
      stockoutHistory = stockoutHistory.filter(item => item.unit === userUnit || extractUnit(item) === userUnit);
    }
    stockoutHistory.slice(0, 3).forEach(item => {
      if (item.code) {
        activities.push({
          id: `stockout-${item.code}`,
          type: '✅ Completed',
          description: `Stockout: ${item.code}`,
          time: item.completedAt ? new Date(item.completedAt).toLocaleString() : 'Just now',
          unit: item.unit || 'N/A'
        });
      }
    });

    // Get last 5 completions from nocreate
    let nocreateHistory = getStorageData('kpi_nocreate_completionHistory') || [];
    if (isUnitUser) {
      nocreateHistory = nocreateHistory.filter(item => item.unit === userUnit || extractUnit(item) === userUnit);
    }
    nocreateHistory.slice(0, 3).forEach(item => {
      if (item.code) {
        activities.push({
          id: `nocreate-${item.code}`,
          type: '✅ Completed',
          description: `Hand Over: ${item.code}`,
          time: item.completedAt ? new Date(item.completedAt).toLocaleString() : 'Just now',
          unit: item.unit || 'N/A'
        });
      }
    });

    // Sort by time (most recent first)
    activities.sort((a, b) => {
      if (a.time === 'Just now') return -1;
      if (b.time === 'Just now') return 1;
      return new Date(b.time) - new Date(a.time);
    });

    return activities.slice(0, 5);
  }, [isUnitUser, userUnit]);

  const modules = [
    {
      id: 'stockout_group',
      title: 'CONFIRMED HAND OVER',
      subtitle: 'HANDOVER ASSIGNMENT STATUS',
      description: 'តាមដាន និងផ្ទៀងផ្ទាត់ការប្រគល់ភារកិច្ចរវាងបណ្តាខេត្ត។ ត្រួតពិនិត្យគោលដៅការងារពេលព្រឹក និងពេលល្ងាច ហើយផ្ញើរបាយការណ៍ដោយស្វ័យប្រវត្តិទៅកាន់ក្រុម Telegram។',
      icon: (
        <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
      borderColor: 'border-amber-200 dark:border-amber-800/40',
      borderAccent: 'border-t-4 border-t-amber-500',
      bgColor: 'bg-amber-50/40 dark:bg-amber-950/10',
      stats: [
        { label: 'Total Tasks', value: confirmedStats.total, color: 'text-slate-900 dark:text-slate-100' },
        { label: 'Completed', value: confirmedStats.completed, color: 'text-emerald-600 dark:text-emerald-400 font-semibold' },
        { label: 'Pending', value: confirmedStats.pending, color: 'text-amber-600 dark:text-amber-400 font-semibold' },
        { label: 'Success Rate', value: `${confirmedStats.rate.toFixed(1)}%`, color: 'text-indigo-600 dark:text-indigo-400 font-bold' },
      ],
      subtasks: [
        { 
          id: 'STOCKOUT_YET_CONFIRM', 
          label: 'STOCKOUT YET CONFIRM', 
          icon: (
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          ), 
          desc: 'Pending stockout confirmations' 
        },
        { 
          id: 'NO_CREATE_HAND_OVER', 
          label: 'NOT CREATE HAND OVER', 
          icon: (
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          ), 
          desc: 'Handover not yet created' 
        },
        { 
          id: 'STOCK_OUT_NOTE_CONFIRMED', 
          label: 'HAND OVER YET CONFIRM', 
          icon: (
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ), 
          desc: 'Handover awaiting confirmation' 
        }
      ]
    },
    {
      id: 'signed_ca_group',
      title: 'IMPORT CA & EXPORT CA',
      subtitle: 'DIGITAL CA SIGNING OVERVIEW',
      description: 'Manage and review digital signing status. Monitor signing progress for Stock In and Stock Out documents, tracking unsigned vs. fully signed records.',
      icon: (
        <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      borderColor: 'border-indigo-200 dark:border-indigo-800/40',
      borderAccent: 'border-t-4 border-t-indigo-600',
      bgColor: 'bg-indigo-50/40 dark:bg-indigo-950/10',
      stats: [
        { label: 'Total Records', value: caStats.total, color: 'text-slate-900 dark:text-slate-100' },
        { label: 'Is Signing', value: caStats.signing, color: 'text-emerald-600 dark:text-emerald-400 font-semibold' },
        { label: 'Unsigned', value: caStats.unsigned, color: 'text-rose-600 dark:text-rose-400 font-semibold' },
        { label: 'Signed Rate', value: `${caStats.rate.toFixed(1)}%`, color: 'text-indigo-600 dark:text-indigo-400 font-bold' },
      ],
      subtasks: [
        { 
          id: 'STOCK_OUT_IS_SIGNING', 
          label: 'STOCK OUT IS SIGNING', 
          icon: (
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          ), 
          desc: 'Export documents signing' 
        },
        { 
          id: 'STOCK_IN_IS_SIGNING', 
          label: 'STOCK IN IS SIGNING', 
          icon: (
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          ), 
          desc: 'Import documents signing' 
        }
      ]
    },
    {
      id: 'restock_group',
      title: 'RESTOCK IN & RESTOCK OUT',
      subtitle: 'RECALL & WAREHOUSING MANAGEMENT',
      description: 'តាមដាន និងគ្រប់គ្រងដំណើរការ Recall to Stock របស់ METFONE ព្រមទាំងតាមដានស្ថានភាពនៃសម្ភារៈដែលបានស្នើសុំ (Request) សម្រាប់យកទៅប្រើប្រាស់ ដើម្បីធានាថាការចែកចាយ និងការគ្រប់គ្រងស្តុកប្រព្រឹត្តទៅបានត្រឹមត្រូវ មានប្រសិទ្ធភាព និងទាន់ពេលវេលា។',
      icon: (
        <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.5" />
        </svg>
      ),
      borderColor: 'border-emerald-200 dark:border-emerald-800/40',
      borderAccent: 'border-t-4 border-t-emerald-500',
      bgColor: 'bg-emerald-50/40 dark:bg-emerald-950/10',
      stats: [
        { label: 'Total Requests', value: restockStats.total, color: 'text-slate-900 dark:text-slate-100' },
        { label: 'Completed', value: restockStats.completed, color: 'text-emerald-600 dark:text-emerald-400 font-semibold' },
        { label: 'Pending', value: restockStats.pending, color: 'text-amber-600 dark:text-amber-400 font-semibold' },
        { label: 'Restock Rate', value: `${restockStats.rate.toFixed(1)}%`, color: 'text-emerald-600 dark:text-emerald-400 font-bold' },
      ],
      subtasks: [
        { 
          id: 'RESTOCK_IN', 
          label: 'RESTOCK IN', 
          icon: (
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          ), 
          desc: 'Incoming restock requests' 
        },
        { 
          id: 'RESTOCK_OUT', 
          label: 'RESTOCK OUT', 
          icon: (
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          ), 
          desc: 'Outgoing restock requests' 
        }
      ]
    }
  ];

  // Calculate overall stats
  const totalPending = confirmedStats.pending + caStats.unsigned + restockStats.pending;
  const avgCompletion = ((confirmedStats.rate + caStats.rate + restockStats.rate) / 3);
  const totalRecords = confirmedStats.total + caStats.total + restockStats.total;
  const totalCompleted = confirmedStats.completed + caStats.signing + restockStats.completed;

  const chartData = [
    {
      label: 'Confirmed Hand Overs',
      completed: confirmedStats.completed,
      pending: confirmedStats.pending,
      rate: confirmedStats.rate,
      color: '#3b82f6',
      lightColor: 'bg-blue-500',
      accentColor: '#1d4ed8'
    },
    {
      label: 'System Signings',
      completed: caStats.signing,
      pending: caStats.unsigned,
      rate: caStats.rate,
      color: '#10b981',
      lightColor: 'bg-emerald-500',
      accentColor: '#047857'
    },
    {
      label: 'Warehousing Restock',
      completed: restockStats.completed,
      pending: restockStats.pending,
      rate: restockStats.rate,
      color: '#8b5cf6',
      lightColor: 'bg-purple-500',
      accentColor: '#6d28d9'
    }
  ];

  return (
    <div className={`min-h-screen ${isDarkMode ? 'dark' : ''}`}>
      <div className="w-full px-4 sm:px-6 py-6 sm:py-8 bg-slate-50/50 dark:bg-slate-900 transition-colors duration-200">
        
        {/* ─── HEADER BANNER (Clean Developer Look) ─── */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 sm:p-8 mb-6 sm:mb-8 text-white relative shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="bg-slate-800 text-slate-300 text-[10px] sm:text-xs font-mono px-2.5 py-0.5 rounded border border-slate-700">
                  v1.0.0
                </span>
                <span className="bg-slate-800 text-slate-300 text-[10px] sm:text-xs font-semibold px-2.5 py-0.5 rounded border border-slate-700">
                  Enterprise Portal
                </span>
                <span className="bg-emerald-950 text-emerald-400 text-[10px] sm:text-xs font-semibold px-2.5 py-0.5 rounded border border-emerald-800/80 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Active
                </span>
                <span className="bg-slate-800 text-slate-300 text-[10px] sm:text-xs font-mono px-2.5 py-0.5 rounded border border-slate-700">
                  {currentTime.toLocaleTimeString()}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight mt-3 text-white flex items-center gap-2 flex-wrap">
                Daily KPI Management Portal
              </h1>
              {null}
            </div>
            
            <div className="flex flex-col sm:flex-row md:flex-col gap-3 shrink-0 items-start sm:items-center md:items-stretch">
              <div className="flex gap-4 bg-slate-950 p-3.5 rounded-lg border border-slate-800">
                <div className="text-center px-2 border-r border-slate-800">
                  <span className="block text-lg sm:text-xl font-bold font-mono text-indigo-400">
                    {totalPending}
                  </span>
                  <span className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">Pending</span>
                </div>
                <div className="text-center px-2 border-r border-slate-800">
                  <span className="block text-lg sm:text-xl font-bold font-mono text-emerald-400">
                    {totalCompleted}
                  </span>
                  <span className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">Completed</span>
                </div>
                <div className="text-center px-2">
                  <span className="block text-lg sm:text-xl font-bold font-mono text-amber-400">
                    {avgCompletion.toFixed(1)}%
                  </span>
                  <span className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">Avg Rate</span>
                </div>
              </div>
              <button
                onClick={handleExportAll}
                className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold text-xs sm:text-sm py-2 px-4 rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export All Dashboard (Excel)
              </button>
            </div>
          </div>
        </div>

        {/* ─── STATS ROW (Clean Cards with Left Accent lines) ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 sm:mb-8">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200/80 dark:border-slate-700/60 border-l-4 border-l-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">Total Records</div>
                <div className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-1 font-mono">{totalRecords}</div>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200/80 dark:border-slate-700/60 border-l-4 border-l-emerald-500">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">Completed</div>
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono">{totalCompleted}</div>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200/80 dark:border-slate-700/60 border-l-4 border-l-amber-500">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">Pending</div>
                <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1 font-mono">{totalPending}</div>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200/80 dark:border-slate-700/60 border-l-4 border-l-purple-500">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">Avg Completion</div>
                <div className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-1 font-mono">{avgCompletion.toFixed(1)}%</div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── VISUAL PERFORMANCE CHART (Compact Module Layout) ─── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 sm:mb-8">
          {chartData.map((d, index) => {
            const total = d.completed + d.pending;
            const completedPct = total > 0 ? (d.completed / total) * 100 : 0;
            const pendingPct = total > 0 ? (d.pending / total) * 100 : 0;
            
            const radius = 14;
            const circumference = 2 * Math.PI * radius;
            const strokeDashoffset = circumference - (d.rate / 100) * circumference;

            return (
              <div key={index} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700/60 p-3 shadow-sm flex items-center justify-between hover:shadow-md transition-all duration-200">
                {/* Left: Info and Bar */}
                <div className="flex-1 mr-4">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-350 tracking-tight">{d.label}</div>
                  <div className="text-[9px] text-slate-400 dark:text-slate-500 font-mono mt-0.5 font-bold">
                    {d.completed} Done / {d.pending} Pending
                  </div>
                  {/* Compact Thinner progress bar */}
                  <div className="w-full bg-slate-100 dark:bg-slate-700/60 rounded-full h-1.5 overflow-hidden flex mt-2 shadow-inner">
                    {d.completed > 0 && (
                      <div 
                        className="bg-emerald-500 h-full transition-all duration-500"
                        style={{ width: `${completedPct}%` }}
                      ></div>
                    )}
                    {d.pending > 0 && (
                      <div 
                        className="bg-amber-500 h-full transition-all duration-500"
                        style={{ width: `${pendingPct}%` }}
                      ></div>
                    )}
                    {total === 0 && (
                      <div className="w-full h-full bg-slate-100 dark:bg-slate-700"></div>
                    )}
                  </div>
                </div>

                {/* Right: Small Donut gauge */}
                <div className="relative w-10 h-10 shrink-0 flex items-center justify-center">
                  <svg className="w-10 h-10 transform -rotate-90">
                    <circle
                      cx="20"
                      cy="20"
                      r={radius}
                      className="stroke-slate-100 dark:stroke-slate-700/60 fill-none"
                      strokeWidth="3"
                    />
                    <circle
                      cx="20"
                      cy="20"
                      r={radius}
                      className="fill-none transition-all duration-500"
                      stroke={d.color}
                      strokeWidth="3"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="absolute text-[9px] font-black text-slate-800 dark:text-slate-200 font-mono">
                    {total > 0 ? `${d.rate.toFixed(0)}%` : '-'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ─── MAIN GRID (Developer Card Layout) ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
          {modules.map((mod) => (
            <div 
              key={mod.id} 
              className={`bg-white dark:bg-slate-800 rounded-xl border ${mod.borderColor} ${mod.borderAccent} shadow-sm transition-all duration-200 hover:shadow-md flex flex-col overflow-hidden`}
            >
              {/* Card Header (Clean Slate/White background with colored icon) */}
              <div className="p-5 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/10">
                <div className="flex items-center gap-3">
                  <span className="p-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-200/60 dark:border-slate-700/40 shadow-sm shrink-0">
                    {mod.icon}
                  </span>
                  <div>
                    <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 tracking-tight">{mod.title}</h2>
                    <p className="text-slate-400 text-[9px] font-bold tracking-wider uppercase mt-0.5">{mod.subtitle}</p>
                  </div>
                </div>
                <button
                  onClick={() => onNavigate(mod.id)}
                  className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-300 border border-slate-250/80 dark:border-slate-700 rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                >
                  Dashboard ➔
                </button>
              </div>

              {/* Card Body */}
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  {null}

                  {/* Quick Stats Grid */}
                  <div className={`grid grid-cols-2 gap-3 mb-5 ${mod.bgColor} p-3 rounded-lg border ${mod.borderColor}`}>
                    {mod.stats.map((s, idx) => (
                      <div key={idx} className="flex flex-col">
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-wider">{s.label}</span>
                        <span className={`text-sm font-bold font-mono ${s.color}`}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sub-Components Link Section */}
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    Sub Modules
                  </h4>
                  <div className="space-y-2">
                    {mod.subtasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => onNavigate(task.id)}
                        className="w-full flex items-center justify-between p-2.5 rounded-lg border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:border-slate-200 transition-all text-left text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 group/btn cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="p-1 rounded bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 group-hover/btn:bg-white dark:group-hover/btn:bg-slate-800 transition-colors shrink-0">
                            {task.icon}
                          </span>
                          <span className="truncate">{task.label}</span>
                        </div>
                        <span className="text-slate-300 dark:text-slate-600 group-hover/btn:translate-x-0.5 group-hover/btn:text-indigo-500 transition-all text-xs font-mono shrink-0">
                          ➔
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ─── RECENT ACTIVITIES ─── */}
        {recentActivities.length > 0 && (
          <div className="mt-8 bg-white dark:bg-slate-800 rounded-xl border border-slate-200/85 dark:border-slate-700/60 shadow-sm p-6">
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Recent Activities
            </h3>
            <div className="space-y-2">
              {recentActivities.map((activity) => (
                <div key={activity.id} className="flex items-center justify-between p-2.5 bg-slate-50/50 dark:bg-slate-700/40 rounded-lg border border-slate-100 dark:border-slate-700/50">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50 font-mono text-[10px]">
                      {activity.type.replace('✅ ', '')}
                    </span>
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{activity.description}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                    <span>{activity.unit}</span>
                    <span>•</span>
                    <span>{activity.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── FOOTER ─── */}
        <div className="mt-12 text-center text-xs text-slate-400 dark:text-slate-500 border-t pt-6 border-slate-200 dark:border-slate-800">
          <span>© 2026 Daily KPI Management System</span>
          <span className="mx-3">•</span>
          <span>Version 3.0.1</span>
          <span className="mx-3">•</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
            Operational
          </span>
        </div>

        {/* ─── STYLES ─── */}
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .bg-white, .relative, .grid > div {
            animation: fadeIn 0.4s ease-out forwards;
          }
          .grid > div:nth-child(2) { animation-delay: 0.08s; }
          .grid > div:nth-child(3) { animation-delay: 0.15s; }
          
          ::-webkit-scrollbar {
            width: 4px;
            height: 4px;
          }
          ::-webkit-scrollbar-track {
            background: transparent;
          }
          ::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 2px;
          }
          .dark ::-webkit-scrollbar-thumb {
            background: #475569;
          }
        `}</style>
      </div>
    </div>
  );
};

export default MainDashboard;