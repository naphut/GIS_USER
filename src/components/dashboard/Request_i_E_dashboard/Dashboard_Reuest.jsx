import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  sendRestockToTelegram, 
  sendToAllRestockTelegram, 
  getAllUnits,
  getConfiguredUnits,
  hasGroupId,
  hasToken,
  getSavedTemplates,
  saveTemplate,
  deleteTemplate,
  sendPhotoToTelegram,
  sendDocumentToTelegram,
  generateRestockExcelBlob,
  cleanWarehouseName
} from '../../../services/telegramBot';
import { loadFromDb, saveToDb, completeStore } from '../../../services/dbStore';
import html2canvas from 'html2canvas';
import { createPortal } from 'react-dom';

// Import the same storage keys from your Restock_in component
const STORAGE_KEYS = {
  DATA: 'restock_in_data',
  COMPLETION: 'restock_in_completionHistory',
  TARGETS: 'restock_in_targets',
  TARGET_HISTORY: 'restock_in_targetHistory',
  CONFIRMED: 'restock_in_confirmedStatus',
};

const getStorageData = (key) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
};

const VALID_UNITS = [
  'BAN', 'BAT', 'CHA', 'CHH', 'KAM', 'KAN', 'KANZ1', 'KOH', 'KRA',
  'MON', 'ODD', 'PNP', 'PNPZ1', 'PNPZ2', 'PRE', 'PRH', 'PUR', 'ROT',
  'SIE', 'SIH', 'SPE', 'STU', 'SVA', 'TAK', 'THO'
];

const getUnitFromRequestCode = (importRequestCode) => {
  if (!importRequestCode) return null;
  const str = String(importRequestCode).toUpperCase();

  // Priority check: Match PNPZ1, PNPZ2, KANZ1 BEFORE generic PNP or KAN!
  if (str.includes('PNPZ1') || str.includes('PNP_Z1') || str.includes('PNP-Z1')) return 'PNPZ1';
  if (str.includes('PNPZ2') || str.includes('PNP_Z2') || str.includes('PNP-Z2')) return 'PNPZ2';
  if (str.includes('KANZ1') || str.includes('KAN_Z1') || str.includes('KAN-Z1')) return 'KANZ1';

  if (str.startsWith('YCNKGIS_')) {
    const parts = str.split('_');
    if (parts.length >= 2) {
      const unitCode = parts[1];
      if (VALID_UNITS.includes(unitCode)) return unitCode;
      if (unitCode === 'KANZ') return 'KANZ1';
      if (unitCode === 'PNPZ') return 'PNPZ1';
    }
  }

  const UNITS_ORDER = [
    'PNPZ1', 'PNPZ2', 'KANZ1',
    'BAN', 'BAT', 'CHA', 'CHH', 'KAM', 'KAN', 'KOH', 'KRA',
    'MON', 'ODD', 'PNP', 'PRE', 'PRH', 'PUR', 'ROT',
    'SIE', 'SIH', 'SPE', 'STU', 'SVA', 'TAK', 'THO'
  ];

  for (const u of UNITS_ORDER) {
    const regex = new RegExp(`(?:^|[^A-Z0-9])${u}(?:[^A-Z0-9]|$)`, 'i');
    if (regex.test(str)) return u;
  }

  return null;
};


const calculateDaysDiff = (dateString) => {
  if (!dateString) return 0;
  const parts = dateString.split(/[/\s:]+/);
  const day = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1;
  let year = parseInt(parts[2]);
  if (year < 100) year += 2000;
  const createdDate = new Date(year, month, day);
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diffTime = currentDate - createdDate;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const Dashboard_Request = ({ user }) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const [data, setData] = useState(() => getStorageData(STORAGE_KEYS.DATA) || []);
  const [completionHistory, setCompletionHistory] = useState(() => getStorageData(STORAGE_KEYS.COMPLETION) || []);
  const [targets, setTargets] = useState(() => getStorageData(STORAGE_KEYS.TARGETS) || {});
  const [confirmedStatus, setConfirmedStatus] = useState(() => getStorageData(STORAGE_KEYS.CONFIRMED) || {});

  // Load Restock Out Data for the combined Performance Table
  const [restockOutData, setRestockOutData] = useState(() => getStorageData('restock_out_data') || []);
  const [restockOutHistory, setRestockOutHistory] = useState(() => getStorageData('restock_out_completionHistory') || []);
  const [restockOutConfirmed, setRestockOutConfirmed] = useState(() => getStorageData('restock_out_confirmedStatus') || {});

  // Telegram bot and unit-level targets state
  const [restockOutTargets, setRestockOutTargets] = useState(() => getStorageData('restock_out_targets') || {});
  const [customNote, setCustomNote] = useState('');

  // Load data from DB on mount
  useEffect(() => {
    const fetchDbData = async () => {
      const dbData = await loadFromDb(STORAGE_KEYS.DATA, []);
      setData(dbData);
      
      const dbCompletion = await loadFromDb(STORAGE_KEYS.COMPLETION, []);
      setCompletionHistory(dbCompletion);

      const dbTargets = await loadFromDb(STORAGE_KEYS.TARGETS, {});
      setTargets(dbTargets);

      const dbConfirmed = await loadFromDb(STORAGE_KEYS.CONFIRMED, {});
      setConfirmedStatus(dbConfirmed);

      const dbOutData = await loadFromDb('restock_out_data', []);
      setRestockOutData(dbOutData);

      const dbOutHistory = await loadFromDb('restock_out_completionHistory', []);
      setRestockOutHistory(dbOutHistory);

      const dbOutConfirmed = await loadFromDb('restock_out_confirmedStatus', {});
      setRestockOutConfirmed(dbOutConfirmed);

      const dbOutTargets = await loadFromDb('restock_out_targets', {});
      setRestockOutTargets(dbOutTargets);

      const dbRestockTargets = await loadFromDb('kpi_restock_targets', null);
      if (dbRestockTargets) {
        setRestockTargets({
          restock_in: { morning: 0, evening: 0, ...dbRestockTargets.restock_in },
          restock_out: { morning: 0, evening: 0, ...dbRestockTargets.restock_out }
        });
      }
    };
    fetchDbData();
  }, []);

  const [savedNotes, setSavedNotes] = useState([]);

  // Fetch templates from database on component mount
  useEffect(() => {
    const loadTemplates = async () => {
      const templates = await getSavedTemplates();
      setSavedNotes(templates);
    };
    loadTemplates();
  }, []);

  const handleSaveNote = async () => {
    if (!customNote.trim()) return;
    if (savedNotes.some(n => n.content === customNote.trim())) return;
    
    const result = await saveTemplate(customNote.trim());
    if (result && !result.error) {
      setSavedNotes(prev => [result, ...prev]);
    } else {
      alert(result.error || 'Failed to save template');
    }
  };

  const handleDeleteNote = async (templateId) => {
    const success = await deleteTemplate(templateId);
    if (success) {
      setSavedNotes(prev => prev.filter(n => n.id !== templateId));
    } else {
      alert('Failed to delete template from database');
    }
  };

  const abortControllerRef = useRef(null);
  const [isSending, setIsSending] = useState(false);
  const [telegramSelectedUnit, setTelegramSelectedUnit] = useState('BAT');
  const [showUnitSelector, setShowUnitSelector] = useState(false);
  const [sendProgress, setSendProgress] = useState(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [sendResults, setSendResults] = useState(null);
  const [screenshotUnit, setScreenshotUnit] = useState(null);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [summaryImageMode, setSummaryImageMode] = useState(false);
  const [isSelectingForSummary, setIsSelectingForSummary] = useState(false);
  const [openBatchDropdown, setOpenBatchDropdown] = useState(false);
  const [openSingleDropdown, setOpenSingleDropdown] = useState(false);

  // Restock KPI Targets State
  const [restockTargets, setRestockTargets] = useState(() => {
    const saved = getStorageData('kpi_restock_targets');
    return saved || {
      restock_in: { morning: 0, evening: 0 },
      restock_out: { morning: 0, evening: 0 }
    };
  });

  const sumInMorning = useMemo(() => {
    return Object.values(targets).reduce((sum, t) => sum + (t?.morning || 0), 0);
  }, [targets]);

  const sumInEvening = useMemo(() => {
    return Object.values(targets).reduce((sum, t) => sum + (t?.evening || 0), 0);
  }, [targets]);

  const sumOutMorning = useMemo(() => {
    return Object.values(restockOutTargets).reduce((sum, t) => sum + (t?.morning || 0), 0);
  }, [restockOutTargets]);

  const sumOutEvening = useMemo(() => {
    return Object.values(restockOutTargets).reduce((sum, t) => sum + (t?.evening || 0), 0);
  }, [restockOutTargets]);

  const [editMorningRestockIn, setEditMorningRestockIn] = useState(restockTargets.restock_in?.morning || sumInMorning);
  const [editEveningRestockIn, setEditEveningRestockIn] = useState(restockTargets.restock_in?.evening || sumInEvening);
  const [editMorningRestockOut, setEditMorningRestockOut] = useState(restockTargets.restock_out?.morning || sumOutMorning);
  const [editEveningRestockOut, setEditEveningRestockOut] = useState(restockTargets.restock_out?.evening || sumOutEvening);

  // Sync inputs if targets state changes
  useEffect(() => {
    setEditMorningRestockIn(restockTargets.restock_in?.morning || sumInMorning);
    setEditEveningRestockIn(restockTargets.restock_in?.evening || sumInEvening);
    setEditMorningRestockOut(restockTargets.restock_out?.morning || sumOutMorning);
    setEditEveningRestockOut(restockTargets.restock_out?.evening || sumOutEvening);
  }, [restockTargets, sumInMorning, sumInEvening, sumOutMorning, sumOutEvening]);

  const handleUpdateRestockIn = () => {
    const updated = {
      ...restockTargets,
      restock_in: { morning: parseInt(editMorningRestockIn) || 0, evening: parseInt(editEveningRestockIn) || 0 }
    };
    setRestockTargets(updated);
    saveToDb('kpi_restock_targets', updated);
  };

  const handleUpdateRestockOut = () => {
    const updated = {
      ...restockTargets,
      restock_out: { morning: parseInt(editMorningRestockOut) || 0, evening: parseInt(editEveningRestockOut) || 0 }
    };
    setRestockTargets(updated);
    saveToDb('kpi_restock_targets', updated);
  };
  const isUnitUser = user && user.role === 'unit' && user.unit;
  const userUnit = user?.unit;

  const [selectedUnit, setSelectedUnit] = useState(isUnitUser ? userUnit : 'all');
  const [timeRange, setTimeRange] = useState('all');

  useEffect(() => {
    if (isUnitUser) {
      setSelectedUnit(userUnit);
    }
  }, [userUnit, isUnitUser]);

  const allUnits = getAllUnits();
  const configured = getConfiguredUnits();
  const totalUnits = allUnits.length;
  const configuredCount = configured.length;

  // Process data with units
  const processedData = useMemo(() => {
    return data.map(item => ({
      ...item,
      unit: item.unit || getUnitFromRequestCode(item.importRequestCode),
      daysDiff: calculateDaysDiff(item.dateCreate),
      isCompleted: completionHistory.some(h => h.importRequestCode === item.importRequestCode) || 
                    confirmedStatus[item.id]
    }));
  }, [data, completionHistory, confirmedStatus]);



  // KPI Calculations
  const kpiData = useMemo(() => {
    const unitStats = {};
    const yearStats = {};
    const monthlyStats = {};
    let totalRequests = 0;
    let totalCompleted = 0;
    let totalPending = 0;
    let totalAlarms = 0;

    processedData.forEach(item => {
      if (!item.unit || !VALID_UNITS.includes(item.unit)) return;

      const unit = item.unit;
      const year = item.year || 'Unknown';
      const isCompleted = item.isCompleted;

      if (!unitStats[unit]) {
        unitStats[unit] = {
          total: 0,
          completed: 0,
          pending: 0,
          alarmCount: 0,
          items: []
        };
      }
      unitStats[unit].total++;
      if (isCompleted) unitStats[unit].completed++;
      else unitStats[unit].pending++;
      if (item.daysDiff > 4) unitStats[unit].alarmCount++;
      unitStats[unit].items.push(item);

      if (!yearStats[year]) {
        yearStats[year] = { total: 0, completed: 0, pending: 0 };
      }
      yearStats[year].total++;
      if (isCompleted) yearStats[year].completed++;
      else yearStats[year].pending++;

      if (item.dateCreate) {
        const parts = item.dateCreate.split(/[/\s:]+/);
        if (parts.length >= 2) {
          const monthKey = `${parts[1]}/${parts[2]}`;
          if (!monthlyStats[monthKey]) {
            monthlyStats[monthKey] = { total: 0, completed: 0, pending: 0 };
          }
          monthlyStats[monthKey].total++;
          if (isCompleted) monthlyStats[monthKey].completed++;
          else monthlyStats[monthKey].pending++;
        }
      }

      totalRequests++;
      if (isCompleted) totalCompleted++;
      else totalPending++;
      if (item.daysDiff > 4) totalAlarms++;
    });

    Object.keys(unitStats).forEach(unit => {
      const target = targets[unit]?.target || 0;
      unitStats[unit].target = target;
      unitStats[unit].progress = target > 0 ? (unitStats[unit].completed / target) * 100 : 0;
    });

    const sortedUnits = Object.entries(unitStats)
      .sort((a, b) => b[1].total - a[1].total);

    return {
      unitStats,
      sortedUnits,
      yearStats,
      monthlyStats,
      summary: {
        totalRequests,
        totalCompleted,
        totalPending,
        totalAlarms,
        completionRate: totalRequests > 0 ? (totalCompleted / totalRequests) * 100 : 0
      }
    };
  }, [processedData, targets]);

  // Filter data based on selected unit and time range
  const filteredData = useMemo(() => {
    let filtered = processedData;

    if (selectedUnit !== 'all') {
      filtered = filtered.filter(item => item.unit === selectedUnit);
    }

    if (timeRange !== 'all') {
      const now = new Date();
      filtered = filtered.filter(item => {
        if (!item.dateCreate) return false;
        const parts = item.dateCreate.split(/[/\s:]+/);
        if (parts.length < 3) return false;
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        let year = parseInt(parts[2]);
        if (year < 100) year += 2000;
        const date = new Date(year, month, day);
        
        switch (timeRange) {
          case 'week': {
            const weekAgo = new Date(now);
            weekAgo.setDate(now.getDate() - 7);
            return date >= weekAgo;
          }
          case 'month': {
            const monthAgo = new Date(now);
            monthAgo.setMonth(now.getMonth() - 1);
            return date >= monthAgo;
          }
          case 'year': {
            const yearAgo = new Date(now);
            yearAgo.setFullYear(now.getFullYear() - 1);
            return date >= yearAgo;
          }
          default: return true;
        }
      });
    }

    return filtered;
  }, [processedData, selectedUnit, timeRange]);

  const filteredKPI = useMemo(() => {
    // 1. Collect active items
    let activeIn = data;
    let activeOut = restockOutData;
    
    // 2. Filter active items by selectedUnit
    if (selectedUnit !== 'all') {
      activeIn = activeIn.filter(item => (item.unit || getUnitFromRequestCode(item.importRequestCode)) === selectedUnit);
      activeOut = activeOut.filter(item => (item.unit || getUnitFromRequestCode(item.requestExportCode)) === selectedUnit);
    }
    
    // 3. Filter completed items from history by selectedUnit
    let completedIn = completionHistory;
    let completedOut = restockOutHistory;
    if (selectedUnit !== 'all') {
      completedIn = completedIn.filter(h => h.unit === selectedUnit);
      completedOut = completedOut.filter(h => h.unit === selectedUnit);
    }
    
    // 4. Calculate stats
    // A. Restock In
    const inUnsigned = activeIn.filter(item => !confirmedStatus[item.id]).length;
    const inConfirmedCount = activeIn.filter(item => confirmedStatus[item.id]).length;
    const inResult = completedIn.length + inConfirmedCount;
    const inTotal = inResult + inUnsigned;
    
    // B. Restock Out
    const outUnsigned = activeOut.filter(item => !restockOutConfirmed[item.id]).length;
    const outConfirmedCount = activeOut.filter(item => restockOutConfirmed[item.id]).length;
    const outResult = completedOut.length + outConfirmedCount;
    const outTotal = outResult + outUnsigned;
    
    // C. Alarms
    const inAlarms = activeIn.filter(item => item.daysDiff > 4 && !confirmedStatus[item.id]).length;
    const outAlarms = activeOut.filter(item => {
      const days = calculateDaysDiff(item.createDate);
      return days > 4 && !restockOutConfirmed[item.id];
    }).length;
    const totalAlarms = inAlarms + outAlarms;
    
    const totalRequests = inTotal + outTotal;
    const totalCompleted = inResult + outResult;
    const totalPending = inUnsigned + outUnsigned;
    
    // Set up unitStats for active units in the filtered view
    const unitStats = {};
    const allUnits = getAllUnits();
    allUnits.forEach(u => {
      const uInUnsigned = activeIn.filter(item => (item.unit || getUnitFromRequestCode(item.importRequestCode)) === u && !confirmedStatus[item.id]).length;
      const uInConfirmed = activeIn.filter(item => (item.unit || getUnitFromRequestCode(item.importRequestCode)) === u && confirmedStatus[item.id]).length;
      const uInResult = completedIn.filter(h => h.unit === u).length + uInConfirmed;
      
      const uOutUnsigned = activeOut.filter(item => (item.unit || getUnitFromRequestCode(item.requestExportCode)) === u && !restockOutConfirmed[item.id]).length;
      const uOutConfirmed = activeOut.filter(item => (item.unit || getUnitFromRequestCode(item.requestExportCode)) === u && restockOutConfirmed[item.id]).length;
      const uOutResult = completedOut.filter(h => h.unit === u).length + uOutConfirmed;
      
      const uTotal = uInUnsigned + uInResult + uOutUnsigned + uOutResult;
      if (uTotal > 0) {
        unitStats[u] = {
          total: uTotal,
          completed: uInResult + uOutResult,
          pending: uInUnsigned + uOutUnsigned,
          alarmCount: activeIn.filter(item => (item.unit || getUnitFromRequestCode(item.importRequestCode)) === u && item.daysDiff > 4 && !confirmedStatus[item.id]).length +
                      activeOut.filter(item => {
                        const uCode = item.unit || getUnitFromRequestCode(item.requestExportCode);
                        const days = calculateDaysDiff(item.createDate);
                        return uCode === u && days > 4 && !restockOutConfirmed[item.id];
                      }).length
        };
      }
    });
    
    return {
      unitStats,
      summary: {
        totalRequests,
        totalCompleted,
        totalPending,
        totalAlarms,
        completionRate: totalRequests > 0 ? (totalCompleted / totalRequests) * 100 : 0
      }
    };
  }, [data, restockOutData, completionHistory, restockOutHistory, confirmedStatus, restockOutConfirmed, selectedUnit]);



  const getAlarmColor = (count) => {
    if (count === 0) return 'text-emerald-600';
    if (count <= 2) return 'text-amber-600';
    if (count <= 5) return 'text-orange-600';
    return 'text-rose-600 font-bold';
  };

  // eslint-disable-next-line no-unused-vars
  const exportToExcel = () => {
    const exportData = filteredData.map(item => ({
      'Unit': item.unit || '-',
      'Import Request Code': item.importRequestCode || '-',
      'Import Command Code': item.importCommandCode || '-',
      'Date Create': item.dateCreate || '-',
      'Import Warehouse': item.importWarehouse || '-',
      'Contract': item.contract || '-',
      'Creator': item.creator || '-',
      'Unit Requests': item.unitRequests || '-',
      'Unit Receive': item.unitReceive || '-',
      'Date Delivery': item.dateDelivery || '-',
      'Status CA': item.statusCA || '-',
      'Days Diff': item.daysDiff || 0,
      'Year': item.year || '-',
      'Completed': item.isCompleted ? '✅ Yes' : '❌ No'
    }));

    if (exportData.length === 0) {
      alert('No data to export');
      return;
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dashboard Data');
    XLSX.writeFile(wb, `dashboard_export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Get unique units for filter
  const availableUnits = useMemo(() => {
    const units = new Set();
    processedData.forEach(item => {
      if (item.unit && VALID_UNITS.includes(item.unit)) {
        units.add(item.unit);
      }
    });
    return Array.from(units).sort();
  }, [processedData]);

  // Restock In metrics calculation
  const restockInResult = useMemo(() => {
    const confirmedCount = data.filter(item => confirmedStatus[item.id]).length;
    return completionHistory.length + confirmedCount;
  }, [data, completionHistory, confirmedStatus]);

  const restockInInSystem = data.length + completionHistory.length;
  const isMorning = new Date().getHours() < 12;
  const restockInMorning = restockTargets.restock_in?.morning || sumInMorning;
  const restockInEvening = restockTargets.restock_in?.evening || sumInEvening;
  const restockInTarget = isMorning ? restockInMorning : (restockInEvening > 0 ? restockInEvening : restockInMorning);
  const restockInConfirmedCount = useMemo(() => data.filter(item => confirmedStatus[item.id]).length, [data, confirmedStatus]);
  const restockInRemain = restockInTarget > 0 ? Math.max(0, restockInTarget - restockInResult) : (data.length - restockInConfirmedCount);
  const restockInRatio = restockInTarget > 0 ? ((restockInResult / restockInTarget) * 100).toFixed(2) : (restockInRemain === 0 ? '100.00' : '0.00');

  // Restock Out metrics calculation
  const restockOutResult = useMemo(() => {
    const confirmedCount = restockOutData.filter(item => restockOutConfirmed[item.id]).length;
    return restockOutHistory.length + confirmedCount;
  }, [restockOutData, restockOutHistory, restockOutConfirmed]);

  const restockOutInSystem = restockOutData.length + restockOutHistory.length;
  const restockOutMorning = restockTargets.restock_out?.morning || sumOutMorning;
  const restockOutEvening = restockTargets.restock_out?.evening || sumOutEvening;
  const restockOutTarget = isMorning ? restockOutMorning : (restockOutEvening > 0 ? restockOutEvening : restockOutMorning);
  const restockOutConfirmedCount = useMemo(() => restockOutData.filter(item => restockOutConfirmed[item.id]).length, [restockOutData, restockOutConfirmed]);
  const restockOutRemain = restockOutTarget > 0 ? Math.max(0, restockOutTarget - restockOutResult) : (restockOutData.length - restockOutConfirmedCount);
  const restockOutRatio = restockOutTarget > 0 ? ((restockOutResult / restockOutTarget) * 100).toFixed(2) : (restockOutRemain === 0 ? '100.00' : '0.00');

  // Combined totals
  const totalRestockMorning = restockInMorning + restockOutMorning;
  const totalRestockEvening = restockInEvening + restockOutEvening;
  const totalRestockResult = restockInResult + restockOutResult;
  const totalRestockInSystem = restockInInSystem + restockOutInSystem;
  const totalRestockTarget = restockInTarget + restockOutTarget;
  const totalRestockRemain = totalRestockTarget > 0 ? Math.max(0, totalRestockTarget - totalRestockResult) : (data.length - restockInConfirmedCount + restockOutData.length - restockOutConfirmedCount);
  const totalRestockRatio = totalRestockTarget > 0 ? ((totalRestockResult / totalRestockTarget) * 100).toFixed(2) : (totalRestockRemain === 0 ? '100.00' : '0.00');

  const getReportData = () => {
    const allUnits = getAllUnits();
    
    const unitsMap = {};
    
    allUnits.forEach(unit => {
      const inUnsigned = data.filter(item => {
        const u = item.unit || getUnitFromRequestCode(item.importRequestCode);
        return u === unit && !confirmedStatus[item.id];
      }).length;
      const inConfirmedCount = data.filter(item => {
        const u = item.unit || getUnitFromRequestCode(item.importRequestCode);
        return u === unit && confirmedStatus[item.id];
      }).length;
      const inResult = completionHistory.filter(h => h.unit === unit).length + inConfirmedCount;
      const inInSystem = inResult + inUnsigned;
      const inMorning = targets[unit]?.morning || 0;
      const inEvening = targets[unit]?.evening || 0;
      const inTarget = isMorning ? inMorning : (inEvening > 0 ? inEvening : inMorning);
      const inRemain = inTarget > 0 ? Math.max(0, inTarget - inResult) : inUnsigned;
      const inRatio = inTarget > 0 ? parseFloat(((inResult / inTarget) * 100).toFixed(2)) : (inRemain === 0 ? 100 : 0);
      
      const outUnsigned = restockOutData.filter(item => {
        const u = item.unit || getUnitFromRequestCode(item.requestExportCode);
        return u === unit && !restockOutConfirmed[item.id];
      }).length;
      const outConfirmedCount = restockOutData.filter(item => {
        const u = item.unit || getUnitFromRequestCode(item.requestExportCode);
        return u === unit && restockOutConfirmed[item.id];
      }).length;
      const outResult = restockOutHistory.filter(h => h.unit === unit).length + outConfirmedCount;
      const outInSystem = outResult + outUnsigned;
      const outMorning = restockOutTargets[unit]?.morning || 0;
      const outEvening = restockOutTargets[unit]?.evening || 0;
      const outTarget = isMorning ? outMorning : (outEvening > 0 ? outEvening : outMorning);
      const outRemain = outTarget > 0 ? Math.max(0, outTarget - outResult) : outUnsigned;
      const outRatio = outTarget > 0 ? parseFloat(((outResult / outTarget) * 100).toFixed(2)) : (outRemain === 0 ? 100 : 0);
      
      const targetMorning = inMorning + outMorning;
      const targetEvening = inEvening + outEvening;
      const unitTotalTarget = inTarget + outTarget;
      const unitTotalResult = inResult + outResult;
      const unitTotalUnsigned = inUnsigned + outUnsigned;
      const unitTotalRemain = unitTotalTarget > 0 ? Math.max(0, unitTotalTarget - unitTotalResult) : unitTotalUnsigned;
      const unitTotalInSystem = inInSystem + outInSystem;
      const unitTotalRatio = unitTotalTarget > 0 ? parseFloat(((unitTotalResult / unitTotalTarget) * 100).toFixed(2)) : (unitTotalRemain === 0 ? 100 : 0);
      
      const unsignedInItemsList = data
        .filter(item => {
          const u = item.unit || getUnitFromRequestCode(item.importRequestCode);
          return u === unit && !confirmedStatus[item.id];
        })
        .map(item => ({
          ...item,
          code: item.importRequestCode || item.code || '',
          daysDiff: item.daysDiff !== undefined ? item.daysDiff : calculateDaysDiff(item.dateCreate),
          unitRequests: item.unitRequests || '-',
          creator: item.creator || '-'
        }));

      const unsignedOutItemsList = restockOutData
        .filter(item => {
          const u = item.unit || getUnitFromRequestCode(item.requestExportCode);
          return u === unit && !restockOutConfirmed[item.id];
        })
        .map(item => ({
          ...item,
          code: item.requestExportCode || item.code || '',
          daysDiff: item.daysDiff !== undefined ? item.daysDiff : calculateDaysDiff(item.createDate),
          groupRequest: item.groupRequest || '-',
          creator: item.creator || '-'
        }));

      unitsMap[unit] = {
        targetMorning,
        targetEvening,
        remain: unitTotalRemain,
        result: unitTotalResult,
        ratio: unitTotalRatio,
        inSystem: unitTotalInSystem,
        restockIn: {
          target: inTarget,
          result: inResult,
          remain: inRemain,
          ratio: inRatio,
          inSystem: inInSystem
        },
        restockOut: {
          target: outTarget,
          result: outResult,
          remain: outRemain,
          ratio: outRatio,
          inSystem: outInSystem
        },
        totalTarget: unitTotalTarget,
        totalResult: unitTotalResult,
        totalRemain: unitTotalRemain,
        totalRatio: unitTotalRatio,
        totalInSystem: unitTotalInSystem,
        unsignedInItems: unsignedInItemsList,
        unsignedOutItems: unsignedOutItemsList
      };
    });
    
    return {
      totalTarget: totalRestockTarget,
      totalResult: totalRestockResult,
      totalRemain: totalRestockRemain,
      totalRatio: parseFloat(totalRestockRatio),
      totalInSystem: totalRestockInSystem,
      restockIn: {
        target: restockInTarget,
        result: restockInResult,
        remain: restockInRemain,
        ratio: parseFloat(restockInRatio),
        inSystem: restockInInSystem
      },
      restockOut: {
        target: restockOutTarget,
        result: restockOutResult,
        remain: restockOutRemain,
        ratio: parseFloat(restockOutRatio),
        inSystem: restockOutInSystem
      },
      units: unitsMap
    };
  };

  // Send Restock reports to ALL units
  const sendToAll = async () => {
    if (isSending) return;
    
    const configured = getConfiguredUnits();
    if (configured.length === 0) {
      alert('⚠️ No group IDs configured! Please add group IDs for at least one province.');
      return;
    }
    
    setIsSending(true);
    setShowProgressModal(true);
    setSendProgress(null);
    setSendResults(null);
    
    abortControllerRef.current = new AbortController();
    
    try {
      const data = getReportData();
      
      const result = await sendToAllRestockTelegram(data, (progress) => {
        setSendProgress(progress);
      }, customNote, abortControllerRef.current.signal);
      
      setSendResults(result.summary);
      
      if (result.summary.success > 0) {
        completeStore(STORAGE_KEYS.DATA);
        completeStore('restock_out_data');
      }
      
      let message = `✅ Report sent to ${result.summary.success}/${result.summary.total} groups`;
      if (result.summary.failed > 0) {
        message += `\n❌ Failed: ${result.summary.failed}`;
        if (result.summary.details) {
          message += `\n\nDetails:\n${result.summary.details.join('\n')}`;
        }
      }
      alert(message);
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Sending cancelled.');
      } else {
        console.error('Error sending to all:', error);
        alert('❌ Error sending reports. Check console for details.');
      }
    } finally {
      setIsSending(false);
      if (!abortControllerRef.current?.signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  // Send Restock report to single unit
  const sendReportToTelegram = async (unit) => {
    if (isSending) return;
    
    if (!hasGroupId(unit)) {
      alert(`⚠️ No group ID configured for ${unit}. Please add it first.`);
      return;
    }

    const reportData = getReportData();
    const unitData = reportData?.units?.[unit];
    const totalItems = (unitData?.unsignedOutItems?.length || 0) + (unitData?.unsignedInItems?.length || 0);
    if (totalItems === 0) {
      alert(`ℹ️ No pending items to send for ${unit}. (គ្មានទិន្នន័យត្រូវផ្ញើទេ)`);
      return;
    }
    
    setIsSending(true);
    setShowProgressModal(true);
    setSendProgress({
      current: 1,
      total: 1,
      unit: unit,
      status: 'sending'
    });
    setSendResults(null);
    
    abortControllerRef.current = new AbortController();
    
    try {
      const data = getReportData();
      const result = await sendRestockToTelegram(unit, data, customNote, abortControllerRef.current.signal);
      
      if (result && result.skipped) {
        setSendProgress({
          current: 1,
          total: 1,
          unit: unit,
          status: 'skipped'
        });
        setSendResults({
          total: 1,
          success: 0,
          failed: 0
        });
        alert(`ℹ️ No pending items to send for ${unit}. (គ្មានទិន្នន័យត្រូវផ្ញើទេ)`);
      } else if (result && result.success) {
        completeStore(STORAGE_KEYS.DATA);
        completeStore('restock_out_data');
        setSendProgress({
          current: 1,
          total: 1,
          unit: unit,
          status: 'success'
        });
        setSendResults({
          total: 1,
          success: 1,
          failed: 0
        });
        alert(`✅ Report sent successfully to ${unit} group!`);
      } else {
        const isAbort = result?.aborted || abortControllerRef.current.signal.aborted;
        setSendProgress({
          current: 1,
          total: 1,
          unit: unit,
          status: 'failed',
          error: isAbort ? 'Cancelled by user' : (result?.error || 'Unknown error')
        });
        setSendResults({
          total: 1,
          success: 0,
          failed: 1
        });
        if (!isAbort) {
          alert(`❌ Failed to send report to ${unit}. ${result?.error || 'Unknown error'}`);
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Single send cancelled.');
      } else {
        console.error('Error sending report:', error);
        alert(`❌ Error sending report: ${error.message}`);
      }
    } finally {
      setIsSending(false);
      setShowUnitSelector(false);
      if (!abortControllerRef.current?.signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  // Send screenshot report to single unit
  const sendReportToTelegramScreenshot = async (unit) => {
    if (isSending) return;
    
    if (!hasGroupId(unit)) {
      alert(`⚠️ No group ID configured for ${unit}. Please add it first.`);
      return;
    }

    const reportData = getReportData();
    const unitData = reportData?.units?.[unit];
    const totalItems = (unitData?.unsignedOutItems?.length || 0) + (unitData?.unsignedInItems?.length || 0);
    if (totalItems === 0) {
      alert(`ℹ️ No pending items to send for ${unit}. (គ្មានទិន្នន័យត្រូវផ្ញើទេ)`);
      return;
    }
    
    setIsSending(true);
    setShowProgressModal(true);
    setSendProgress({
      current: 1,
      total: 1,
      unit: unit,
      status: 'sending'
    });
    setSendResults(null);
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    try {
      setScreenshotUnit(unit);
      await new Promise(resolve => setTimeout(resolve, 60));
      
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      
      const element = document.getElementById('telegram-screenshot-report');
      if (!element) {
        throw new Error('Screenshot element not found in DOM.');
      }
      
      const canvas = await html2canvas(element, {
        width: 1720,
        windowWidth: 1720,
        scale: 2.2,
        useCORS: true,
        logging: false,
        backgroundColor: '#f8fafc',
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDoc) => {
          const clonedEl = clonedDoc.getElementById('telegram-screenshot-report');
          if (clonedEl) {
            clonedEl.style.position = 'static';
            clonedEl.style.top = '0';
            clonedEl.style.left = '0';
            clonedEl.style.zIndex = '1';
            clonedEl.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
            clonedEl.style.webkitFontSmoothing = 'antialiased';
            clonedEl.style.textRendering = 'optimizeLegibility';
          }
        }
      });
      
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas to Blob conversion failed')), 'image/jpeg', 0.80);
      });
      
      const caption = '';
      const result = await sendPhotoToTelegram(unit, blob, caption, signal);

      // Also generate and send Excel document (.xlsx) with 2 sheets
      try {
        const excelBlob = generateRestockExcelBlob(unitData?.unsignedOutItems || [], unitData?.unsignedInItems || [], unit);
        const filename = `RESTOCK_${unit}_${new Date().toISOString().slice(0, 10)}.xls`;
        await sendDocumentToTelegram(unit, excelBlob, filename, '', signal);
      } catch (excelErr) {
        console.error('Error sending Excel file:', excelErr);
      }
      
      if (result && result.success) {
        completeStore(STORAGE_KEYS.DATA);
        completeStore('restock_out_data');
        setSendProgress({
          current: 1,
          total: 1,
          unit: unit,
          status: 'success'
        });
        setSendResults({
          total: 1,
          success: 1,
          failed: 0
        });
        alert(`✅ Screenshot report sent successfully to ${unit} group!`);
      } else {
        const isAbort = result?.aborted || signal.aborted;
        setSendProgress({
          current: 1,
          total: 1,
          unit: unit,
          status: 'failed',
          error: isAbort ? 'Cancelled by user' : (result?.error || 'Unknown error')
        });
        setSendResults({
          total: 1,
          success: 0,
          failed: 1
        });
        if (!isAbort) {
          alert(`❌ Failed to send screenshot report to ${unit}. ${result?.error || 'Unknown error'}`);
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Single screenshot send cancelled.');
      } else {
        console.error('Error sending screenshot report:', error);
        alert(`❌ Error sending screenshot report: ${error.message}`);
      }
    } finally {
      setScreenshotUnit(null);
      setIsSending(false);
      setShowUnitSelector(false);
      if (!abortControllerRef.current?.signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  // Send screenshot reports to all configured units
  const sendToAllScreenshot = async () => {
    const units = getConfiguredUnits();
    if (units.length === 0) {
      alert('⚠️ No group IDs configured. Please add group IDs first.');
      return;
    }
    
    if (isSending) return;
    
    setIsSending(true);
    setShowProgressModal(true);
    setSendResults(null);
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    let successCount = 0;
    let failCount = 0;
    let completedCount = 0;
    const results = [];
    
    try {
      const reportData = getReportData();
      for (const unit of units) {
        if (signal.aborted) {
          results.push({ unit, success: false, error: 'Cancelled', aborted: true });
          failCount++;
          completedCount++;
          continue;
        }

        const unitData = reportData?.units?.[unit];
        const totalItems = (unitData?.unsignedOutItems?.length || 0) + (unitData?.unsignedInItems?.length || 0);
        if (totalItems === 0) {
          completedCount++;
          results.push({ unit, success: true, skipped: true, error: 'No pending items (Skipped)' });
          setSendProgress({
            current: completedCount,
            total: units.length,
            unit: unit,
            status: 'skipped'
          });
          continue;
        }
        
        setSendProgress({
          current: completedCount + 1,
          total: units.length,
          unit: unit,
          status: 'sending'
        });
        
        try {
          setScreenshotUnit(unit);
          await new Promise(resolve => setTimeout(resolve, 60));
          
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          
          const element = document.getElementById('telegram-screenshot-report');
          if (!element) {
            throw new Error('Screenshot element not found in DOM.');
          }
          
          const canvas = await html2canvas(element, {
            width: 1720,
            windowWidth: 1720,
            scale: 2.2,
            useCORS: true,
            logging: false,
            backgroundColor: '#f8fafc',
            scrollX: 0,
            scrollY: 0,
            onclone: (clonedDoc) => {
              const clonedEl = clonedDoc.getElementById('telegram-screenshot-report');
              if (clonedEl) {
                clonedEl.style.position = 'static';
                clonedEl.style.top = '0';
                clonedEl.style.left = '0';
                clonedEl.style.zIndex = '1';
                clonedEl.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
                clonedEl.style.webkitFontSmoothing = 'antialiased';
                clonedEl.style.textRendering = 'optimizeLegibility';
              }
            }
          });
          
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          
          const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas to Blob conversion failed')), 'image/jpeg', 0.80);
          });
          
          const caption = '';
          const sendRes = await sendPhotoToTelegram(unit, blob, caption, signal);

          // Also generate and send Excel document (.xlsx) with 2 sheets
          try {
            const excelBlob = generateRestockExcelBlob(unitData?.unsignedOutItems || [], unitData?.unsignedInItems || [], unit);
            const filename = `RESTOCK_${unit}_${new Date().toISOString().slice(0, 10)}.xls`;
            await sendDocumentToTelegram(unit, excelBlob, filename, '', signal);
          } catch (excelErr) {
            console.error('Error sending Excel file:', excelErr);
          }
          
          completedCount++;
          results.push({ unit, ...sendRes });
          
          if (sendRes && sendRes.success) {
            successCount++;
            setSendProgress({
              current: completedCount,
              total: units.length,
              unit: unit,
              status: 'success'
            });
          } else {
            failCount++;
            setSendProgress({
              current: completedCount,
              total: units.length,
              unit: unit,
              status: 'failed',
              error: sendRes?.error || 'Unknown error'
            });
          }
        } catch (unitErr) {
          completedCount++;
          failCount++;
          results.push({ unit, success: false, error: unitErr.message });
          setSendProgress({
            current: completedCount,
            total: units.length,
            unit: unit,
            status: 'failed',
            error: unitErr.message
          });
        }
        
        if (completedCount < units.length && !signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      if (successCount > 0) {
        completeStore(STORAGE_KEYS.DATA);
        completeStore('restock_out_data');
      }
      
      setSendResults({
        total: units.length,
        success: successCount,
        failed: failCount
      });
    } catch (err) {
      console.error('Error in send all screenshot:', err);
    } finally {
      setScreenshotUnit(null);
      setIsSending(false);
      if (!abortControllerRef.current?.signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  // Send Summary Image screenshot for a single unit
  const sendSummaryImageScreenshot = async (unit, signal = null) => {
    if (isSending) return;
    
    if (!hasGroupId(unit)) {
      alert(`⚠️ No group ID configured for ${unit}. Please add it first.`);
      return;
    }

    const reportData = getReportData();
    const uData = reportData?.units?.[unit];
    const totalPendingItems = (uData?.unsignedOutItems?.length || 0) + (uData?.unsignedInItems?.length || 0);
    if (totalPendingItems === 0) {
      alert(`ℹ️ សាខា ${unit} គ្មានទិន្នន័យត្រូវផ្ញើទេ (រំលងចោល)`);
      return;
    }

    setIsSending(true);
    setShowProgressModal(true);
    setSendProgress({
      current: 1,
      total: 1,
      unit: unit,
      status: 'sending'
    });
    setSendResults(null);

    if (!signal) {
      abortControllerRef.current = new AbortController();
    }
    const activeSignal = signal || abortControllerRef.current.signal;

    try {
      setSummaryImageMode(true);
      setScreenshotUnit(unit);
      await new Promise(resolve => setTimeout(resolve, 60));

      if (activeSignal.aborted) throw new DOMException('Aborted', 'AbortError');

      const element = document.getElementById('telegram-summary-report');
      if (!element) throw new Error('Summary element not found in DOM.');

      const canvas = await html2canvas(element, {
        width: 1600,
        windowWidth: 1600,
        scale: 2.0,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      if (activeSignal.aborted) throw new DOMException('Aborted', 'AbortError');

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas to Blob conversion failed')), 'image/jpeg', 0.80);
      });

      const caption = '';
      const result = await sendPhotoToTelegram(unit, blob, caption, activeSignal);

      if (result && result.success) {
        setSendProgress({ current: 1, total: 1, unit, status: 'success' });
        setSendResults({ total: 1, success: 1, failed: 0 });
      } else {
        setSendProgress({ current: 1, total: 1, unit, status: 'failed', error: result?.error || 'Unknown error' });
        setSendResults({ total: 1, success: 0, failed: 1 });
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Summary image single send cancelled.');
      } else {
        console.error('Error sending summary image:', error);
        setSendProgress({ current: 1, total: 1, unit, status: 'failed', error: error.message });
        setSendResults({ total: 1, success: 0, failed: 1 });
      }
    } finally {
      setSummaryImageMode(false);
      setIsSending(false);
      setShowUnitSelector(false);
      if (!abortControllerRef.current?.signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  // Send Summary Image screenshot to ALL configured units
  const sendSummaryImageScreenshotAll = async () => {
    if (isSending) return;
    
    const units = configured;
    if (units.length === 0) {
      alert('⚠️ No group IDs configured! Please add group IDs for at least one province.');
      return;
    }

    setIsSending(true);
    setShowProgressModal(true);
    setSendProgress({ current: 0, total: units.length, unit: '', status: 'sending' });
    setSendResults(null);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    let completedCount = 0;
    let successCount = 0;
    let failCount = 0;
    const results = [];

    try {
      setSummaryImageMode(true);
      const reportData = getReportData();
      for (const unit of units) {
        if (signal.aborted) break;

        const uData = reportData?.units?.[unit];
        const totalItems = (uData?.unsignedOutItems?.length || 0) + (uData?.unsignedInItems?.length || 0);
        if (totalItems === 0) {
          completedCount++;
          results.push({ unit, success: true, skipped: true, error: 'No pending items (Skipped)' });
          setSendProgress({
            current: completedCount,
            total: units.length,
            unit: unit,
            status: 'skipped'
          });
          continue;
        }

        try {
          setScreenshotUnit(unit);
          await new Promise(resolve => setTimeout(resolve, 60));

          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

          const element = document.getElementById('telegram-summary-report');
          if (!element) throw new Error('Summary element not found in DOM.');

          const canvas = await html2canvas(element, {
            width: 1600,
            windowWidth: 1600,
            scale: 2.0,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff'
          });

          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

          const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas to Blob conversion failed')), 'image/jpeg', 0.80);
          });

          const caption = '';
          const sendRes = await sendPhotoToTelegram(unit, blob, caption, signal);

          completedCount++;
          results.push({ unit, ...sendRes });

          if (sendRes && sendRes.success) {
            successCount++;
            setSendProgress({ current: completedCount, total: units.length, unit, status: 'success' });
          } else {
            failCount++;
            setSendProgress({ current: completedCount, total: units.length, unit, status: 'failed', error: sendRes?.error || 'Unknown error' });
          }
        } catch (unitErr) {
          completedCount++;
          failCount++;
          results.push({ unit, success: false, error: unitErr.message });
          setSendProgress({ current: completedCount, total: units.length, unit, status: 'failed', error: unitErr.message });
        }

        if (completedCount < units.length && !signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      setSendResults({ total: units.length, success: successCount, failed: failCount });
    } catch (err) {
      console.error('Error in send all summary images:', err);
    } finally {
      setSummaryImageMode(false);
      setScreenshotUnit(null);
      setIsSending(false);
      if (!abortControllerRef.current?.signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  // Render offscreen Summary Image report for Telegram matching exact Excel table layout (Unit + TEAM)
  const renderSummaryReport = () => {
    if (!summaryImageMode || !screenshotUnit) return null;

    const unitsList = ['BAN', 'BAT', 'CHA', 'CHH', 'KAM', 'KAN', 'KANZ1', 'KOH', 'KRA', 'MON', 'ODD', 'PNP', 'PNPZ1', 'PNPZ2', 'PRE', 'PRH', 'PUR', 'ROT', 'SIE', 'SIH', 'SPE', 'STU', 'SVA', 'TAK', 'THO'];

    const getInTeamName = (item) => {
      const raw = item.unitRequests || item.unitReceive || item.importWarehouse || item.warehouse || '-';
      return cleanWarehouseName(raw);
    };

    const getOutTeamName = (item) => {
      const raw = item.groupRequest || item.receivingUnit || item.stockOut || item.stockReceive || item.warehouse || '-';
      return cleanWarehouseName(raw);
    };

    const unitsToProcess = (screenshotUnit && screenshotUnit !== 'ALL' && unitsList.includes(screenshotUnit))
      ? [screenshotUnit]
      : unitsList;

    const teamRows = [];

    unitsToProcess.forEach(u => {
      // Extract all live database items for target unit u
      const allInForUnit = data.filter(item => {
        const unit = item.unit || getUnitFromRequestCode(item.importRequestCode);
        return unit === u;
      });

      const allOutForUnit = restockOutData.filter(item => {
        const unit = item.unit || getUnitFromRequestCode(item.requestExportCode);
        return unit === u;
      });

      const teamMap = {};

      // Collect distinct teams from live RESTOCK IN items using Unit Requests
      allInForUnit.forEach(item => {
        const t = getInTeamName(item);
        if (!t || t === '-') return;
        if (!teamMap[t]) teamMap[t] = { inItems: [], outItems: [] };
        if (!confirmedStatus[item.id]) {
          const days = item.daysDiff !== undefined ? item.daysDiff : calculateDaysDiff(item.dateCreate);
          teamMap[t].inItems.push({ ...item, daysDiff: days });
        }
      });

      // Collect distinct teams from live RESTOCK OUT items using Group request
      allOutForUnit.forEach(item => {
        const t = getOutTeamName(item);
        if (!t || t === '-') return;
        if (!teamMap[t]) teamMap[t] = { inItems: [], outItems: [] };
        if (!restockOutConfirmed[item.id]) {
          const days = item.daysDiff !== undefined ? item.daysDiff : calculateDaysDiff(item.createDate);
          teamMap[t].outItems.push({ ...item, daysDiff: days });
        }
      });

      let teamNames = Object.keys(teamMap).sort();

      teamNames.forEach(tName => {
        const tData = teamMap[tName] || { inItems: [], outItems: [] };
        const tIn = tData.inItems;
        const tOut = tData.outItems;

        // Cat 1: Request import but NOT CREATED COMMAND YET
        const cat1_d1 = tIn.filter(i => (parseInt(i.daysDiff) || 0) <= 7).length;
        const cat1_d2 = tIn.filter(i => (parseInt(i.daysDiff) || 0) > 7 && (parseInt(i.daysDiff) || 0) < 30).length;
        const cat1_d3 = tIn.filter(i => (parseInt(i.daysDiff) || 0) >= 30).length;
        const cat1_tot = cat1_d1 + cat1_d2 + cat1_d3;

        // Cat 2: Request export command but REJECTED
        const cat2_items = tOut.filter(i => i.commandExportCode || i.commandCode);
        const cat2_d1 = cat2_items.filter(i => (parseInt(i.daysDiff) || 0) <= 7).length;
        const cat2_d2 = cat2_items.filter(i => (parseInt(i.daysDiff) || 0) > 7 && (parseInt(i.daysDiff) || 0) < 30).length;
        const cat2_d3 = cat2_items.filter(i => (parseInt(i.daysDiff) || 0) >= 30).length;
        const cat2_tot = cat2_d1 + cat2_d2 + cat2_d3;

        // Cat 3: Request export but NOT CREATED COMMAND YET
        const cat3_items = tOut.filter(i => !i.commandExportCode && !i.commandCode);
        const cat3_d1 = cat3_items.filter(i => (parseInt(i.daysDiff) || 0) <= 7).length;
        const cat3_d2 = cat3_items.filter(i => (parseInt(i.daysDiff) || 0) > 7 && (parseInt(i.daysDiff) || 0) < 30).length;
        const cat3_d3 = cat3_items.filter(i => (parseInt(i.daysDiff) || 0) >= 30).length;
        const cat3_tot = cat3_d1 + cat3_d2 + cat3_d3;

        // Overall Totals
        const tot_d1 = cat1_d1 + cat2_d1 + cat3_d1;
        const tot_d2 = cat1_d2 + cat2_d2 + cat3_d2;
        const tot_d3 = cat1_d3 + cat2_d3 + cat3_d3;
        const tot_all = tot_d1 + tot_d2 + tot_d3;

        // Only include team row if tot_all > 0 (Never display empty 0-item team rows!)
        if (tot_all > 0) {
          teamRows.push({
            unit: u,
            team: tName,
            tot_d1, tot_d2, tot_d3, tot_all,
            cat1_d1, cat1_d2, cat1_d3, cat1_tot,
            cat2_d1, cat2_d2, cat2_d3, cat2_tot,
            cat3_d1, cat3_d2, cat3_d3, cat3_tot
          });
        }
      });
    });

    // Calculate grand totals across all rendered rows
    const grandTotals = {
      tot_d1: teamRows.reduce((sum, r) => sum + r.tot_d1, 0),
      tot_d2: teamRows.reduce((sum, r) => sum + r.tot_d2, 0),
      tot_d3: teamRows.reduce((sum, r) => sum + r.tot_d3, 0),
      tot_all: teamRows.reduce((sum, r) => sum + r.tot_all, 0),
      cat1_d1: teamRows.reduce((sum, r) => sum + r.cat1_d1, 0),
      cat1_d2: teamRows.reduce((sum, r) => sum + r.cat1_d2, 0),
      cat1_d3: teamRows.reduce((sum, r) => sum + r.cat1_d3, 0),
      cat1_tot: teamRows.reduce((sum, r) => sum + r.cat1_tot, 0),
      cat2_d1: teamRows.reduce((sum, r) => sum + r.cat2_d1, 0),
      cat2_d2: teamRows.reduce((sum, r) => sum + r.cat2_d2, 0),
      cat2_d3: teamRows.reduce((sum, r) => sum + r.cat2_d3, 0),
      cat2_tot: teamRows.reduce((sum, r) => sum + r.cat2_tot, 0),
      cat3_d1: teamRows.reduce((sum, r) => sum + r.cat3_d1, 0),
      cat3_d2: teamRows.reduce((sum, r) => sum + r.cat3_d2, 0),
      cat3_d3: teamRows.reduce((sum, r) => sum + r.cat3_d3, 0),
      cat3_tot: teamRows.reduce((sum, r) => sum + r.cat3_tot, 0),
    };

    const renderCell = (val, type) => {
      if (!val || val === 0) return <span className="text-slate-400 font-normal text-[10px]">-</span>;
      if (type === 'd1') {
        return <span className="bg-emerald-100 text-emerald-900 font-extrabold px-1.5 py-0.5 rounded border border-emerald-300 shadow-2xs text-[10px]">{val}</span>;
      }
      if (type === 'd2') { // 7 < Day < 30: RED COLOR AS REQUESTED!
        return <span className="bg-[#dc2626] text-white font-black px-2 py-0.5 rounded border border-red-700 shadow-xs text-[10.5px] tracking-tight">{val}</span>;
      }
      if (type === 'd3') { // Day >= 30: Dark Rose Crimson
        return <span className="bg-[#881337] text-white font-black px-2 py-0.5 rounded border border-rose-950 shadow-xs text-[10.5px] tracking-tight">{val}</span>;
      }
      if (type === 'tot') {
        return <span className="font-black text-blue-950 text-[11px]">{val}</span>;
      }
      return <span className="font-bold text-slate-900 text-[10.5px]">{val}</span>;
    };

    const nowStr = `${new Date().getDate()}/${new Date().getMonth() + 1}/${String(new Date().getFullYear()).slice(2)} ${new Date().getHours()}:${String(new Date().getMinutes()).padStart(2, '0')}`;

    return (
      <div
        id="telegram-summary-report"
        style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          zIndex: -9999,
          width: '1600px',
          backgroundColor: '#ffffff',
          padding: '16px',
          fontFamily: 'Arial, sans-serif'
        }}
      >
        {/* Top Date Header */}
        <div className="text-center font-extrabold text-[#dc2626] text-sm mb-1 tracking-tight">
          {nowStr}
        </div>

        {/* Excel Matrix Table */}
        <table className="w-full border-collapse border border-black text-center text-xs font-bold bg-white">
          <thead>
            {/* Super Header Row 1 */}
            <tr className="bg-white border-b border-black text-[11px] font-black">
              <th rowSpan={2} className="border border-black w-10 py-1.5 align-middle bg-white text-black">No</th>
              <th rowSpan={2} className="border border-black w-14 py-1.5 align-middle bg-white text-black">Unit</th>
              <th rowSpan={2} className="border border-black w-36 py-1.5 align-middle bg-white text-left px-2 text-black">TEAM</th>
              <th colSpan={4} className="border border-black py-1.5 bg-white text-black font-black uppercase">
                Total
              </th>
              <th colSpan={4} className="border border-black py-1.5 bg-white">
                <span className="text-[#1d4ed8] block text-[11px] font-extrabold">Request import but</span>
                <span className="text-[#dc2626] block text-[11px] font-extrabold uppercase">NOT CREATED COMMAND YET</span>
              </th>
              <th colSpan={4} className="border border-black py-1.5 bg-white">
                <span className="text-[#1d4ed8] block text-[11px] font-extrabold">Request export command but</span>
                <span className="text-[#dc2626] block text-[11px] font-extrabold uppercase">REJECTED</span>
              </th>
              <th colSpan={4} className="border border-black py-1.5 bg-white">
                <span className="text-[#1d4ed8] block text-[11px] font-extrabold">Request export but</span>
                <span className="text-[#dc2626] block text-[11px] font-extrabold uppercase">NOT CREATED COMMAND YET</span>
              </th>
            </tr>

            {/* Sub Header Row 2 - Vivid Color Coded Sub Headers */}
            <tr className="border-b border-black text-[10px] font-black">
              {/* Total Group */}
              <th className="border border-black py-1 bg-[#e6f4ea] text-[#137333]">Day &lt;= 7</th>
              <th className="border border-black py-1 bg-[#fce8e6] text-[#c5221f]">7 &lt; Day &lt; 30</th>
              <th className="border border-black py-1 bg-[#fce8e6] text-[#a50e0e]">Day &gt;=30</th>
              <th className="border border-black py-1 bg-[#ffff00] text-black font-black">Total</th>

              {/* Cat 1 Group */}
              <th className="border border-black py-1 bg-[#e6f4ea] text-[#137333]">Day &lt;= 7</th>
              <th className="border border-black py-1 bg-[#fce8e6] text-[#c5221f]">7 &lt; Day &lt; 30</th>
              <th className="border border-black py-1 bg-[#fce8e6] text-[#a50e0e]">Day &gt;=30</th>
              <th className="border border-black py-1 bg-[#ffff00] text-black font-black">Total</th>

              {/* Cat 2 Group */}
              <th className="border border-black py-1 bg-[#e6f4ea] text-[#137333]">Day &lt;= 7</th>
              <th className="border border-black py-1 bg-[#fce8e6] text-[#c5221f]">7 &lt; Day &lt; 30</th>
              <th className="border border-black py-1 bg-[#fce8e6] text-[#a50e0e]">Day &gt;=30</th>
              <th className="border border-black py-1 bg-[#ffff00] text-black font-black">Total</th>

              {/* Cat 3 Group */}
              <th className="border border-black py-1 bg-[#e6f4ea] text-[#137333]">Day &lt;= 7</th>
              <th className="border border-black py-1 bg-[#fce8e6] text-[#c5221f]">7 &lt; Day &lt; 30</th>
              <th className="border border-black py-1 bg-[#fce8e6] text-[#a50e0e]">Day &gt;=30</th>
              <th className="border border-black py-1 bg-[#ffff00] text-black font-black">Total</th>
            </tr>

            {/* Total Summary Row 3 - Pure Excel Yellow Background */}
            <tr className="bg-[#ffff00] border-b border-black text-[11px] font-black text-black">
              <td className="border border-black py-1">-</td>
              <td className="border border-black py-1 font-extrabold" colSpan={2}>Total</td>

              {/* Total Group */}
              <td className="border border-black py-1">{renderCell(grandTotals.tot_d1, 'd1')}</td>
              <td className="border border-black py-1">{renderCell(grandTotals.tot_d2, 'd2')}</td>
              <td className="border border-black py-1">{renderCell(grandTotals.tot_d3, 'd3')}</td>
              <td className="border border-black py-1 font-black">{renderCell(grandTotals.tot_all, 'tot')}</td>

              {/* Cat 1 */}
              <td className="border border-black py-1">{renderCell(grandTotals.cat1_d1, 'd1')}</td>
              <td className="border border-black py-1">{renderCell(grandTotals.cat1_d2, 'd2')}</td>
              <td className="border border-black py-1">{renderCell(grandTotals.cat1_d3, 'd3')}</td>
              <td className="border border-black py-1 font-black">{renderCell(grandTotals.cat1_tot, 'tot')}</td>

              {/* Cat 2 */}
              <td className="border border-black py-1">{renderCell(grandTotals.cat2_d1, 'd1')}</td>
              <td className="border border-black py-1">{renderCell(grandTotals.cat2_d2, 'd2')}</td>
              <td className="border border-black py-1">{renderCell(grandTotals.cat2_d3, 'd3')}</td>
              <td className="border border-black py-1 font-black">{renderCell(grandTotals.cat2_tot, 'tot')}</td>

              {/* Cat 3 */}
              <td className="border border-black py-1">{renderCell(grandTotals.cat3_d1, 'd1')}</td>
              <td className="border border-black py-1">{renderCell(grandTotals.cat3_d2, 'd2')}</td>
              <td className="border border-black py-1">{renderCell(grandTotals.cat3_d3, 'd3')}</td>
              <td className="border border-black py-1 font-black">{renderCell(grandTotals.cat3_tot, 'tot')}</td>
            </tr>
          </thead>

          {/* Team Rows */}
          <tbody className="text-[11px] font-bold text-black">
            {teamRows.map((r, idx) => (
              <tr key={idx} className="border-b border-black">
                {/* Yellow Highlight Columns (No, Unit, TEAM) */}
                <td className="border border-black py-1 bg-[#ffff00] text-black font-extrabold">{idx + 1}</td>
                <td className="border border-black py-1 bg-[#ffff00] text-black font-black">{r.unit}</td>
                <td className="border border-black py-1 bg-[#ffff00] text-black font-bold text-left px-2 font-mono">{r.team}</td>
                
                {/* Total Group */}
                <td className="border border-black py-1 bg-[#ffff00] text-black">{renderCell(r.tot_d1, 'd1')}</td>
                <td className="border border-black py-1 bg-[#ffff00] text-black">{renderCell(r.tot_d2, 'd2')}</td>
                <td className="border border-black py-1 bg-[#ffff00] text-black">{renderCell(r.tot_d3, 'd3')}</td>
                <td className="border border-black py-1 bg-[#ffff00] text-black font-black">{renderCell(r.tot_all, 'tot')}</td>

                {/* Cat 1 Columns */}
                <td className="border border-black py-1 bg-white text-black">{renderCell(r.cat1_d1, 'd1')}</td>
                <td className="border border-black py-1 bg-white text-black">{renderCell(r.cat1_d2, 'd2')}</td>
                <td className="border border-black py-1 bg-white text-black">{renderCell(r.cat1_d3, 'd3')}</td>
                <td className="border border-black py-1 bg-white text-black font-black">{renderCell(r.cat1_tot, 'tot')}</td>

                {/* Cat 2 Columns */}
                <td className="border border-black py-1 bg-white text-black">{renderCell(r.cat2_d1, 'd1')}</td>
                <td className="border border-black py-1 bg-white text-black">{renderCell(r.cat2_d2, 'd2')}</td>
                <td className="border border-black py-1 bg-white text-black">{renderCell(r.cat2_d3, 'd3')}</td>
                <td className="border border-black py-1 bg-white text-black font-black">{renderCell(r.cat2_tot, 'tot')}</td>

                {/* Cat 3 Columns */}
                <td className="border border-black py-1 bg-white text-black">{renderCell(r.cat3_d1, 'd1')}</td>
                <td className="border border-black py-1 bg-white text-black">{renderCell(r.cat3_d2, 'd2')}</td>
                <td className="border border-black py-1 bg-white text-black">{renderCell(r.cat3_d3, 'd3')}</td>
                <td className="border border-black py-1 bg-white text-black font-black">{renderCell(r.cat3_tot, 'tot')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Render offscreen screenshot report for Telegram
  const renderScreenshotReport = () => {
    if (!screenshotUnit) return null;
    const unit = screenshotUnit;
    const reportData = getReportData();
    const unitData = reportData.units[unit];
    if (!unitData) return null;

    const unsignedInItems = unitData.unsignedInItems || [];
    const unsignedOutItems = unitData.unsignedOutItems || [];

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const getDelayBadge = (days) => {
      if (days >= 5) {
        return (
          <span className="inline-flex items-center px-1 py-0.5 rounded text-[8.5px] font-black bg-rose-50 text-rose-600 border border-rose-100 uppercase tracking-wide gap-0.5 shadow-xs">
            🔴 {days}d
          </span>
        );
      }
      if (days >= 3) {
        return (
          <span className="inline-flex items-center px-1 py-0.5 rounded text-[8.5px] font-black bg-amber-50 text-amber-600 border border-amber-100 uppercase tracking-wide gap-0.5 shadow-xs">
            🟡 {days}d
          </span>
        );
      }
      return (
        <span className="inline-flex items-center px-1 py-0.5 rounded text-[8.5px] font-bold bg-slate-50 text-slate-500 border border-slate-100 uppercase tracking-wide gap-0.5">
          ⚪ {days}d
        </span>
      );
    };

    return (
      <div 
        id="telegram-screenshot-report" 
        className="w-[1720px] bg-slate-50 p-3 font-sans relative flex flex-col gap-2.5 text-left border border-slate-300 rounded-xl shadow-xs"
        style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          zIndex: -9999,
          boxSizing: 'border-box'
        }}
      >
        {/* Compact Excel Header Bar */}
        <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 px-3.5 py-1.5 rounded-lg text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] font-black tracking-tight flex items-center gap-1">
              📍 BRANCH: <span className="text-yellow-300 font-extrabold">{unit}</span>
            </span>
            <span className="text-[9px] bg-rose-600 text-white font-extrabold px-2 py-0.5 rounded-md border border-rose-400/40 shadow-2xs">
              ⏳ Remain: {unsignedOutItems.length + unsignedInItems.length}
            </span>
          </div>
          <span className="text-[9px] text-slate-300 font-bold">
            🕐 {timeStr} | 📅 {dateStr}
          </span>
        </div>

        {/* 🖼️ SUMMARY KPI CARDS BANNER */}
        <div className="grid grid-cols-6 gap-2">
          <div className="bg-white border border-slate-200/90 rounded-lg p-1.5 flex items-center justify-between shadow-2xs">
            <div>
              <p className="text-[8px] font-extrabold text-slate-400 uppercase tracking-wider">📍 Branch</p>
              <p className="text-[13px] font-black text-slate-900">{unit}</p>
            </div>
            <div className="w-7 h-7 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center font-black text-[11px] border border-slate-200">
              🏢
            </div>
          </div>

          <div className="bg-white border border-indigo-200/80 rounded-lg p-1.5 flex items-center justify-between shadow-2xs">
            <div>
              <p className="text-[8px] font-extrabold text-indigo-500 uppercase tracking-wider">⏳ Unsigned</p>
              <p className="text-[13px] font-black text-indigo-700">{unsignedOutItems.length + unsignedInItems.length} <span className="text-[8.5px] font-bold text-slate-400">Items</span></p>
            </div>
            <div className="w-7 h-7 rounded-md bg-indigo-50 text-indigo-700 flex items-center justify-center font-black text-[11px] border border-indigo-100">
              📋
            </div>
          </div>

          <div className="bg-white border border-blue-200/80 rounded-lg p-1.5 flex items-center justify-between shadow-2xs">
            <div>
              <p className="text-[8px] font-extrabold text-blue-500 uppercase tracking-wider">📤 Restock Out</p>
              <p className="text-[13px] font-black text-blue-700">{unsignedOutItems.length} <span className="text-[8.5px] font-bold text-slate-400">Export</span></p>
            </div>
            <div className="w-7 h-7 rounded-md bg-blue-50 text-blue-700 flex items-center justify-center font-black text-[11px] border border-blue-100">
              📤
            </div>
          </div>

          <div className="bg-white border border-cyan-200/80 rounded-lg p-1.5 flex items-center justify-between shadow-2xs">
            <div>
              <p className="text-[8px] font-extrabold text-cyan-600 uppercase tracking-wider">📥 Restock In</p>
              <p className="text-[13px] font-black text-cyan-700">{unsignedInItems.length} <span className="text-[8.5px] font-bold text-slate-400">Import</span></p>
            </div>
            <div className="w-7 h-7 rounded-md bg-cyan-50 text-cyan-700 flex items-center justify-center font-black text-[11px] border border-cyan-100">
              📥
            </div>
          </div>

          <div className="bg-white border border-rose-200/80 rounded-lg p-1.5 flex items-center justify-between shadow-2xs">
            <div>
              <p className="text-[8px] font-extrabold text-rose-500 uppercase tracking-wider">🔴 Delay ≥ 5d</p>
              <p className="text-[13px] font-black text-rose-600">
                {unsignedOutItems.filter(i => (parseInt(i.daysDiff) || 0) >= 5).length + unsignedInItems.filter(i => (parseInt(i.daysDiff) || 0) >= 5).length} <span className="text-[8.5px] font-bold text-slate-400">Critical</span>
              </p>
            </div>
            <div className="w-7 h-7 rounded-md bg-rose-50 text-rose-600 flex items-center justify-center font-black text-[11px] border border-rose-100">
              🚨
            </div>
          </div>

          <div className="bg-white border border-amber-200/80 rounded-lg p-1.5 flex items-center justify-between shadow-2xs">
            <div>
              <p className="text-[8px] font-extrabold text-amber-500 uppercase tracking-wider">🟡 Delay 3-4d</p>
              <p className="text-[13px] font-black text-amber-600">
                {unsignedOutItems.filter(i => (parseInt(i.daysDiff) || 0) >= 3 && (parseInt(i.daysDiff) || 0) < 5).length + unsignedInItems.filter(i => (parseInt(i.daysDiff) || 0) >= 3 && (parseInt(i.daysDiff) || 0) < 5).length} <span className="text-[8.5px] font-bold text-slate-400">Warning</span>
              </p>
            </div>
            <div className="w-7 h-7 rounded-md bg-amber-50 text-amber-600 flex items-center justify-center font-black text-[11px] border border-amber-100">
              ⚠️
            </div>
          </div>
        </div>

        {/* Restock Out Section */}
        <div className="border border-slate-300 bg-white rounded-lg overflow-hidden shadow-2xs">
          <div className="bg-slate-100 px-3 py-1 border-b border-slate-300 text-[10px] font-black text-slate-800 flex justify-between items-center">
            <span className="flex items-center gap-1 text-slate-800 uppercase tracking-wide">📤 RESTOCK OUT (EXPORT REQUEST)</span>
            <span className={unsignedOutItems.length === 0 ? "text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 font-extrabold text-[8.5px]" : "text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 font-extrabold text-[8.5px]"}>
              {unsignedOutItems.length === 0 ? "✅ Completed" : `📋 ${unsignedOutItems.length} Items`}
            </span>
          </div>
          {unsignedOutItems.length > 0 ? (
            <table className="w-full text-left border-collapse table-fixed text-[9.5px]">
              <thead>
                <tr className="bg-slate-700 text-white font-bold border-b border-slate-300 text-[9.5px]">
                  <th className="border-r border-slate-600 px-1.5 py-1 text-center w-7">Nº</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-left w-[175px]">Request export code</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[135px]">Command export code</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[120px]">Note export code</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[150px]">Group request</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[80px]">Create date</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[245px]">Stock out</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[150px]">Stock receive</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[165px]">Receiving Unit</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[115px]">Creator</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[130px]">Status</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[85px]">Status CA</th>
                  <th className="border-r border-slate-600 px-1.5 py-1 text-center w-[50px]">Unit</th>
                  <th className="border-r border-slate-600 px-1.5 py-1 text-center w-[55px]">Q'ty of day</th>
                  <th className="px-1.5 py-1 text-center w-[45px]">Year</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {unsignedOutItems.map((item, index) => (
                  <tr key={index} className="odd:bg-white even:bg-slate-50/70 hover:bg-slate-100/50">
                    <td className="border-r border-slate-200 px-1.5 py-1 text-center font-bold text-slate-400 whitespace-nowrap">{index + 1}</td>
                    <td className="border-r border-slate-200 px-2 py-1 font-black text-slate-900 font-mono whitespace-nowrap truncate">{item.code || item.requestExportCode || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 font-bold text-slate-700 text-center whitespace-nowrap truncate">{item.commandExportCode || item.commandCode || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 font-bold text-slate-700 text-center whitespace-nowrap truncate">{item.noteExportCode || item.noteCode || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 font-black text-slate-800 text-center whitespace-nowrap truncate">{cleanWarehouseName(item.groupRequest || '-')}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-semibold text-slate-600 whitespace-nowrap">{item.createDate || item.createdDate || item.date || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-semibold text-slate-700 font-mono text-[9px] whitespace-nowrap truncate">{cleanWarehouseName(item.stockOut || item.exportWarehouse || '-')}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-semibold text-slate-700 whitespace-nowrap truncate">{cleanWarehouseName(item.stockReceive || item.warehouse || '-')}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center text-slate-800 font-bold whitespace-nowrap truncate">{cleanWarehouseName(item.receivingUnit || item.unitReceive || item.unitEntering || '-')}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-semibold text-slate-700 whitespace-nowrap truncate">{item.creator || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-bold text-slate-700 whitespace-nowrap truncate">{item.status || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-bold whitespace-nowrap">
                      {item.statusCA === 'Is signing' ? (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[8px] font-bold">Is signing ⚠️</span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[8px] font-bold">{item.statusCA || 'Unsigned'}</span>
                      )}
                    </td>
                    <td className="border-r border-slate-200 px-1.5 py-1 text-center font-extrabold text-slate-800 whitespace-nowrap">{item.unit || unit}</td>
                    <td className="border-r border-slate-200 px-1.5 py-1 text-center font-extrabold whitespace-nowrap">{getDelayBadge(item.daysDiff)}</td>
                    <td className="px-1.5 py-1 text-center font-bold text-slate-700 whitespace-nowrap">{item.year || (item.createDate ? item.createDate.split('/')[2] : '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-2 text-center text-emerald-700 font-bold text-[9.5px] bg-emerald-50/30">
              🎉 All items cleared!
            </div>
          )}
        </div>

        {/* Restock In Section */}
        <div className="border border-slate-300 bg-white rounded-lg overflow-hidden shadow-2xs">
          <div className="bg-slate-100 px-3 py-1 border-b border-slate-300 text-[10px] font-black text-slate-800 flex justify-between items-center">
            <span className="flex items-center gap-1 text-slate-800 uppercase tracking-wide">📥 RESTOCK IN (IMPORT REQUEST)</span>
            <span className={unsignedInItems.length === 0 ? "text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 font-extrabold text-[8.5px]" : "text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 font-extrabold text-[8.5px]"}>
              {unsignedInItems.length === 0 ? "✅ Completed" : `📋 ${unsignedInItems.length} Items`}
            </span>
          </div>
          {unsignedInItems.length > 0 ? (
            <table className="w-full text-left border-collapse table-fixed text-[9.5px]">
              <thead>
                <tr className="bg-slate-700 text-white font-bold border-b border-slate-300 text-[9.5px]">
                  <th className="border-r border-slate-600 px-1.5 py-1 text-center w-7">Nº</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-left w-[175px]">Import Request code</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[135px]">Import Command code</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[80px]">Date Create</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[245px]">Import warehouse</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[80px]">Contract</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[115px]">Creator</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[150px]">Unit Requests</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[165px]">Unit Receive</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[80px]">Date Delivery</th>
                  <th className="border-r border-slate-600 px-2 py-1 text-center w-[85px]">Status CA</th>
                  <th className="border-r border-slate-600 px-1.5 py-1 text-center w-[50px]">Unit</th>
                  <th className="border-r border-slate-600 px-1.5 py-1 text-center w-[55px]">Q'ty of day</th>
                  <th className="px-1.5 py-1 text-center w-[45px]">Year</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {unsignedInItems.map((item, index) => (
                  <tr key={index} className="odd:bg-white even:bg-slate-50/70 hover:bg-slate-100/50">
                    <td className="border-r border-slate-200 px-1.5 py-1 text-center font-bold text-slate-400 whitespace-nowrap">{index + 1}</td>
                    <td className="border-r border-slate-200 px-2 py-1 font-black text-slate-900 font-mono whitespace-nowrap truncate">{item.code || item.importRequestCode || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 font-bold text-slate-700 text-center whitespace-nowrap truncate">{item.importCommandCode || item.commandCode || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-semibold text-slate-600 whitespace-nowrap">{item.dateCreate || item.createdDate || item.date || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-semibold text-slate-700 font-mono text-[9px] whitespace-nowrap truncate">{cleanWarehouseName(item.importWarehouse || item.warehouse || '-')}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-semibold text-slate-600 whitespace-nowrap truncate">{item.contract || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-semibold text-slate-700 whitespace-nowrap truncate">{item.creator || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 font-black text-slate-800 text-center whitespace-nowrap truncate">{cleanWarehouseName(item.unitRequests || '-')}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center text-slate-800 font-bold whitespace-nowrap truncate">{cleanWarehouseName(item.unitReceive || item.receivingUnit || '-')}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-semibold text-slate-600 whitespace-nowrap">{item.dateDelivery || item.deliveryDate || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-center font-bold whitespace-nowrap">
                      {item.statusCA === 'Is signing' ? (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[8px] font-bold">Is signing ⚠️</span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[8px] font-bold">{item.statusCA || 'Unsigned'}</span>
                      )}
                    </td>
                    <td className="border-r border-slate-200 px-1.5 py-1 text-center font-extrabold text-slate-800 whitespace-nowrap">{item.unit || unit}</td>
                    <td className="border-r border-slate-200 px-1.5 py-1 text-center font-extrabold whitespace-nowrap">{getDelayBadge(item.daysDiff)}</td>
                    <td className="px-1.5 py-1 text-center font-bold text-slate-700 whitespace-nowrap">{item.year || (item.dateCreate ? item.dateCreate.split('/')[2] : '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-2 text-center text-emerald-700 font-bold text-[9.5px] bg-emerald-50/30">
              🎉 All items cleared!
            </div>
          )}
        </div>

        {customNote && customNote.trim() && (
          <div className="bg-amber-50/40 border border-amber-100 rounded-xl p-2.5 shadow-2xs">
            <h4 className="text-[9.5px] font-black text-amber-700 uppercase tracking-wider mb-1 flex items-center gap-1">
              📝 NOTE
            </h4>
            <p className="text-[9.5px] font-semibold text-slate-600 leading-relaxed whitespace-pre-wrap">{customNote.trim()}</p>
          </div>
        )}
      </div>
    );
  };

  // Render progress modal
  const renderProgressModal = () => {
    if (!showProgressModal) return null;
    
    const progress = sendProgress || { current: 0, total: 1, unit: '', status: 'sending' };
    const percentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    const results = sendResults || { total: 1, success: 0, failed: 0 };
    const hasError = progress.status === 'failed' || (results.failed > 0);
    
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`text-2xl ${!hasError ? 'animate-spin' : ''}`}>
              {hasError ? '❌' : '⏳'}
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800">
                {hasError ? 'Sending Failed' : 'Sending Reports...'}
              </h3>
              <p className="text-sm text-gray-500">
                {hasError ? 'Some errors occurred' : 'Please wait while we send'}
              </p>
            </div>
          </div>
          
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>Progress</span>
              <span className="font-bold">{percentage}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div 
                className={`h-3 rounded-full transition-all duration-500 ${
                  hasError ? 'bg-rose-500' : 'bg-gradient-to-r from-blue-500 to-emerald-500'
                }`}
                style={{ width: `${percentage}%` }}
              ></div>
            </div>
          </div>
          
          <div className="text-sm text-gray-600">
            {progress.status === 'sending' && (
              <div className="flex items-center gap-2">
                <span className="animate-pulse">📤</span>
                <span>Sending to <strong>{progress.unit}</strong> ({progress.current}/{progress.total})</span>
              </div>
            )}
            {progress.status === 'success' && (
              <div className="flex items-center gap-2 text-emerald-600">
                <span>✅</span>
                <span>Sent to <strong>{progress.unit}</strong></span>
              </div>
            )}
            {progress.status === 'failed' && (
              <div className="flex items-center gap-2 text-rose-600">
                <span>❌</span>
                <span>Failed to send to <strong>{progress.unit}</strong></span>
                {progress.error && <span className="text-xs text-gray-500">({progress.error})</span>}
              </div>
            )}
            {progress.status === 'error' && (
              <div className="flex items-center gap-2 text-rose-600">
                <span>⚠️</span>
                <span>{progress.error || 'Unknown error'}</span>
              </div>
            )}
          </div>
          
          {sendResults && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="bg-gray-50 rounded-lg p-2">
                  <div className="text-gray-500">Total</div>
                  <div className="text-xl font-bold text-gray-800">{results.total}</div>
                </div>
                <div className="bg-emerald-50 rounded-lg p-2">
                  <div className="text-emerald-500">Success</div>
                  <div className="text-xl font-bold text-emerald-600">{results.success}</div>
                </div>
                <div className="bg-rose-50 rounded-lg p-2">
                  <div className="text-rose-500">Failed</div>
                  <div className="text-xl font-bold text-rose-600">{results.failed}</div>
                </div>
              </div>
            </div>
          )}
          
          {!sendResults && percentage === 100 && (
            <div className="mt-4 text-center text-sm text-gray-500">Completing...</div>
          )}
          
          {sendResults && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowProgressModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
              >
                Close
              </button>
            </div>
          )}

          {isSending && !sendResults && (
            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  if (abortControllerRef.current) {
                    abortControllerRef.current.abort();
                  }
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
              >
                🛑 Cancel Sending
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full px-4 py-6 bg-gray-50 min-h-screen">
      
      {/* ─── HEADER ─── */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 mb-6 text-white shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-white tracking-tight">
                របាយការណ៍ជូនដំណឹងអំពីប្រតិបត្តិការ Recall និង Request Stock Out ដែលមិនទាន់បានបិទដំណើរការក្នុងប្រព័ន្ធ
              </h1>
              <span className="bg-slate-800 text-slate-300 text-[10px] px-2.5 py-0.5 rounded border border-slate-700 font-semibold flex items-center gap-1.5 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Active • {currentTime.toLocaleTimeString()}
              </span>
            </div>
            <p className="text-slate-400 mt-1.5 text-xs sm:text-sm font-semibold uppercase tracking-wider">Recall &amp; Request Stock Out Dashboard</p>
          </div>
        </div>
      </div>

      {/* ─── TELEGRAM BOT OVERVIEW ─── */}
      {null}

      {/* ─── SUMMARY CARDS ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 border-l-4 border-blue-500 hover:shadow-md transition-all duration-200">
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Requests</div>
          <div className="text-2xl font-bold text-blue-600 mt-1 font-mono">{filteredKPI.summary.totalRequests}</div>
          <div className="text-[10px] text-slate-400 mt-1">All records</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 border-l-4 border-emerald-500 hover:shadow-md transition-all duration-200">
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Completed</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">{filteredKPI.summary.totalCompleted}</div>
          <div className="text-[10px] text-slate-400 mt-1 font-mono">{filteredKPI.summary.completionRate.toFixed(1)}% rate</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 border-l-4 border-amber-500 hover:shadow-md transition-all duration-200">
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Pending</div>
          <div className="text-2xl font-bold text-amber-600 mt-1 font-mono">{filteredKPI.summary.totalPending}</div>
          <div className="text-[10px] text-slate-400 mt-1">Awaiting completion</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 border-l-4 border-rose-500 hover:shadow-md transition-all duration-200">
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Alarms</div>
          <div className={`text-2xl font-bold ${getAlarmColor(filteredKPI.summary.totalAlarms)} mt-1 font-mono`}>
            {filteredKPI.summary.totalAlarms}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">Exceeding threshold</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 border-l-4 border-purple-500 hover:shadow-md transition-all duration-200">
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Units Active</div>
          <div className="text-2xl font-bold text-purple-600 mt-1 font-mono">
            {Object.keys(filteredKPI.unitStats).length}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">Total units</div>
        </div>
      </div>

      {/* ─── PERFORMANCE TABLE ─── */}
      <div className="bg-white rounded-2xl shadow-md p-6 mb-6 border border-gray-100">
        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          <span>📋</span> Performance by Module
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 rounded-xl">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Module/KPI Task</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">Target ព្រឹក</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">Target ល្ងាច</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Remain</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Result</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Ratio</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">In System</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              <tr className="hover:bg-emerald-50/50 transition-colors">
                <td className="px-4 py-3.5 text-sm font-medium text-gray-900 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600"></span>
                  Restock In
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    value={editMorningRestockIn}
                    onChange={(e) => setEditMorningRestockIn(e.target.value)}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-xl text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    value={editEveningRestockIn}
                    onChange={(e) => setEditEveningRestockIn(e.target.value)}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-xl text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50"
                  />
                </td>
                <td className="px-4 py-3.5 text-sm text-right font-semibold text-amber-600">
                  {restockInRemain}
                </td>
                <td className="px-4 py-3.5 text-sm text-right font-semibold text-emerald-600">
                  {restockInResult}
                </td>
                <td className="px-4 py-3.5 text-sm text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="font-semibold text-gray-800">{restockInRatio}%</span>
                    <div className="w-16 bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min(100, parseFloat(restockInRatio))}%` }}></div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-sm text-right text-gray-500">
                  {restockInInSystem}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={handleUpdateRestockIn}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
                  >
                    Update
                  </button>
                </td>
              </tr>

              <tr className="hover:bg-teal-50/50 transition-colors">
                <td className="px-4 py-3.5 text-sm font-medium text-gray-900 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-teal-500 to-emerald-600"></span>
                  Restock Out
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    value={editMorningRestockOut}
                    onChange={(e) => setEditMorningRestockOut(e.target.value)}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-xl text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    value={editEveningRestockOut}
                    onChange={(e) => setEditEveningRestockOut(e.target.value)}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-xl text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50"
                  />
                </td>
                <td className="px-4 py-3.5 text-sm text-right font-semibold text-amber-600">
                  {restockOutRemain}
                </td>
                <td className="px-4 py-3.5 text-sm text-right font-semibold text-emerald-600">
                  {restockOutResult}
                </td>
                <td className="px-4 py-3.5 text-sm text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="font-semibold text-gray-800">{restockOutRatio}%</span>
                    <div className="w-16 bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min(100, parseFloat(restockOutRatio))}%` }}></div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-sm text-right text-gray-500">
                  {restockOutInSystem}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={handleUpdateRestockOut}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
                  >
                    Update
                  </button>
                </td>
              </tr>
            </tbody>
            <tfoot className="bg-gray-50 font-bold border-t border-gray-200">
              <tr>
                <td className="px-4 py-3 text-sm text-gray-900">សរុប (TOTAL)</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totalRestockMorning}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totalRestockEvening}</td>
                <td className="px-4 py-3 text-sm text-right text-amber-600">{totalRestockRemain}</td>
                <td className="px-4 py-3 text-sm text-right text-emerald-600">{totalRestockResult}</td>
                <td className="px-4 py-3 text-sm text-right text-gray-900">
                  <div className="flex items-center justify-end gap-2 font-bold">
                    <span>{totalRestockRatio}%</span>
                    <div className="w-16 bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, parseFloat(totalRestockRatio))}%` }}></div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-500">{totalRestockInSystem}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ─── FILTERS ─── */}
      <div className="bg-white rounded-2xl shadow-md p-4 mb-6 flex flex-wrap gap-4 items-center border border-gray-100">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">📂 Unit:</label>
          <select
            value={selectedUnit}
            onChange={(e) => setSelectedUnit(e.target.value)}
            disabled={isUnitUser}
            className="px-3 py-1.5 border border-gray-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed font-bold"
          >
            <option value="all">All Units ({availableUnits.length})</option>
            {availableUnits.map(unit => (
              <option key={unit} value={unit}>{unit}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">📅 Time:</label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
          >
            <option value="all">All Time</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="year">Last Year</option>
          </select>
        </div>
        <div className="text-sm text-gray-500 ml-auto">
          Showing <span className="font-semibold text-gray-700">{filteredData.length}</span> records
          {selectedUnit !== 'all' && ` for ${selectedUnit}`}
          {timeRange !== 'all' && ` (${timeRange})`}
        </div>
      </div>

      {null}

      {/* ─── FOOTER ─── */}
      <div className="mt-6 text-center text-xs text-gray-400 border-t border-gray-200 pt-4">
        <span>📊 Dashboard updated: {new Date().toLocaleString()}</span>
        <span className="mx-3">•</span>
        <span>Total units tracked: {availableUnits.length}</span>
        <span className="mx-3">•</span>
        <span>Records: {kpiData.summary.totalRequests}</span>
        <span className="mx-3">•</span>
        <span>Completion: {kpiData.summary.completionRate.toFixed(1)}%</span>
      </div>

      {renderProgressModal()}

      {createPortal(renderScreenshotReport(), document.body)}
      {createPortal(renderSummaryReport(), document.body)}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 10px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }
      `}</style>
    </div>
  );
};

export default Dashboard_Request;