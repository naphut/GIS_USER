import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  sendCAToTelegram, 
  sendToAllCATelegram, 
  getAllUnits,
  getConfiguredUnits,
  hasGroupId,
  hasToken,
  getSavedTemplates,
  saveTemplate,
  deleteTemplate,
  sendPhotoToTelegram,
  sendDocumentToTelegram,
  generateSignedCAExcelBlob,
  cleanWarehouseName,
  getTeamFromWarehouse
} from '../../../services/telegramBot';
import { loadFromDb, saveToDb, completeStore } from '../../../services/dbStore';
import html2canvas from 'html2canvas';
import { createPortal } from 'react-dom';

// Storage Keys
const STORAGE_KEYS = {
  EXPORT_CA_DATA: 'export_ca_data',
  IMPORT_CA_DATA: 'import_ca_data',
  KPI_TARGETS: 'kpi_signedca_targets',
  TELEGRAM_SETTINGS: 'kpi_signedca_telegram',
};

// Helper functions






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

const Dashboard_CA = ({ user }) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Load or initialize Stock Out data (export_ca_data)
  const [stockOutData, setStockOutData] = useState(() => {
    const data = getStorageData(STORAGE_KEYS.EXPORT_CA_DATA);
    if (!data || data.length === 0) {
      const sample = [
        { id: 1, exportNoteCode: 'SO-2026-001', exportWarehouse: 'GIS_KAM_STOCK', dateCreate: '23/06/2026', statusCA: 'Is signing' },
        { id: 2, exportNoteCode: 'SO-2026-002', exportWarehouse: 'GIS_SPE_STOCK', dateCreate: '22/06/2026', statusCA: 'Is signing' },
        { id: 3, exportNoteCode: 'SO-2026-003', exportWarehouse: 'GIS_BAN_STOCK', dateCreate: '21/06/2026', statusCA: 'Is signing' },
        { id: 4, exportNoteCode: 'SO-2026-004', exportWarehouse: 'GIS_MON_STOCK', dateCreate: '20/06/2026', statusCA: 'Unsigned' },
        { id: 5, exportNoteCode: 'SO-2026-005', exportWarehouse: 'GIS_SIE_STOCK', dateCreate: '19/06/2026', statusCA: 'Unsigned' },
      ];
      return sample;
    }
    return data;
  });

  // Load or initialize Stock In data (import_ca_data)
  const [stockInData, setStockInData] = useState(() => {
    const data = getStorageData(STORAGE_KEYS.IMPORT_CA_DATA);
    if (!data || data.length === 0) {
      const sample = [
        { id: 1, codeReceipt: 'SI-2026-001', warehouse: 'GIS_ODD_STOCK', date: '23/06/2026', statusCA: 'Is signing' },
        { id: 2, codeReceipt: 'SI-2026-002', warehouse: 'GIS_PRH_STOCK', date: '22/06/2026', statusCA: 'Is signing' },
        { id: 3, codeReceipt: 'SI-2026-003', warehouse: 'GIS_KRA_STOCK', date: '21/06/2026', statusCA: 'Is signing' },
        { id: 4, codeReceipt: 'SI-2026-004', warehouse: 'GIS_STU_STOCK', date: '20/06/2026', statusCA: 'Is signing' },
        { id: 5, codeReceipt: 'SI-2026-005', warehouse: 'GIS_TAK_STOCK', date: '19/06/2026', statusCA: 'Unsigned' },
        { id: 6, codeReceipt: 'SI-2026-006', warehouse: 'GIS_CHA_STOCK', date: '18/06/2026', statusCA: 'Unsigned' },
      ];
      return sample;
    }
    return data;
  });

  const [summaryImageMode, setSummaryImageMode] = useState(false);
  const [isSelectingForSummary, setIsSelectingForSummary] = useState(false);

  // KPI Targets State
  const [targets, setTargets] = useState(() => {
    const saved = getStorageData(STORAGE_KEYS.KPI_TARGETS);
    return saved || {
      stock_out: { morning: 0, evening: 0 },
      stock_in: { morning: 0, evening: 0 }
    };
  });

  const [exportCaTargets, setExportCaTargets] = useState(() => getStorageData('export_ca_targets') || {});
  const [importCaTargets, setImportCaTargets] = useState(() => getStorageData('import_ca_targets') || {});

  const [exportCompletionHistory, setExportCompletionHistory] = useState(() => getStorageData('export_ca_completionHistory') || []);
  const [importCompletionHistory, setImportCompletionHistory] = useState(() => getStorageData('import_ca_completionHistory') || []);

  const isUnitUser = user && user.role === 'unit' && user.unit;
  const userUnit = user?.unit;

  // Load data from DB on mount
  useEffect(() => {
    const fetchDbData = async () => {
      const defaultStockOut = [
        { id: 1, exportNoteCode: 'SO-2026-001', exportWarehouse: 'GIS_KAM_STOCK', dateCreate: '23/06/2026', statusCA: 'Is signing' },
        { id: 2, exportNoteCode: 'SO-2026-002', exportWarehouse: 'GIS_SPE_STOCK', dateCreate: '22/06/2026', statusCA: 'Is signing' },
        { id: 3, exportNoteCode: 'SO-2026-003', exportWarehouse: 'GIS_BAN_STOCK', dateCreate: '21/06/2026', statusCA: 'Is signing' },
        { id: 4, exportNoteCode: 'SO-2026-004', exportWarehouse: 'GIS_MON_STOCK', dateCreate: '20/06/2026', statusCA: 'Unsigned' },
        { id: 5, exportNoteCode: 'SO-2026-005', exportWarehouse: 'GIS_SIE_STOCK', dateCreate: '19/06/2026', statusCA: 'Unsigned' },
      ];
      let dbStockOut = await loadFromDb(STORAGE_KEYS.EXPORT_CA_DATA, defaultStockOut);
      if (isUnitUser) {
        dbStockOut = dbStockOut.filter(item => item.unit === userUnit || extractUnit(item) === userUnit);
      }
      setStockOutData(dbStockOut);

      const defaultStockIn = [
        { id: 1, codeReceipt: 'SI-2026-001', warehouse: 'GIS_ODD_STOCK', date: '23/06/2026', statusCA: 'Is signing' },
        { id: 2, codeReceipt: 'SI-2026-002', warehouse: 'GIS_PRH_STOCK', date: '22/06/2026', statusCA: 'Is signing' },
        { id: 3, codeReceipt: 'SI-2026-003', warehouse: 'GIS_KRA_STOCK', date: '21/06/2026', statusCA: 'Is signing' },
        { id: 4, codeReceipt: 'SI-2026-004', warehouse: 'GIS_STU_STOCK', date: '20/06/2026', statusCA: 'Is signing' },
        { id: 5, codeReceipt: 'SI-2026-005', warehouse: 'GIS_TAK_STOCK', date: '19/06/2026', statusCA: 'Unsigned' },
        { id: 6, codeReceipt: 'SI-2026-006', warehouse: 'GIS_CHA_STOCK', date: '18/06/2026', statusCA: 'Unsigned' },
      ];
      let dbStockIn = await loadFromDb(STORAGE_KEYS.IMPORT_CA_DATA, defaultStockIn);
      if (isUnitUser) {
        dbStockIn = dbStockIn.filter(item => item.unit === userUnit || extractUnit(item) === userUnit);
      }
      setStockInData(dbStockIn);

      const dbTargets = await loadFromDb(STORAGE_KEYS.KPI_TARGETS, null);
      if (dbTargets) {
        setTargets({
          stock_out: { morning: 0, evening: 0, ...dbTargets.stock_out },
          stock_in: { morning: 0, evening: 0, ...dbTargets.stock_in }
        });
      }

      const dbExportCaTargets = await loadFromDb('export_ca_targets', {});
      setExportCaTargets(dbExportCaTargets);

      const dbImportCaTargets = await loadFromDb('import_ca_targets', {});
      setImportCaTargets(dbImportCaTargets);

      let dbExportCompletion = await loadFromDb('export_ca_completionHistory', []);
      if (isUnitUser) {
        dbExportCompletion = dbExportCompletion.filter(item => item.unit === userUnit || extractUnit(item) === userUnit);
      }
      setExportCompletionHistory(dbExportCompletion);

      let dbImportCompletion = await loadFromDb('import_ca_completionHistory', []);
      if (isUnitUser) {
        dbImportCompletion = dbImportCompletion.filter(item => item.unit === userUnit || extractUnit(item) === userUnit);
      }
      setImportCompletionHistory(dbImportCompletion);
    };
    fetchDbData();
  }, [isUnitUser, userUnit]);

  const sumExportMorning = useMemo(() => {
    if (isUnitUser) {
      return exportCaTargets[userUnit]?.morning || 0;
    }
    return Object.values(exportCaTargets).reduce((sum, t) => sum + (t?.morning || 0), 0);
  }, [exportCaTargets, isUnitUser, userUnit]);

  const sumExportEvening = useMemo(() => {
    if (isUnitUser) {
      return exportCaTargets[userUnit]?.evening || 0;
    }
    return Object.values(exportCaTargets).reduce((sum, t) => sum + (t?.evening || 0), 0);
  }, [exportCaTargets, isUnitUser, userUnit]);

  const sumImportMorning = useMemo(() => {
    if (isUnitUser) {
      return importCaTargets[userUnit]?.morning || 0;
    }
    return Object.values(importCaTargets).reduce((sum, t) => sum + (t?.morning || 0), 0);
  }, [importCaTargets, isUnitUser, userUnit]);

  const sumImportEvening = useMemo(() => {
    if (isUnitUser) {
      return importCaTargets[userUnit]?.evening || 0;
    }
    return Object.values(importCaTargets).reduce((sum, t) => sum + (t?.evening || 0), 0);
  }, [importCaTargets, isUnitUser, userUnit]);

  const [editMorningStockOut, setEditMorningStockOut] = useState(targets.stock_out?.morning || sumExportMorning);
  const [editEveningStockOut, setEditEveningStockOut] = useState(targets.stock_out?.evening || sumExportEvening);
  const [editMorningStockIn, setEditMorningStockIn] = useState(targets.stock_in?.morning || sumImportMorning);
  const [editEveningStockIn, setEditEveningStockIn] = useState(targets.stock_in?.evening || sumImportEvening);

  // Sync inputs if targets state changes
  useEffect(() => {
    setEditMorningStockOut(targets.stock_out?.morning || sumExportMorning);
    setEditEveningStockOut(targets.stock_out?.evening || sumExportEvening);
    setEditMorningStockIn(targets.stock_in?.morning || sumImportMorning);
    setEditEveningStockIn(targets.stock_in?.evening || sumImportEvening);
  }, [targets, sumExportMorning, sumExportEvening, sumImportMorning, sumImportEvening]);

  const handleUpdateStockOut = () => {
    const updated = {
      ...targets,
      stock_out: { morning: parseInt(editMorningStockOut) || 0, evening: parseInt(editEveningStockOut) || 0 }
    };
    setTargets(updated);
    saveToDb(STORAGE_KEYS.KPI_TARGETS, updated);
  };

  const handleUpdateStockIn = () => {
    const updated = {
      ...targets,
      stock_in: { morning: parseInt(editMorningStockIn) || 0, evening: parseInt(editEveningStockIn) || 0 }
    };
    setTargets(updated);
    saveToDb(STORAGE_KEYS.KPI_TARGETS, updated);
  };

  // Telegram integration states
  const [customNote, setCustomNote] = useState('');
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
  const [telegramSelectedUnit, setTelegramSelectedUnit] = useState(isUnitUser ? userUnit : 'BAT');
  const [showUnitSelector, setShowUnitSelector] = useState(false);
  const [sendProgress, setSendProgress] = useState(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [sendResults, setSendResults] = useState(null);
  const [screenshotUnit, setScreenshotUnit] = useState(null);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [openBatchDropdown, setOpenBatchDropdown] = useState(false);
  const [openSingleDropdown, setOpenSingleDropdown] = useState(false);

  // Sync telegramSelectedUnit if user changes
  useEffect(() => {
    if (isUnitUser) {
      setTelegramSelectedUnit(userUnit);
    }
  }, [userUnit, isUnitUser]);

  const allUnits = isUnitUser ? [userUnit] : getAllUnits();
  const configured = getConfiguredUnits();
  const totalUnits = allUnits.length;
  const configuredCount = configured.length;

  // Derive signing groups from data source
  const stockOutSigning = useMemo(() => {
    return stockOutData.filter(item => item.statusCA === 'Is signing' || item.statusCA === 'Signing');
  }, [stockOutData]);

  const stockOutUnsigned = useMemo(() => {
    return stockOutData.filter(item => {
      const s = (item.statusCA || 'Unsigned').toUpperCase();
      return s === 'UNSIGNED' || s === 'CANCEL';
    });
  }, [stockOutData]);

  const stockInSigning = useMemo(() => {
    return stockInData.filter(item => item.statusCA === 'Is signing' || item.statusCA === 'Signing');
  }, [stockInData]);

  const stockInUnsigned = useMemo(() => {
    return stockInData.filter(item => {
      const s = (item.statusCA || 'Unsigned').toUpperCase();
      return s === 'UNSIGNED' || s === 'CANCEL';
    });
  }, [stockInData]);

  // Calculate statistics
  const stats = useMemo(() => {
    const stockOutSigningTotal = stockOutSigning.length;
    const stockOutUnsignedTotal = stockOutUnsigned.length;
    const stockInSigningTotal = stockInSigning.length;
    const stockInUnsignedTotal = stockInUnsigned.length;

    const totalStockOut = stockOutSigningTotal + stockOutUnsignedTotal;
    const totalStockIn = stockInSigningTotal + stockInUnsignedTotal;
    const totalRecords = totalStockOut + totalStockIn;
    const totalSigning = stockOutSigningTotal + stockInSigningTotal;
    const totalUnsigned = stockOutUnsignedTotal + stockInUnsignedTotal;

    const stockOutRate = totalStockOut > 0 ? (stockOutSigningTotal / totalStockOut) * 100 : 0;
    const stockInRate = totalStockIn > 0 ? (stockInSigningTotal / totalStockIn) * 100 : 0;
    const totalRate = totalRecords > 0 ? (totalSigning / totalRecords) * 100 : 0;

    return {
      stockOutSigning: { total: stockOutSigningTotal },
      stockOutUnsigned: { total: stockOutUnsignedTotal },
      stockInSigning: { total: stockInSigningTotal },
      stockInUnsigned: { total: stockInUnsignedTotal },
      totalStockOut: { total: totalStockOut, signing: stockOutSigningTotal, unsigned: stockOutUnsignedTotal, rate: stockOutRate },
      totalStockIn: { total: totalStockIn, signing: stockInSigningTotal, unsigned: stockInUnsignedTotal, rate: stockInRate },
      overall: { total: totalRecords, signing: totalSigning, unsigned: totalUnsigned, rate: totalRate }
    };
  }, [stockOutSigning, stockOutUnsigned, stockInSigning, stockInUnsigned]);

  // Format number with leading zero
  const formatNumber = (num) => {
    return num.toString().padStart(2, '0');
  };

  // Get color based on rate
  const getRateColor = (rate) => {
    if (rate >= 80) return 'text-emerald-600';
    if (rate >= 50) return 'text-amber-600';
    return 'text-rose-600';
  };

  const getProgressColor = (rate) => {
    if (rate >= 80) return 'bg-emerald-500';
    if (rate >= 50) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  // Calculations for Performance Table
  const stockOutResult = exportCompletionHistory.length;
  const stockOutInSystem = stockOutData.length + exportCompletionHistory.length;
  const isMorning = new Date().getHours() < 12;
  const stockOutMorning = isUnitUser ? sumExportMorning : (targets.stock_out?.morning || sumExportMorning);
  const stockOutEvening = isUnitUser ? sumExportEvening : (targets.stock_out?.evening || sumExportEvening);
  const stockOutTarget = isMorning ? stockOutMorning : (stockOutEvening > 0 ? stockOutEvening : stockOutMorning);
  const stockOutRemain = stockOutTarget > 0 ? Math.max(0, stockOutTarget - stockOutResult) : stockOutData.length;
  const stockOutRatio = stockOutTarget > 0 ? ((stockOutResult / stockOutTarget) * 100).toFixed(2) : (stockOutRemain === 0 ? '100.00' : '0.00');

  const stockInResult = importCompletionHistory.length;
  const stockInInSystem = stockInData.length + importCompletionHistory.length;
  const stockInMorning = isUnitUser ? sumImportMorning : (targets.stock_in?.morning || sumImportMorning);
  const stockInEvening = isUnitUser ? sumImportEvening : (targets.stock_in?.evening || sumImportEvening);
  const stockInTarget = isMorning ? stockInMorning : (stockInEvening > 0 ? stockInEvening : stockInMorning);
  const stockInRemain = stockInTarget > 0 ? Math.max(0, stockInTarget - stockInResult) : stockInData.length;
  const stockInRatio = stockInTarget > 0 ? ((stockInResult / stockInTarget) * 100).toFixed(2) : (stockInRemain === 0 ? '100.00' : '0.00');

  const totalMorning = stockOutMorning + stockInMorning;
  const totalEvening = stockOutEvening + stockInEvening;
  const totalResult = stockOutResult + stockInResult;
  const totalInSystem = stockOutInSystem + stockInInSystem;
  const totalTarget = stockOutTarget + stockInTarget;
  const totalRemain = totalTarget > 0 ? Math.max(0, totalTarget - totalResult) : (stockOutData.length + stockInData.length);
  const totalRatio = totalTarget > 0 ? ((totalResult / totalTarget) * 100).toFixed(2) : (totalRemain === 0 ? '100.00' : '0.00');

  const getReportData = () => {
    const allUnitsList = getAllUnits();
    const unitsMap = {};
    
    const exportTargets = exportCaTargets;
    const importTargets = importCaTargets;

    const calculateDaysDiff = (dateString) => {
      if (!dateString) return 0;
      const parts = dateString.split(/[/\s:-]+/);
      if (parts.length < 3) return 0;
      let day, month, year;
      if (parts[0].length === 4) {
        year = parseInt(parts[0]);
        month = parseInt(parts[1]) - 1;
        day = parseInt(parts[2]);
      } else {
        day = parseInt(parts[0]);
        month = parseInt(parts[1]) - 1;
        year = parseInt(parts[2]);
        if (year < 100) year += 2000;
      }
      const createdDate = new Date(year, month, day);
      const currentDate = new Date();
      currentDate.setHours(0, 0, 0, 0);
      const diffTime = currentDate - createdDate;
      return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    };

    allUnitsList.forEach(unit => {
      const exportMorning = exportTargets[unit]?.morning || 0;
      const exportEvening = exportTargets[unit]?.evening || 0;
      const exportTarget = isMorning ? exportMorning : (exportEvening > 0 ? exportEvening : exportMorning);

      const importMorning = importTargets[unit]?.morning || 0;
      const importEvening = importTargets[unit]?.evening || 0;
      const importTarget = isMorning ? importMorning : (importEvening > 0 ? importEvening : importMorning);

      const targetMorning = importMorning + exportMorning;
      const targetEvening = importEvening + exportEvening;
      const totalUnitTarget = importTarget + exportTarget;

      const outItems = stockOutData.filter(item => item.unit === unit);
      const outUnsigned = outItems.length;
      const outResult = exportCompletionHistory.filter(h => h.unit === unit).length;
      const outTotal = outResult + outUnsigned;
      const outRatio = exportTarget > 0 
        ? parseFloat(((outResult / exportTarget) * 100).toFixed(2)) 
        : (outUnsigned === 0 && outResult === 0 ? 100 : 0);
      
      const inItems = stockInData.filter(item => item.unit === unit);
      const inUnsigned = inItems.length;
      const inResult = importCompletionHistory.filter(h => h.unit === unit).length;
      const inTotal = inResult + inUnsigned;
      const inRatio = importTarget > 0 
        ? parseFloat(((inResult / importTarget) * 100).toFixed(2)) 
        : (inUnsigned === 0 && inResult === 0 ? 100 : 0);
      
      const overallTotal = outTotal + inTotal;
      const overallResult = outResult + inResult;
      const overallUnsigned = outUnsigned + inUnsigned;
      
      const remain = totalUnitTarget > 0 
        ? Math.max(0, totalUnitTarget - overallResult) 
        : overallUnsigned;
      
      const ratio = totalUnitTarget > 0 
        ? parseFloat(((overallResult / totalUnitTarget) * 100).toFixed(2)) 
        : (remain === 0 ? 100 : 0);
      
      const unsignedOutItemsList = outItems
        .filter(item => {
          const s = (item.statusCA || '').toLowerCase();
          return !s.includes('signed') || s.includes('unsigned');
        })
        .map(item => ({
          ...item,
          code: item.exportNoteCode || item.code || '',
          daysDiff: item.daysDiff !== undefined ? item.daysDiff : calculateDaysDiff(item.dateCreate),
          warehouse: item.exportWarehouse || item.warehouse || '-',
          statusCA: item.statusCA || 'Unsigned',
          creator: item.createRequester || item.requester || item.creator || '-',
          unitEntering: item.unitEntering || '-'
        }));

      const unsignedInItemsList = inItems
        .filter(item => {
          const s = (item.statusCA || '').toLowerCase();
          return !s.includes('signed') || s.includes('unsigned');
        })
        .map(item => ({
          ...item,
          code: item.codeReceipt || item.code || '',
          daysDiff: item.daysDiff !== undefined ? item.daysDiff : calculateDaysDiff(item.date),
          warehouse: item.warehouse || '-',
          statusCA: item.statusCA || 'Unsigned',
          creator: item.creator || '-'
        }));

      unitsMap[unit] = {
        targetMorning,
        targetEvening,
        remain,
        result: overallResult,
        ratio,
        inSystem: overallTotal,
        stockOut: {
          target: exportTarget,
          total: outTotal,
          result: outResult,
          unsigned: outUnsigned,
          remain: exportTarget > 0 ? Math.max(0, exportTarget - outResult) : outUnsigned,
          ratio: outRatio
        },
        stockIn: {
          target: importTarget,
          total: inTotal,
          result: inResult,
          unsigned: inUnsigned,
          remain: importTarget > 0 ? Math.max(0, importTarget - inResult) : inUnsigned,
          ratio: inRatio
        },
        overall: {
          total: overallTotal,
          result: overallResult,
          unsigned: overallUnsigned,
          ratio: ratio
        },
        unsignedOutItems: unsignedOutItemsList,
        unsignedInItems: unsignedInItemsList
      };
    });
    
    return {
      totalTarget: totalTarget,
      totalResult: totalResult,
      totalRemain: totalRemain,
      totalRatio: parseFloat(totalRatio),
      totalInSystem: totalInSystem,
      stockOut: {
        total: stockOutInSystem,
        result: stockOutResult,
        unsigned: stockOutRemain,
        ratio: parseFloat(stockOutRatio)
      },
      stockIn: {
        total: stockInInSystem,
        result: stockInResult,
        unsigned: stockInRemain,
        ratio: parseFloat(stockInRatio)
      },
      overall: {
        total: totalInSystem,
        result: totalResult,
        unsigned: totalRemain,
        ratio: parseFloat(totalRatio)
      },
      units: unitsMap
    };
  };

  // Send CA reports to ALL units
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
      
      const result = await sendToAllCATelegram(data, (progress) => {
        setSendProgress(progress);
      }, customNote, abortControllerRef.current.signal);
      
      setSendResults(result.summary);
      
      if (result.summary.success > 0) {
        completeStore(STORAGE_KEYS.EXPORT_CA_DATA);
        completeStore(STORAGE_KEYS.IMPORT_CA_DATA);
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

  // Send CA report to single unit
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
      const result = await sendCAToTelegram(unit, data, customNote, abortControllerRef.current.signal);
      
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
        completeStore(STORAGE_KEYS.EXPORT_CA_DATA);
        completeStore(STORAGE_KEYS.IMPORT_CA_DATA);
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
        width: 2450,
        windowWidth: 2450,
        scale: 2.5,
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
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas to Blob conversion failed')), 'image/png');
      });
      
      const result = await sendPhotoToTelegram(unit, blob, '', signal);

      // Also generate & send 2-sheet Signed CA Excel document (.xlsx)
      try {
        const unsignedOutItems = unitData?.unsignedOutItems || [];
        const unsignedInItems = unitData?.unsignedInItems || [];
        const excelBlob = generateSignedCAExcelBlob(unsignedOutItems, unsignedInItems, unit);
        const filename = `SIGNED_CA_${unit}_${new Date().toISOString().slice(0, 10)}.xls`;
        await sendDocumentToTelegram(unit, excelBlob, filename, '', signal);
      } catch (excelErr) {
        console.error('Error sending Signed CA Excel file:', excelErr);
      }
      
      if (result && result.success) {
        completeStore(STORAGE_KEYS.EXPORT_CA_DATA);
        completeStore(STORAGE_KEYS.IMPORT_CA_DATA);
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
            width: 2450,
            windowWidth: 2450,
            scale: 2.5,
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
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas to Blob conversion failed')), 'image/png');
          });
          
          const sendRes = await sendPhotoToTelegram(unit, blob, '', signal);

          // Also generate & send 2-sheet Signed CA Excel document (.xlsx)
          try {
            const unsignedOutItems = unitData?.unsignedOutItems || [];
            const unsignedInItems = unitData?.unsignedInItems || [];
            const excelBlob = generateSignedCAExcelBlob(unsignedOutItems, unsignedInItems, unit);
            const filename = `SIGNED_CA_${unit}_${new Date().toISOString().slice(0, 10)}.xls`;
            await sendDocumentToTelegram(unit, excelBlob, filename, '', signal);
          } catch (excelErr) {
            console.error('Error sending Signed CA Excel file:', excelErr);
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
        completeStore(STORAGE_KEYS.EXPORT_CA_DATA);
        completeStore(STORAGE_KEYS.IMPORT_CA_DATA);
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

  const sendSummaryImageScreenshotAll = async () => {
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
      setSummaryImageMode(true);
      for (const unit of units) {
        if (signal.aborted) {
          results.push({ unit, success: false, error: 'Cancelled', aborted: true });
          failCount++;
          completedCount++;
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
          await new Promise(resolve => setTimeout(resolve, 400));
          
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          
          const element = document.getElementById('telegram-summary-report');
          if (!element) {
            throw new Error('Summary report element not found in DOM');
          }
          
          const offsetHeight = element.offsetHeight || 600;
          
          const canvas = await html2canvas(element, {
            useCORS: true,
            scale: 3.0,
            backgroundColor: '#ffffff',
            width: 1200,
            height: offsetHeight,
            scrollX: 0,
            scrollY: 0,
            windowWidth: document.documentElement.offsetWidth,
            windowHeight: document.documentElement.offsetHeight,
            logging: false,
            onclone: (clonedDoc) => {
              const style = clonedDoc.createElement('style');
              style.innerHTML = `
                #telegram-summary-report * {
                  -webkit-font-smoothing: antialiased !important;
                  -moz-osx-font-smoothing: grayscale !important;
                  text-rendering: optimizeLegibility !important;
                }
              `;
              clonedDoc.head.appendChild(style);
            }
          });
          
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          
          const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas to Blob conversion failed')), 'image/png');
          });
          
          const sendRes = await sendPhotoToTelegram(unit, blob, '', signal);
          
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
          await new Promise(resolve => setTimeout(resolve, 600));
        }
      }
      
      if (successCount > 0 && !signal.aborted) {
        completeStore(STORAGE_KEYS.EXPORT_CA_DATA);
        completeStore(STORAGE_KEYS.IMPORT_CA_DATA);
      }
      
      setSendResults({
        total: units.length,
        success: successCount,
        failed: failCount
      });
    } catch (err) {
      console.error('Error sending all summary images:', err);
    } finally {
      setScreenshotUnit(null);
      setSummaryImageMode(false);
      setIsSelectingForSummary(false);
      setIsSending(false);
      if (!signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  const getSummaryRows = () => {
    const rows = [];
    const unitsToProcess = screenshotUnit ? [screenshotUnit] : allUnits;
    
    unitsToProcess.forEach(unit => {
      const outItems = stockOutData.filter(item => item.unit === unit);
      const inItems = stockInData.filter(item => item.unit === unit);
      
      const teamsSet = new Set();
      outItems.forEach(item => {
        const teamName = cleanWarehouseName(item.exportWarehouse || item.unitEntering || '');
        if (teamName && teamName !== '-') teamsSet.add(teamName);
      });
      inItems.forEach(item => {
        const teamName = cleanWarehouseName(item.warehouse || '');
        if (teamName && teamName !== '-') teamsSet.add(teamName);
      });
      
      const teams = Array.from(teamsSet).sort((a, b) => a.localeCompare(b));
      
      teams.forEach(team => {
        const teamOutItems = outItems.filter(item => {
          const tName = cleanWarehouseName(item.exportWarehouse || item.unitEntering || '');
          return tName === team;
        });
        
        const teamInItems = inItems.filter(item => {
          const tName = cleanWarehouseName(item.warehouse || '');
          return tName === team;
        });
        
        const isStatus = (item, status) => {
          const s = (item.statusCA || '').toLowerCase();
          if (status === 'unsigned') return s.includes('unsigned') || s === '';
          if (status === 'signing') return s.includes('signing') || s.includes('is signing');
          if (status === 'cancel') return s.includes('cancel') || s.includes('cancelled');
          return false;
        };
        
        // Stock out
        const sOutUnsignedOver = teamOutItems.filter(item => isStatus(item, 'unsigned') && (parseInt(item.daysDiff) || 0) > 1).length;
        const sOutUnsignedTotal = teamOutItems.filter(item => isStatus(item, 'unsigned')).length;
        
        const sOutSigningUnder = teamOutItems.filter(item => isStatus(item, 'signing') && (parseInt(item.daysDiff) || 0) <= 4).length;
        const sOutSigningOver = teamOutItems.filter(item => isStatus(item, 'signing') && (parseInt(item.daysDiff) || 0) > 4).length;
        const sOutSigningTotal = teamOutItems.filter(item => isStatus(item, 'signing')).length;
        
        const sOutCancelUnder = teamOutItems.filter(item => isStatus(item, 'cancel') && (parseInt(item.daysDiff) || 0) <= 4).length;
        const sOutCancelOver = teamOutItems.filter(item => isStatus(item, 'cancel') && (parseInt(item.daysDiff) || 0) > 4).length;
        const sOutCancelTotal = teamOutItems.filter(item => isStatus(item, 'cancel')).length;
        
        const sOutTotal = sOutUnsignedTotal + sOutSigningTotal + sOutCancelTotal;
        
        // Stock in
        const sInUnsignedOver = teamInItems.filter(item => isStatus(item, 'unsigned') && (parseInt(item.daysDiff) || 0) > 1).length;
        const sInUnsignedTotal = teamInItems.filter(item => isStatus(item, 'unsigned')).length;
        
        const sInSigningUnder = teamInItems.filter(item => isStatus(item, 'signing') && (parseInt(item.daysDiff) || 0) <= 4).length;
        const sInSigningOver = teamInItems.filter(item => isStatus(item, 'signing') && (parseInt(item.daysDiff) || 0) > 4).length;
        const sInSigningTotal = teamInItems.filter(item => isStatus(item, 'signing')).length;
        
        const sInCancelUnder = teamInItems.filter(item => isStatus(item, 'cancel') && (parseInt(item.daysDiff) || 0) <= 4).length;
        const sInCancelOver = teamInItems.filter(item => isStatus(item, 'cancel') && (parseInt(item.daysDiff) || 0) > 4).length;
        const sInCancelTotal = teamInItems.filter(item => isStatus(item, 'cancel')).length;
        
        const sInTotal = sInUnsignedTotal + sInSigningTotal + sInCancelTotal;
        
        // Totals
        const outUnderKpi = (sOutUnsignedTotal - sOutUnsignedOver) + sOutSigningUnder + sOutCancelUnder;
        const inUnderKpi = (sInUnsignedTotal - sInUnsignedOver) + sInSigningUnder + sInCancelUnder;
        const underKpi = outUnderKpi + inUnderKpi;
        
        const outOverKpi = sOutUnsignedOver + sOutSigningOver + sOutCancelOver;
        const inOverKpi = sInUnsignedOver + sInSigningOver + sInCancelOver;
        const overKpi = outOverKpi + inOverKpi;
        
        const total = underKpi + overKpi;
        
        rows.push({
          unit,
          team,
          sOutUnsignedOver,
          sOutUnsignedTotal,
          sOutSigningUnder,
          sOutSigningOver,
          sOutSigningTotal,
          sOutCancelUnder,
          sOutCancelOver,
          sOutCancelTotal,
          sOutTotal,
          sInUnsignedOver,
          sInUnsignedTotal,
          sInSigningUnder,
          sInSigningOver,
          sInSigningTotal,
          sInCancelUnder,
          sInCancelOver,
          sInCancelTotal,
          sInTotal,
          underKpi,
          overKpi,
          total
        });
      });
    });
    return rows;
  };

  const sendSummaryImageScreenshot = async (unit) => {
    if (isSending) return;
    
    if (!hasGroupId(unit)) {
      alert(`⚠️ No group ID configured for ${unit}. Please add it first.`);
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
      setScreenshotUnit(unit);
      setSummaryImageMode(true);

      await new Promise(resolve => setTimeout(resolve, 400));

      const element = document.getElementById('telegram-summary-report');
      if (!element) {
        throw new Error('Summary report element not found in DOM');
      }

      const offsetHeight = element.offsetHeight || 600;
      
      const canvas = await html2canvas(element, {
        useCORS: true,
        scale: 3.0,
        backgroundColor: '#ffffff',
        width: 1200,
        height: offsetHeight,
        scrollX: 0,
        scrollY: 0,
        windowWidth: document.documentElement.offsetWidth,
        windowHeight: document.documentElement.offsetHeight,
        logging: false,
        onclone: (clonedDoc) => {
          const style = clonedDoc.createElement('style');
          style.innerHTML = `
            #telegram-summary-report * {
              -webkit-font-smoothing: antialiased !important;
              -moz-osx-font-smoothing: grayscale !important;
              text-rendering: optimizeLegibility !important;
            }
          `;
          clonedDoc.head.appendChild(style);
        }
      });

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob || blob.size < 1000) {
        throw new Error('Failed to generate summary image');
      }

      const result = await sendPhotoToTelegram(
        unit,
        blob,
        '',
        abortControllerRef.current.signal
      );

      if (result && result.success) {
        completeStore(STORAGE_KEYS.EXPORT_CA_DATA);
        completeStore(STORAGE_KEYS.IMPORT_CA_DATA);
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
      } else {
        throw new Error(result?.error || 'Failed to send summary image');
      }
    } catch (err) {
      console.error('Error sending summary image:', err);
      setSendProgress({
        current: 1,
        total: 1,
        unit: unit,
        status: 'failed',
        error: err.message
      });
      setSendResults({
        total: 1,
        success: 0,
        failed: 1
      });
    } finally {
      setScreenshotUnit(null);
      setSummaryImageMode(false);
      setIsSelectingForSummary(false);
      setIsSending(false);
      if (!abortControllerRef.current?.signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  const renderSummaryReport = () => {
    if (!summaryImageMode || !screenshotUnit) return null;
    
    const rows = getSummaryRows();
    
    // Grand Totals Stock Out
    const totalOutUnsignedOver = rows.reduce((sum, r) => sum + r.sOutUnsignedOver, 0);
    const totalOutUnsignedTotal = rows.reduce((sum, r) => sum + r.sOutUnsignedTotal, 0);
    const totalOutSigningUnder = rows.reduce((sum, r) => sum + r.sOutSigningUnder, 0);
    const totalOutSigningOver = rows.reduce((sum, r) => sum + r.sOutSigningOver, 0);
    const totalOutSigningTotal = rows.reduce((sum, r) => sum + r.sOutSigningTotal, 0);
    const totalOutCancelUnder = rows.reduce((sum, r) => sum + r.sOutCancelUnder, 0);
    const totalOutCancelOver = rows.reduce((sum, r) => sum + r.sOutCancelOver, 0);
    const totalOutCancelTotal = rows.reduce((sum, r) => sum + r.sOutCancelTotal, 0);
    const totalOutTotal = rows.reduce((sum, r) => sum + r.sOutTotal, 0);

    // Grand Totals Stock In
    const totalInUnsignedOver = rows.reduce((sum, r) => sum + r.sInUnsignedOver, 0);
    const totalInUnsignedTotal = rows.reduce((sum, r) => sum + r.sInUnsignedTotal, 0);
    const totalInSigningUnder = rows.reduce((sum, r) => sum + r.sInSigningUnder, 0);
    const totalInSigningOver = rows.reduce((sum, r) => sum + r.sInSigningOver, 0);
    const totalInSigningTotal = rows.reduce((sum, r) => sum + r.sInSigningTotal, 0);
    const totalInCancelUnder = rows.reduce((sum, r) => sum + r.sInCancelUnder, 0);
    const totalInCancelOver = rows.reduce((sum, r) => sum + r.sInCancelOver, 0);
    const totalInCancelTotal = rows.reduce((sum, r) => sum + r.sInCancelTotal, 0);
    const totalInTotal = rows.reduce((sum, r) => sum + r.sInTotal, 0);

    // Grand Totals Overall
    const totalUnder = rows.reduce((sum, r) => sum + r.underKpi, 0);
    const totalOver = rows.reduce((sum, r) => sum + r.overKpi, 0);
    const totalAll = totalUnder + totalOver;
    
    const formatVal = (val) => val === 0 ? '-' : val;
    
    return (
      <div
        id="telegram-summary-report"
        style={{
          position: 'absolute',
          left: '0',
          top: '0',
          zIndex: -9999,
          pointerEvents: 'none',
          width: '1200px',
          background: '#f8fafc',
          padding: '24px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
        }}
      >
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-sm mb-4 flex justify-between items-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-amber-500 to-purple-500"></div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg">📊</span>
              <h1 className="text-base font-black text-slate-800 tracking-tight uppercase">
                CA Signing KPI Summary Report
              </h1>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600 font-bold uppercase">
              <span>Branch:</span>
              <span className="bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-md border border-blue-100 font-black tracking-wider text-[10px]">
                {screenshotUnit}
              </span>
            </div>
          </div>
          <div className="text-right text-[10px] font-semibold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
            <div>Date: <strong className="text-slate-900">{new Date().toLocaleDateString('en-GB')}</strong></div>
            <div className="mt-0.5">Time: <strong className="text-slate-900">{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</strong></div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-3">
            <span className="text-base">👥</span>
            <div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block leading-none">Active Teams</span>
              <span className="text-sm font-black text-slate-800 mt-1 block leading-none">{rows.length}</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-3">
            <span className="text-base">✅</span>
            <div>
              <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider block leading-none">Under KPI (On-Time)</span>
              <span className="text-sm font-black text-emerald-600 mt-1 block leading-none">{totalUnder}</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-3">
            <span className="text-base">🚨</span>
            <div>
              <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider block leading-none">Over KPI (Delayed)</span>
              <span className="text-sm font-black text-red-600 mt-1 block leading-none">{totalOver}</span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full text-center border-collapse table-fixed text-[10px] font-bold text-slate-700">
            <thead>
              <tr className="text-white text-[10px]">
                <th rowSpan="4" className="bg-[#1e293b] border-r border-slate-700 w-[40px] py-4 align-middle text-center font-black uppercase tracking-wider">NO</th>
                <th rowSpan="4" className="bg-[#1e293b] border-r border-slate-700 w-[65px] py-4 align-middle text-center font-black uppercase tracking-wider leading-tight">CODE<br/>BRANCH</th>
                <th rowSpan="4" className="bg-[#1e293b] border-r border-slate-700 w-[180px] py-4 align-middle text-left px-3 font-black uppercase tracking-wider leading-normal">UNITS NAME</th>
                
                <th colSpan="9" className="bg-blue-600 border-r border-blue-700 border-b border-blue-700/60 py-2 font-bold uppercase tracking-wider text-[9.5px]">
                  STOCK OUT RECEIPT
                </th>
                <th colSpan="9" className="bg-amber-600 border-r border-amber-700 border-b border-amber-700/60 py-2 font-bold uppercase tracking-wider text-[9.5px]">
                  STOCK IN RECEIPT
                </th>
                <th colSpan="3" className="bg-red-600 border-b border-red-700/60 py-2 font-bold uppercase tracking-wider text-[9.5px] align-middle text-center">
                  TOTAL
                </th>
              </tr>
              <tr className="text-white text-[9px]">
                <th colSpan="2" className="bg-blue-700 border-r border-blue-800/60 border-b border-blue-800/40 py-1.5 font-bold">Unsigned</th>
                <th colSpan="3" className="bg-blue-700 border-r border-blue-800/60 border-b border-blue-800/40 py-1.5 font-bold">Is signing</th>
                <th colSpan="3" className="bg-blue-700 border-r border-blue-800/60 border-b border-blue-800/40 py-1.5 font-bold">Cancel</th>
                <th colSpan="1" className="bg-blue-800 border-r border-blue-900 border-b border-blue-900/60 py-1.5 font-bold">Total</th>

                <th colSpan="2" className="bg-amber-700 border-r border-amber-800/60 border-b border-amber-800/40 py-1.5 font-bold">Unsigned</th>
                <th colSpan="3" className="bg-amber-700 border-r border-amber-800/60 border-b border-amber-800/40 py-1.5 font-bold">Is signing</th>
                <th colSpan="3" className="bg-amber-700 border-r border-amber-800/60 border-b border-amber-800/40 py-1.5 font-bold">Cancel</th>
                <th colSpan="1" className="bg-amber-800 border-r border-amber-900 border-b border-amber-900/60 py-1.5 font-bold">Total</th>
                
                <th colSpan="3" className="bg-red-650 border-r border-red-750 border-b border-red-750/60 py-1.5 font-bold text-white text-[9px] text-center">KPI SUMMARY</th>
              </tr>
              <tr className="text-[8.5px] font-extrabold">
                <th colSpan="2" className="bg-blue-50 text-blue-800 border-r border-blue-200 border-b border-blue-200/60 py-1">KPI = 1DAYS</th>
                <th colSpan="3" className="bg-blue-50 text-blue-800 border-r border-blue-200 border-b border-blue-200/60 py-1">KPI = 7DAYS</th>
                <th colSpan="3" className="bg-blue-50 text-blue-800 border-r border-blue-200 border-b border-blue-200/60 py-1">KPI = 7DAYS</th>
                <th colSpan="1" className="bg-blue-850 text-white border-r border-blue-900 border-b border-blue-950/60 py-1 font-bold text-[8.5px]">Summary</th>

                <th colSpan="2" className="bg-amber-50 text-amber-800 border-r border-amber-200 border-b border-amber-200/60 py-1">KPI = 1DAYS</th>
                <th colSpan="3" className="bg-amber-50 text-amber-800 border-r border-amber-200 border-b border-amber-200/60 py-1">KPI = 7DAYS</th>
                <th colSpan="3" className="bg-amber-50 text-amber-800 border-r border-amber-200 border-b border-amber-200/60 py-1">KPI = 7DAYS</th>
                <th colSpan="1" className="bg-amber-850 text-white border-r border-amber-900 border-b border-amber-955/60 py-1 font-bold text-[8.5px]">Summary</th>
                
                <th colSpan="3" className="bg-red-700 border-r border-red-800 border-b border-red-800/60 py-1 font-bold text-red-200 uppercase tracking-wider text-[8.5px] align-middle text-center">KPI TARGETS</th>
              </tr>
              <tr className="bg-slate-100 text-slate-650 text-[8.5px] font-black border-b border-slate-300">
                <th className="border-r border-blue-100 py-1.5 text-red-700 bg-red-100 font-extrabold">Day &gt; 1</th>
                <th className="border-r border-blue-200 py-1.5 text-blue-900 bg-blue-100/40">Total</th>
                <th className="border-r border-blue-100 py-1.5 text-blue-750 bg-blue-50/40">Day &lt;= 4</th>
                <th className="border-r border-blue-100 py-1.5 text-red-700 bg-red-100 font-extrabold">Day &gt; 4</th>
                <th className="border-r border-blue-200 py-1.5 text-blue-900 bg-blue-100/40">Total</th>
                <th className="border-r border-blue-100 py-1.5 text-blue-750 bg-blue-50/40">Day &lt;= 4</th>
                <th className="border-r border-blue-100 py-1.5 text-red-700 bg-red-100 font-extrabold">Day &gt; 4</th>
                <th className="border-r border-blue-250 py-1.5 text-blue-900 bg-blue-100/40">Total</th>
                <th className="border-r border-slate-200 py-1.5 bg-blue-200/50 text-blue-955">Total</th>

                <th className="border-r border-amber-100 py-1.5 text-red-700 bg-red-100 font-extrabold">Day &gt; 1</th>
                <th className="border-r border-amber-200 py-1.5 text-amber-900 bg-amber-100/40">Total</th>
                <th className="border-r border-amber-100 py-1.5 text-amber-750 bg-amber-50/40">Day &lt;= 4</th>
                <th className="border-r border-amber-100 py-1.5 text-red-700 bg-red-100 font-extrabold">Day &gt; 4</th>
                <th className="border-r border-amber-200 py-1.5 text-amber-900 bg-amber-100/40">Total</th>
                <th className="border-r border-amber-100 py-1.5 text-amber-750 bg-amber-50/40">Day &lt;= 4</th>
                <th className="border-r border-amber-100 py-1.5 text-red-700 bg-red-100 font-extrabold">Day &gt; 4</th>
                <th className="border-r border-amber-250 py-1.5 text-amber-900 bg-amber-100/40">Total</th>
                <th className="border-r border-slate-200 py-1.5 bg-amber-200/50 text-amber-955">Total</th>

                <th className="border-r border-red-200 py-1.5 bg-red-700 text-white font-bold text-[8.5px]">Under KPI</th>
                <th className="border-r border-red-200 py-1.5 bg-red-700 text-white font-bold text-[8.5px]">Over KPI</th>
                <th className="py-1.5 bg-red-800 text-white font-bold text-[8.5px]">Total</th>
              </tr>
              
              <tr className="bg-slate-50 text-slate-800 font-black text-[10px] border-b border-slate-300 shadow-inner">
                <td colSpan="3" className="border-r border-slate-300 text-center py-2 uppercase tracking-wider text-slate-950">TEAM</td>
                
                <td className={`border-r border-blue-100 py-2 bg-blue-50/10 ${totalOutUnsignedOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalOutUnsignedOver)}</td>
                <td className="border-r border-blue-200 py-2 bg-blue-50/10">{formatVal(totalOutUnsignedTotal)}</td>
                <td className="border-r border-blue-100 py-2 bg-blue-50/10">{formatVal(totalOutSigningUnder)}</td>
                <td className={`border-r border-blue-100 py-2 bg-blue-50/10 ${totalOutSigningOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalOutSigningOver)}</td>
                <td className="border-r border-blue-200 py-2 bg-blue-50/10">{formatVal(totalOutSigningTotal)}</td>
                <td className="border-r border-blue-100 py-2 bg-blue-50/10">{formatVal(totalOutCancelUnder)}</td>
                <td className={`border-r border-blue-100 py-2 bg-blue-50/10 ${totalOutCancelOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalOutCancelOver)}</td>
                <td className="border-r border-blue-250 py-2 bg-blue-50/10">{formatVal(totalOutCancelTotal)}</td>
                <td className="border-r border-slate-200 py-2 bg-blue-100 text-blue-900 font-black">{formatVal(totalOutTotal)}</td>

                <td className={`border-r border-amber-100 py-2 bg-amber-50/10 ${totalInUnsignedOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalInUnsignedOver)}</td>
                <td className="border-r border-amber-200 py-2 bg-amber-50/10">{formatVal(totalInUnsignedTotal)}</td>
                <td className="border-r border-amber-100 py-2 bg-amber-50/10">{formatVal(totalInSigningUnder)}</td>
                <td className={`border-r border-amber-100 py-2 bg-amber-50/10 ${totalInSigningOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalInSigningOver)}</td>
                <td className="border-r border-amber-200 py-2 bg-amber-50/10">{formatVal(totalInSigningTotal)}</td>
                <td className="border-r border-amber-100 py-2 bg-amber-50/10">{formatVal(totalInCancelUnder)}</td>
                <td className={`border-r border-amber-100 py-2 bg-amber-50/10 ${totalInCancelOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalInCancelOver)}</td>
                <td className="border-r border-amber-250 py-2 bg-amber-50/10">{formatVal(totalInCancelTotal)}</td>
                <td className="border-r border-slate-200 py-2 bg-amber-100 text-amber-900 font-black">{formatVal(totalInTotal)}</td>

                <td className="border-r border-red-100 py-2 bg-red-50/10 text-red-800 font-bold">{formatVal(totalUnder)}</td>
                <td className={`border-r border-red-200 py-2 bg-red-50/10 ${totalOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalOver)}</td>
                <td className="py-2 bg-red-200 text-red-950 font-black text-[10.5px]">{formatVal(totalAll)}</td>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 bg-white">
              {rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50 transition-colors odd:bg-white even:bg-slate-50/20 text-slate-700">
                  <td className="border-r border-slate-200 py-1.5 font-bold text-slate-400">{idx + 1}</td>
                  <td className="border-r border-slate-200 py-1.5 font-bold text-slate-800">{row.unit}</td>
                  <td className="border-r border-slate-200 py-1.5 text-left px-3 font-semibold text-slate-900 break-all">{row.team}</td>
                  
                  <td className={`border-r border-slate-150 py-1.5 bg-blue-50/5 ${row.sOutUnsignedOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(row.sOutUnsignedOver)}</td>
                  <td className="border-r border-slate-150 py-1.5 bg-blue-50/5 font-medium text-slate-650">{formatVal(row.sOutUnsignedTotal)}</td>
                  <td className="border-r border-slate-150 py-1.5 bg-blue-50/5 font-medium text-slate-650">{formatVal(row.sOutSigningUnder)}</td>
                  <td className={`border-r border-slate-150 py-1.5 bg-blue-50/5 ${row.sOutSigningOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(row.sOutSigningOver)}</td>
                  <td className="border-r border-slate-150 py-1.5 bg-blue-50/5 font-medium text-slate-650">{formatVal(row.sOutSigningTotal)}</td>
                  <td className="border-r border-slate-150 py-1.5 bg-blue-50/5 font-medium text-slate-650">{formatVal(row.sOutCancelUnder)}</td>
                  <td className={`border-r border-slate-150 py-1.5 bg-blue-50/5 ${row.sOutCancelOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(row.sOutCancelOver)}</td>
                  <td className="border-r border-slate-150 py-1.5 bg-blue-50/5 font-medium text-slate-650">{formatVal(row.sOutCancelTotal)}</td>
                  <td className="border-r border-slate-200 py-1.5 bg-blue-100/10 text-blue-900 font-bold">{formatVal(row.sOutTotal)}</td>

                  <td className={`border-r border-slate-150 py-1.5 bg-amber-50/5 ${row.sInUnsignedOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(row.sInUnsignedOver)}</td>
                  <td className="border-r border-slate-150 py-1.5 bg-amber-50/5 font-medium text-slate-650">{formatVal(row.sInUnsignedTotal)}</td>
                  <td className="border-r border-slate-150 py-1.5 bg-amber-50/5 font-medium text-slate-650">{formatVal(row.sInSigningUnder)}</td>
                  <td className={`border-r border-slate-150 py-1.5 bg-amber-50/5 ${row.sInSigningOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(row.sInSigningOver)}</td>
                  <td className="border-r border-slate-150 py-1.5 bg-amber-50/5 font-medium text-slate-650">{formatVal(row.sInSigningTotal)}</td>
                  <td className="border-r border-slate-150 py-1.5 bg-amber-50/5 font-medium text-slate-650">{formatVal(row.sInCancelUnder)}</td>
                  <td className={`border-r border-slate-150 py-1.5 bg-amber-50/5 ${row.sInCancelOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(row.sInCancelOver)}</td>
                  <td className="border-r border-slate-150 py-1.5 bg-amber-50/5 font-medium text-slate-650">{formatVal(row.sInCancelTotal)}</td>
                  <td className="border-r border-slate-200 py-1.5 bg-amber-100/10 text-amber-900 font-bold">{formatVal(row.sInTotal)}</td>

                  <td className="border-r border-slate-200 py-1.5 bg-red-50/5 text-red-700 font-bold">{formatVal(row.underKpi)}</td>
                  <td className={`border-r border-slate-200 py-1.5 bg-red-50/5 ${row.overKpi > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(row.overKpi)}</td>
                  <td className="py-1.5 bg-red-100/10 text-red-950 font-black">{formatVal(row.total)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan="24" className="py-12 text-center text-slate-400 font-medium bg-slate-50/50 text-xs">
                    🎉 Outstanding completion! No pending unsigned CA items found under this branch.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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

    const unsignedOutItems = unitData.unsignedOutItems || [];
    const unsignedInItems = unitData.unsignedInItems || [];
    const remain = unsignedOutItems.length + unsignedInItems.length;

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
        className="w-[2450px] bg-slate-50 p-5 font-sans relative flex flex-col gap-4 text-left border border-slate-300 rounded-2xl shadow-sm"
        style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          zIndex: -9999,
          boxSizing: 'border-box'
        }}
      >
        {/* Compact Excel Header Bar */}
        <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 px-5 py-3 rounded-xl text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-4">
            <span className="text-[16px] font-black tracking-tight flex items-center gap-1.5">
              📍 BRANCH: <span className="text-yellow-300 font-black">{unit}</span>
            </span>
            <span className="text-[12px] bg-rose-600 text-white font-extrabold px-3 py-1 rounded-lg border border-rose-400/40 shadow-2xs">
              ⏳ Remain: {remain}
            </span>
          </div>
          <span className="text-[12px] text-slate-300 font-bold">
            🕐 {timeStr} | 📅 {dateStr}
          </span>
        </div>

        {/* Export CA Section */}
        <div className="border border-slate-300 bg-white rounded-xl overflow-hidden shadow-2xs">
          <div className="bg-slate-100 px-4 py-2 border-b border-slate-300 text-[13px] font-black text-slate-800 flex justify-between items-center">
            <span className="flex items-center gap-1.5 text-slate-900">📤 EXPORT CA</span>
            <span className={unsignedOutItems.length === 0 ? "text-emerald-700 bg-emerald-50 px-3 py-0.5 rounded-full border border-emerald-200 font-extrabold text-[11px]" : "text-blue-700 bg-blue-50 px-3 py-0.5 rounded-full border border-blue-200 font-extrabold text-[11px]"}>
              {unsignedOutItems.length === 0 ? "✅ Completed" : `📋 ${unsignedOutItems.length} Items`}
            </span>
          </div>
          {unsignedOutItems.length > 0 ? (
            <table className="w-full text-left border-collapse text-[11.5px]">
              <thead>
                <tr className="bg-slate-700 text-white font-bold border-b border-slate-300 text-[12px]">
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-10">#</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[200px]">Export Note Code</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[190px]">Export Command Code</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[150px]">Export Request</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[125px]">Requester</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[95px]">Date Create</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[95px]">Date Export</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[150px]">Export Warehouse</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[120px]">Reason</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[150px]">Warehouse Entering</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[125px]">Unit Entering</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[135px]">Construction Code</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[85px]">Status</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[100px]">Disapprove</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[90px]">Status CA</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[120px]">Description</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[70px]">Unit</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[60px]">Days ⚠️</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-center w-[140px]">TEAM</th>
                  <th className="px-2 py-1.5 text-center w-[60px]">Year</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {unsignedOutItems.map((item, index) => (
                  <tr key={index} className="odd:bg-white even:bg-slate-50/70 hover:bg-slate-100/50">
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-bold text-slate-400">{index + 1}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-bold text-slate-900 font-mono whitespace-nowrap">{item.exportNoteCode || item.code || '-'}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-bold text-slate-700 font-mono whitespace-nowrap">{item.exportCommandCode || item.commandCode || '-'}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 whitespace-nowrap">{item.exportRequest || item.requestCode || '-'}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-bold text-slate-800 whitespace-nowrap">{item.requester || item.creator || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600 whitespace-nowrap">{item.dateCreate || item.date || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600 whitespace-nowrap">{item.dateExport || item.exportDate || '-'}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 whitespace-nowrap">{cleanWarehouseName(item.exportWarehouse || item.warehouse || '-')}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 text-slate-600 whitespace-nowrap">{item.reason || '-'}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 whitespace-nowrap">{cleanWarehouseName(item.warehouseEntering || item.enteringWarehouse || '-')}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 whitespace-nowrap">{cleanWarehouseName(item.unitEntering || item.enteringUnit || '-')}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 text-slate-600 whitespace-nowrap">{item.constructionCode || item.construction || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-semibold whitespace-nowrap">{item.status || '-'}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 text-slate-600 whitespace-nowrap">{item.disapprove || item.disapproveReason || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-bold whitespace-nowrap">
                      {item.statusCA === 'Is signing' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">Is signing ⚠️</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">{item.statusCA || 'Unsigned'}</span>
                      )}
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 text-slate-600 whitespace-nowrap">{item.description || item.note || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-extrabold text-slate-800 whitespace-nowrap">{item.unit || unit || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-black whitespace-nowrap">{getDelayBadge(item.daysDiff)}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-black text-slate-900 text-center whitespace-nowrap">{item.team || getTeamFromWarehouse(item.unitEntering || item.exportWarehouse || '-')}</td>
                    <td className="px-2 py-1.5 text-center font-semibold text-slate-600 whitespace-nowrap">{item.year || (item.dateCreate ? item.dateCreate.split('/')[2] : (item.date ? item.date.split('/')[2] : '-'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-3 text-center text-emerald-700 font-bold text-[11px] bg-emerald-50/30">
              🎉 All items cleared!
            </div>
          )}
        </div>

        {/* Import CA Section */}
        <div className="border border-slate-300 bg-white rounded-xl overflow-hidden shadow-2xs">
          <div className="bg-slate-100 px-4 py-2 border-b border-slate-300 text-[13px] font-black text-slate-800 flex justify-between items-center">
            <span className="flex items-center gap-1.5 text-slate-900">📥 IMPORT CA</span>
            <span className={unsignedInItems.length === 0 ? "text-emerald-700 bg-emerald-50 px-3 py-0.5 rounded-full border border-emerald-200 font-extrabold text-[11px]" : "text-blue-700 bg-blue-50 px-3 py-0.5 rounded-full border border-blue-200 font-extrabold text-[11px]"}>
              {unsignedInItems.length === 0 ? "✅ Completed" : `📋 ${unsignedInItems.length} Items`}
            </span>
          </div>
          {unsignedInItems.length > 0 ? (
            <table className="w-full text-left border-collapse text-[11.5px]">
              <thead>
                <tr className="bg-slate-700 text-white font-bold border-b border-slate-300 text-[12px]">
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-10">#</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[210px]">Receipt Code</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[190px]">Command Code</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[100px]">Date</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[170px]">Warehouse</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-left w-[140px]">Creator</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[85px]">Status</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[90px]">Status CA</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[70px]">Unit</th>
                  <th className="border-r border-slate-600 px-2 py-1.5 text-center w-[60px]">Days ⚠️</th>
                  <th className="border-r border-slate-600 px-2.5 py-1.5 text-center w-[150px]">TEAM</th>
                  <th className="px-2 py-1.5 text-center w-[60px]">Year</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {unsignedInItems.map((item, index) => (
                  <tr key={index} className="odd:bg-white even:bg-slate-50/70 hover:bg-slate-100/50">
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-bold text-slate-400">{index + 1}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-bold text-slate-900 font-mono whitespace-nowrap">{item.receiptCode || item.code || '-'}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-bold text-slate-700 font-mono whitespace-nowrap">{item.commandCode || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-600 whitespace-nowrap">{item.date || item.dateCreate || '-'}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 whitespace-nowrap">{cleanWarehouseName(item.warehouse || '-')}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-bold text-slate-800 whitespace-nowrap">{item.creator || item.requester || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-semibold whitespace-nowrap">{item.status || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-bold whitespace-nowrap">
                      {item.statusCA === 'Is signing' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">Is signing ⚠️</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">{item.statusCA || 'Unsigned'}</span>
                      )}
                    </td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-extrabold text-slate-800 whitespace-nowrap">{item.unit || unit || '-'}</td>
                    <td className="border-r border-slate-200 px-2 py-1.5 text-center font-black whitespace-nowrap">{getDelayBadge(item.daysDiff)}</td>
                    <td className="border-r border-slate-200 px-2.5 py-1.5 font-black text-slate-900 text-center whitespace-nowrap">{item.team || getTeamFromWarehouse(item.warehouse || '-')}</td>
                    <td className="px-2 py-1.5 text-center font-semibold text-slate-600 whitespace-nowrap">{item.year || (item.date ? item.date.split('/')[2] : '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-3 text-center text-emerald-700 font-bold text-[11px] bg-emerald-50/30">
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
                របាយការណ៍បង្កាន់ដៃដែលមិនទាន់បញ្ជាក់ និងមិនទាន់ចុះហត្ថលេខា CA ក្នុងប្រព័ន្ធ
              </h1>
              <span className="bg-slate-800 text-slate-300 text-[10px] px-2.5 py-0.5 rounded border border-slate-700 font-semibold flex items-center gap-1.5 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Active • {currentTime.toLocaleTimeString()}
              </span>
            </div>
            <p className="text-slate-400 mt-1.5 text-xs sm:text-sm font-semibold uppercase tracking-wider">Signed CA Status Overview</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="bg-slate-800 text-slate-300 px-3 py-1.5 rounded border border-slate-700 text-xs font-mono">
              📅 {currentTime.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>
      </div>
      {/* ─── TELEGRAM BOT OVERVIEW ─── */}
      {null}

      {/* ─── SUMMARY CARDS ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 border-l-4 border-blue-500 hover:shadow-md transition-all duration-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Records</div>
              <div className="text-2xl font-bold text-slate-800 mt-1 font-mono">{formatNumber(stats.overall.total)}</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
            <span className="text-emerald-600 font-semibold">✓ {stats.overall.signing} Signing</span>
            <span className="w-px h-3 bg-gray-300"></span>
            <span className="text-rose-600 font-semibold">✗ {stats.overall.unsigned} Unsigned</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 border-l-4 border-emerald-500 hover:shadow-md transition-all duration-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Signing</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">{formatNumber(stats.overall.signing)}</div>
            </div>
          </div>
          <div className="mt-3">
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className={`h-2 rounded-full ${getProgressColor(stats.overall.rate)} transition-all duration-500`} style={{ width: `${stats.overall.rate}%` }}></div>
            </div>
            <div className={`text-[10px] font-bold mt-1 ${getRateColor(stats.overall.rate)}`}>
              {stats.overall.rate.toFixed(1)}% Complete
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 border-l-4 border-purple-500 hover:shadow-md transition-all duration-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Stock Out</div>
              <div className="text-2xl font-bold text-purple-600 mt-1 font-mono">{formatNumber(stats.totalStockOut.total)}</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
            <span className="text-emerald-600 font-semibold">✓ {stats.totalStockOut.signing}</span>
            <span className="w-px h-3 bg-gray-300"></span>
            <span className="text-rose-600 font-semibold">✗ {stats.totalStockOut.unsigned}</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 border-l-4 border-amber-500 hover:shadow-md transition-all duration-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Stock In</div>
              <div className="text-2xl font-bold text-amber-600 mt-1 font-mono">{formatNumber(stats.totalStockIn.total)}</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
            <span className="text-emerald-600 font-semibold">✓ {stats.totalStockIn.signing}</span>
            <span className="w-px h-3 bg-gray-300"></span>
            <span className="text-rose-600 font-semibold">✗ {stats.totalStockIn.unsigned}</span>
          </div>
        </div>
      </div>

      {/* ─── PERFORMANCE TABLE ─── */}
      <div className="bg-white rounded-xl border border-slate-200/85 p-6 mb-6 shadow-sm">
        <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
          Performance by Module
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
              {/* Row 1: Stock Out Signing */}
              <tr className="hover:bg-blue-50/50 transition-colors">
                <td className="px-4 py-3.5 text-sm font-medium text-gray-900 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600"></span>
                  01 STOCK OUT IS SIGNING
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    value={editMorningStockOut}
                    onChange={(e) => setEditMorningStockOut(e.target.value)}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-xl text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-gray-50"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    value={editEveningStockOut}
                    onChange={(e) => setEditEveningStockOut(e.target.value)}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-xl text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-gray-50"
                  />
                </td>
                <td className="px-4 py-3.5 text-sm text-right font-semibold text-amber-600">
                  {stockOutRemain}
                </td>
                <td className="px-4 py-3.5 text-sm text-right font-semibold text-emerald-600">
                  {stockOutResult}
                </td>
                <td className="px-4 py-3.5 text-sm text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="font-semibold text-gray-800">{stockOutRatio}%</span>
                    <div className="w-16 bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min(100, parseFloat(stockOutRatio))}%` }}></div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-sm text-right text-gray-500">
                  {stockOutInSystem}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={handleUpdateStockOut}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
                  >
                    Update
                  </button>
                </td>
              </tr>

              {/* Row 2: Stock In Signing */}
              <tr className="hover:bg-emerald-50/50 transition-colors">
                <td className="px-4 py-3.5 text-sm font-medium text-gray-900 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600"></span>
                  02 STOCK IN IS SIGNING
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    value={editMorningStockIn}
                    onChange={(e) => setEditMorningStockIn(e.target.value)}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-xl text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-gray-50"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    value={editEveningStockIn}
                    onChange={(e) => setEditEveningStockIn(e.target.value)}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-xl text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-gray-50"
                  />
                </td>
                <td className="px-4 py-3.5 text-sm text-right font-semibold text-amber-600">
                  {stockInRemain}
                </td>
                <td className="px-4 py-3.5 text-sm text-right font-semibold text-emerald-600">
                  {stockInResult}
                </td>
                <td className="px-4 py-3.5 text-sm text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="font-semibold text-gray-800">{stockInRatio}%</span>
                    <div className="w-16 bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min(100, parseFloat(stockInRatio))}%` }}></div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-sm text-right text-gray-500">
                  {stockInInSystem}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={handleUpdateStockIn}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
                  >
                    Update
                  </button>
                </td>
              </tr>
            </tbody>
            <tfoot className="bg-gray-50 font-bold border-t border-gray-200">
              <tr>
                <td className="px-4 py-3 text-sm text-gray-900">សរុប (TOTAL)</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totalMorning}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totalEvening}</td>
                <td className="px-4 py-3 text-sm text-right text-amber-600">{totalRemain}</td>
                <td className="px-4 py-3 text-sm text-right text-emerald-600">{totalResult}</td>
                <td className="px-4 py-3 text-sm text-right text-gray-900">
                  <div className="flex items-center justify-end gap-2 font-bold">
                    <span>{totalRatio}%</span>
                    <div className="w-16 bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, parseFloat(totalRatio))}%` }}></div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-500">{totalInSystem}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {null}

      {renderProgressModal()}

      {createPortal(renderScreenshotReport(), document.body)}
      {createPortal(renderSummaryReport(), document.body)}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
        .animate-slideUp {
          animation: slideUp 0.3s ease-out;
        }
        .max-h-48 {
          max-height: 12rem;
        }
        .max-h-48::-webkit-scrollbar {
          width: 4px;
        }
        .max-h-48::-webkit-scrollbar-track {
          background: transparent;
        }
        .max-h-48::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
};

export default Dashboard_CA;