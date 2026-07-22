import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { loadFromDb, saveToDb, clearStore, isStoreDraft } from '../../services/dbStore';

// Storage Keys
const STORAGE_KEYS = {
  DATA: 'export_ca_data',
  COMPLETION: 'export_ca_completionHistory',
  TARGETS: 'export_ca_targets',
  TARGET_HISTORY: 'export_ca_targetHistory',
  CONFIRMED: 'export_ca_confirmedStatus',
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

// Complete list of all possible Units
const allUnits = [
  'BAN', 'BAT', 'CHA', 'CHH', 'KAM', 'KAN', 'KANZ1', 'KOH', 'KRA',
  'MON', 'ODD', 'PNP', 'PNPZ1', 'PNPZ2', 'PRE', 'PRH', 'PUR', 'ROT',
  'SIE', 'SIH', 'SPE', 'STU', 'SVA', 'TAK', 'THO'
];

// 🎯 UNIT EXTRACTION LOGIC (Priority: Warehouse → Note Code → Command Code)

// 1. ចាប់យក Unit ពី Export Warehouse
const getUnitFromWarehouse = (warehouse) => {
  if (!warehouse) return null;
  
  let normalized = warehouse.toUpperCase().replace(/\s+/g, '');
  normalized = normalized.replace(/FB_TEAMC/g, 'FBC').replace(/FB_TEAM/g, 'FBC');
  
  // PNP Planning Department
  if (normalized.includes('PNP_PLA_PLANNING') || normalized.includes('PNP_PLANNING')) {
    return 'PNP';
  }
  
  // KAN Planning Department
  if (normalized.includes('KAN_PLA_PLANNING') || normalized.includes('KAN_PLANNING')) {
    return 'KAN';
  }
  
  // PNP FBC (PNPZ1 / PNPZ2)
  if (normalized.includes('PNP_FBC') || normalized.includes('PNP_FBCO') || normalized.includes('PNPFBC')) {
    const pnpz1Codes = ['FBC01', 'FBC03', 'FBC05', 'FBCO5', 'FBC06', 'FBC07', 'FBC10', 'FBC11', 'FBC13', 'FBC14'];
    const pnpz2Codes = ['FBC02', 'FBC04', 'FBC08', 'FBC09', 'FBC12'];
    
    if (pnpz1Codes.some(code => normalized.includes(code))) {
      return 'PNPZ1';
    }
    if (pnpz2Codes.some(code => normalized.includes(code))) {
      return 'PNPZ2';
    }
    return 'PNPZ1';
  }
  
  // KAN FBC (KANZ1)
  if (normalized.includes('KAN_FBC') || normalized.includes('KANFBC')) {
    return 'KANZ1';
  }

  // SOS fallback
  if (normalized.includes('SOS')) {
    if (normalized.includes('PNP')) return 'PNP';
    if (normalized.includes('KAN')) return 'KAN';
  }

  // PLA fallback
  if (normalized.includes('PLA')) {
    if (normalized.includes('PNP')) return 'PNP';
    if (normalized.includes('KAN')) return 'KAN';
  }
  
  // Standard GIS_XXX_ or XXX_ pattern
  const parts = normalized.split('_');
  if (parts.length >= 1) {
    const unitCode = parts[0] === 'GIS' && parts.length >= 2 ? parts[1] : parts[0];
    if (allUnits.includes(unitCode)) return unitCode;
    if (unitCode === 'KANZ') return 'KANZ1';
    if (unitCode === 'PNPZ') return 'PNPZ1';
  }
  
  return null;
};

// 2. ចាប់យក Unit ពី Export Note Code
const getUnitFromNoteCode = (noteCode) => {
  if (!noteCode) return null;
  
  const upper = noteCode.toUpperCase().replace(/FB_TEAMC/g, 'FBC').replace(/FB_TEAM/g, 'FBC');
  
  // ពិនិត្យលំនាំ PXKGIS_XXX ឬ PXKXXX
  const match = upper.match(/(?:PXK|LNK)(?:GIS_)?([A-Z0-9_]+)/);
  if (match && match[1]) {
    const codePart = match[1];
    
    // FBC → PNPZ1, PNPZ2, KANZ1
    if (codePart.includes('FBC')) {
      if (codePart.startsWith('PNP_')) {
        const fbcNum = codePart.match(/FBC(\d+)/);
        if (fbcNum) {
          const num = parseInt(fbcNum[1]);
          if ([1, 3, 5, 6, 7, 10, 11, 13, 14].includes(num)) return 'PNPZ1';
          if ([2, 4, 8, 9, 12].includes(num)) return 'PNPZ2';
        }
        return 'PNPZ1';
      }
      if (codePart.startsWith('KAN_')) {
        return 'KANZ1';
      }
    }
    
    // SOS → PNP, KAN
    if (codePart.includes('SOS')) {
      if (codePart.startsWith('PNP_')) return 'PNP';
      if (codePart.startsWith('KAN_')) return 'KAN';
    }
    
    // PLA → PNP, KAN
    if (codePart.includes('PLA')) {
      if (codePart.startsWith('PNP_')) return 'PNP';
      if (codePart.startsWith('KAN_')) return 'KAN';
    }
    
    // TEC → PNP, KAN
    if (codePart.includes('TEC')) {
      if (codePart.startsWith('PNP_')) return 'PNP';
      if (codePart.startsWith('KAN_')) return 'KAN';
    }
    
    // ចាប់យក Unit ដំបូង
    const unitMatch = codePart.match(/^([A-Z]+)/);
    if (unitMatch && unitMatch[1]) {
      const unit = unitMatch[1];
      if (allUnits.includes(unit)) return unit;
      if (unit === 'PNPZ') return 'PNPZ1';
      if (unit === 'KANZ') return 'KANZ1';
    }
  }
  
  return null;
};

// 3. ចាប់យក Unit ពី Export Command Code
const getUnitFromCommandCode = (commandCode) => {
  if (!commandCode) return null;
  
  const upper = commandCode.toUpperCase().replace(/FB_TEAMC/g, 'FBC').replace(/FB_TEAM/g, 'FBC');
  
  // ពិនិត្យលំនាំ LXKGIS_XXX ឬ LXKXXX
  const match = upper.match(/(?:PXK|LNK)(?:GIS_)?([A-Z0-9_]+)/);
  if (match && match[1]) {
    const codePart = match[1];
    
    // FBC → PNPZ1, PNPZ2, KANZ1
    if (codePart.includes('FBC')) {
      if (codePart.startsWith('PNP_')) {
        const fbcNum = codePart.match(/FBC(\d+)/);
        if (fbcNum) {
          const num = parseInt(fbcNum[1]);
          if ([1, 3, 5, 6, 7, 10, 11, 13, 14].includes(num)) return 'PNPZ1';
          if ([2, 4, 8, 9, 12].includes(num)) return 'PNPZ2';
        }
        return 'PNPZ1';
      }
      if (codePart.startsWith('KAN_')) {
        return 'KANZ1';
      }
    }
    
    // SOS → PNP, KAN
    if (codePart.includes('SOS')) {
      if (codePart.startsWith('PNP_')) return 'PNP';
      if (codePart.startsWith('KAN_')) return 'KAN';
    }
    
    // PLA → PNP, KAN
    if (codePart.includes('PLA')) {
      if (codePart.startsWith('PNP_')) return 'PNP';
      if (codePart.startsWith('KAN_')) return 'KAN';
    }
    
    // TEC → PNP, KAN
    if (codePart.includes('TEC')) {
      if (codePart.startsWith('PNP_')) return 'PNP';
      if (codePart.startsWith('KAN_')) return 'KAN';
    }
    
    // ចាប់យក Unit ដំបូង
    const unitMatch = codePart.match(/^([A-Z]+)/);
    if (unitMatch && unitMatch[1]) {
      const unit = unitMatch[1];
      if (allUnits.includes(unit)) return unit;
      if (unit === 'PNPZ') return 'PNPZ1';
      if (unit === 'KANZ') return 'KANZ1';
    }
  }
  
  return null;
};

// 0. ចាប់យក Unit សម្រាប់ PNP / KAN (PNPZ1, PNPZ2, PNP, KANZ1, KAN)
const getUnitFromText = (text) => {
  if (!text) return null;
  const upper = String(text).toUpperCase();
  const isPNP = upper.includes('PNP');
  const isKAN = upper.includes('KAN');

  if (isPNP) {
    if (upper.includes('FBC') || upper.includes('FB_TEAM')) {
      const match = upper.match(/FBC[^\d]*(\d+)/i) || upper.match(/FB_?TEAM_?(\d+)/i);
      if (match) {
        const num = String(parseInt(match[1], 10)).padStart(2, '0');
        if (['02', '04', '08', '09', '12'].includes(num)) return 'PNPZ2';
        if (['01', '03', '05', '06', '07', '10', '11', '13', '14'].includes(num)) return 'PNPZ1';
      }
      return 'PNPZ1';
    }
    return 'PNP';
  }

  if (isKAN) {
    if (upper.includes('FBC') || upper.includes('FB_TEAM')) {
      return 'KANZ1';
    }
    return 'KAN';
  }

  return null;
};

// 4. មុខងារចាប់យក Unit សំខាន់ (Main) - អាទិភាព Warehouse → Note Code → Command Code
const getUnit = (exportWarehouse, exportNoteCode, exportCommandCode) => {
  const textUnit = getUnitFromText(exportWarehouse) || getUnitFromText(exportNoteCode) || getUnitFromText(exportCommandCode);
  if (textUnit) return textUnit;

  const unitFromWarehouse = getUnitFromWarehouse(exportWarehouse);
  if (unitFromWarehouse && allUnits.includes(unitFromWarehouse)) return unitFromWarehouse;

  const unitFromNote = getUnitFromNoteCode(exportNoteCode);
  if (unitFromNote && allUnits.includes(unitFromNote)) return unitFromNote;

  const unitFromCommand = getUnitFromCommandCode(exportCommandCode);
  if (unitFromCommand && allUnits.includes(unitFromCommand)) return unitFromCommand;

  return 'OTHER';
};

export const getTeamFromWarehouse = (warehouse) => {
  if (!warehouse || warehouse === '-') return '-';
  const upper = String(warehouse).trim().toUpperCase();

  let province = '';
  const gisMatch = upper.match(/^GIS_([A-Z0-9]+)_/);
  if (gisMatch) {
    province = gisMatch[1];
  } else {
    const directMatch = upper.match(/^([A-Z0-9]+)_/);
    if (directMatch) province = directMatch[1];
  }
  if (!province) province = 'UNK';

  if (upper.includes('PLANNING') || upper.includes('_PLA')) {
    return `GIS_${province}_PLA_PLANNING DEPT`;
  }

  const fbcMatch = upper.match(/FBC[^\d]*(\d+)/i);
  if (fbcMatch) {
    const num = String(parseInt(fbcMatch[1], 10)).padStart(2, '0');
    if (upper.includes('FBCTEAM') || upper.includes('FB_TEAM')) {
      return `GIS_${province}_FBCTEAM${num}`;
    }
    return `GIS_${province}_FBC_TEAM${num}`;
  }

  const sosMatch = upper.match(/SOS[^\d]*(\d+)/i);
  if (sosMatch) {
    const num = String(parseInt(sosMatch[1], 10)).padStart(2, '0');
    if (upper.includes('SOSTEAM') || upper.includes('SOS_TEAM')) {
      return `GIS_${province}_SOS_TEAM${num}`;
    }
    return `GIS_${province}_SOS_TEAM${num}`;
  }

  return upper;
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

export const Export_CA = ({ user }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const isUnitUser = user && user.role === 'unit' && user.unit;
  const userUnit = user?.unit;
  const isLoaded = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const [data, setData] = useState(() => getStorageData(STORAGE_KEYS.DATA) || []);
  const [completionHistory, setCompletionHistory] = useState(() => getStorageData(STORAGE_KEYS.COMPLETION) || []);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAlarmModal, setShowAlarmModal] = useState(false);
  const [alarmThreshold, setAlarmThreshold] = useState(7);
  const [dismissedItems, setDismissedItems] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteData, setPasteData] = useState('');
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [showKPIModal, setShowKPIModal] = useState(false);
  const [showTargetHistoryModal, setShowTargetHistoryModal] = useState(false);
  const [targets, setTargets] = useState(() => getStorageData(STORAGE_KEYS.TARGETS) || {});
  const [targetHistory, setTargetHistory] = useState(() => getStorageData(STORAGE_KEYS.TARGET_HISTORY) || []);
  const [editingTarget, setEditingTarget] = useState(null);
  const [kpiViewMode, setKpiViewMode] = useState('all');
  const [kpiSortBy, setKpiSortBy] = useState('unit');
  const [kpiSortOrder, setKpiSortOrder] = useState('asc');
  const [confirmedStatus, setConfirmedStatus] = useState(() => getStorageData(STORAGE_KEYS.CONFIRMED) || {});

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Load data from DB on mount
  useEffect(() => {
    const fetchDbData = async () => {
      const dbData = await loadFromDb(STORAGE_KEYS.DATA, []);
      const filtered = dbData.filter(item => {
        const sCA = (item.statusCA || '').toUpperCase().trim();
        return sCA.includes('UNSIGNED') || 
               sCA.includes('IS SIGNING') || 
               sCA.includes('ISSIGNING') || 
               sCA.includes('TRÌNH KÝ') || 
               sCA.includes('TRINH KY') ||
               sCA.includes('CANCEL') ||
               sCA.includes('HỦY') ||
               sCA.includes('HUY');
      });
      setData(filtered);
      
      const dbCompletion = await loadFromDb(STORAGE_KEYS.COMPLETION, []);
      setCompletionHistory(dbCompletion);

      const dbTargets = await loadFromDb(STORAGE_KEYS.TARGETS, {});
      setTargets(dbTargets);

      const dbTargetHistory = await loadFromDb(STORAGE_KEYS.TARGET_HISTORY, []);
      setTargetHistory(dbTargetHistory);

      const dbConfirmed = await loadFromDb(STORAGE_KEYS.CONFIRMED, {});
      setConfirmedStatus(dbConfirmed);
      
      isLoaded.current = true;
    };
    fetchDbData();
  }, []);

  // Sync to database
  useEffect(() => {
    if (isLoaded.current) {
      saveToDb(STORAGE_KEYS.DATA, data);
    }
  }, [data]);

  useEffect(() => {
    if (isLoaded.current) {
      saveToDb(STORAGE_KEYS.COMPLETION, completionHistory);
    }
  }, [completionHistory]);

  useEffect(() => {
    if (isLoaded.current) {
      saveToDb(STORAGE_KEYS.TARGETS, targets);
    }
  }, [targets]);

  useEffect(() => {
    if (isLoaded.current) {
      saveToDb(STORAGE_KEYS.TARGET_HISTORY, targetHistory);
    }
  }, [targetHistory]);

  useEffect(() => {
    if (isLoaded.current) {
      saveToDb(STORAGE_KEYS.CONFIRMED, confirmedStatus);
    }
  }, [confirmedStatus]);



  // Columns
  const columns = [
    { key: 'no', label: '#', width: 'w-12' },
    { key: 'exportNoteCode', label: 'Export Note Code', width: 'w-36' },
    { key: 'exportCommandCode', label: 'Export Command Code', width: 'w-36' },
    { key: 'exportRequest', label: 'Export Request', width: 'w-32' },
    { key: 'createRequester', label: 'Requester', width: 'w-28' },
    { key: 'dateCreate', label: 'Date Create', width: 'w-24' },
    { key: 'dateExport', label: 'Date Export', width: 'w-24' },
    { key: 'exportWarehouse', label: 'Export Warehouse', width: 'w-40' },
    { key: 'reasonExport', label: 'Reason', width: 'w-32' },
    { key: 'nameWarehouseEntering', label: 'Warehouse Entering', width: 'w-32' },
    { key: 'unitEntering', label: 'Unit Entering', width: 'w-20' },
    { key: 'codeConstruction', label: 'Construction Code', width: 'w-28' },
    { key: 'status', label: 'Status', width: 'w-32' },
    { key: 'disapproveNot', label: 'Disapprove', width: 'w-20' },
    { key: 'statusCA', label: 'Status CA', width: 'w-24' },
    { key: 'description', label: 'Description', width: 'w-48' },
    { key: 'unit', label: 'Unit', width: 'w-20' },
    { key: 'daysDiff', label: 'Days', width: 'w-16' },
    { key: 'team', label: 'TEAM', width: 'w-36' },
    { key: 'year', label: 'Year', width: 'w-16' },
  ];

  // Helper functions
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

  const extractYearFromDate = (dateString) => {
    if (!dateString) return '';
    const parts = dateString.split(/[/\s:]+/);
    if (parts.length >= 3) {
      let year = parseInt(parts[2]);
      if (year < 100) year += 2000;
      return year.toString();
    }
    return '';
  };



  const getStatusCABadge = (statusCA) => {
    const s = (statusCA || '').toUpperCase();
    if (s.includes('UNSIGNED') || s.includes('CHƯA') || s.includes('CHUA')) {
      return (
        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl text-[10px] font-bold bg-rose-600 text-white animate-pulse border border-rose-700 shadow-sm">
          🚨 {statusCA}
        </span>
      );
    }
    if (s.includes('IS SIGNING') || s.includes('ISSIGNING') || s.includes('ĐANG') || s.includes('DANG')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
          ✍️ {statusCA}
        </span>
      );
    }
    return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">❓ {statusCA}</span>;
  };

  const getStatusBadge = (status) => {
    const upper = (status || '').toUpperCase();
    const isCompleted = upper.includes('ACTUAL EXPORT ALL') || upper.includes('THỰC XUẤT HẾT') || upper.includes('THUC XUAT HET');
    if (isCompleted) {
      return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">✅ {status}</span>;
    }
    return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-800">⏳ {status}</span>;
  };

  const getDisapproveNotBadge = (value) => {
    if (value) {
      return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-800">❌ {value}</span>;
    }
    return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">-</span>;
  };

  const getWarehouseBadge = (warehouse) => {
    if (warehouse && warehouse.toUpperCase().includes('GIS')) {
      return <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-800">{warehouse}</span>;
    }
    return <span className="text-gray-600">{warehouse}</span>;
  };

  const playAlarmSound = () => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 880;
      gainNode.gain.value = 0.3;
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        audioContext.close();
      }, 500);
    } catch (e) {
      console.log('Audio not supported');
    }
  };

  const showNotification = (message, type = 'alarm') => {
    const colors = {
      alarm: 'bg-rose-600',
      success: 'bg-emerald-600',
      info: 'bg-blue-600',
      warning: 'bg-amber-500'
    };
    const icons = {
      alarm: '🚨',
      success: '✅',
      info: '📊',
      warning: '⚠️'
    };
    const titles = {
      alarm: 'ALARM DETECTED!',
      success: 'Success!',
      info: 'Info',
      warning: 'Warning'
    };

    const notification = document.createElement('div');
    notification.className = `fixed top-20 right-4 z-50 p-4 rounded-2xl shadow-2xl transform transition-all duration-500 animate-slideIn ${colors[type] || 'bg-gray-600'} text-white max-w-sm`;
    notification.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="text-2xl animate-bounce">${icons[type] || '📌'}</div>
        <div class="flex-1">
          <div class="font-bold text-sm">${titles[type] || 'Notification'}</div>
          <div class="text-xs opacity-90 whitespace-pre-line">${message}</div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" class="text-white/70 hover:text-white text-lg leading-none">✕</button>
      </div>
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 4000);
  };

  const autoCreateTargetForUnit = (unit, dataCount) => {
    const newTarget = Math.max(dataCount, 1);
    const currentHour = new Date().getHours();
    const isMorning = currentHour < 12;
    const period = isMorning ? 'morning' : 'evening';

    setTargets(prev => ({
      ...prev,
      [unit]: {
        ...prev[unit],
        [period]: newTarget,
        lastUpdated: new Date().toISOString()
      }
    }));

    setTargetHistory(prev => [{
      id: Date.now(),
      unit: unit,
      period: period,
      oldTarget: null,
      newTarget: newTarget,
      changedAt: new Date().toISOString(),
      changedBy: 'System (Auto)',
      reason: `Auto-created target based on ${dataCount} record(s)`
    }, ...prev]);
    return newTarget;
  };

  const updateTargetWithHistory = (unit, period, newTargetValue) => {
    const oldTarget = targets[unit]?.[period] || 0;
    const newTarget = parseInt(newTargetValue) || 0;
    if (oldTarget === newTarget) return;
    setTargets(prev => ({
      ...prev,
      [unit]: {
        ...prev[unit],
        [period]: newTarget,
        lastUpdated: new Date().toISOString()
      }
    }));
    setTargetHistory(prev => [{
      id: Date.now(),
      unit: unit,
      period: period,
      oldTarget: oldTarget,
      newTarget: newTarget,
      changedAt: new Date().toISOString(),
      changedBy: 'User',
      reason: `Manual target adjustment for ${period === 'morning' ? 'ព្រឹក' : 'ល្ងាច'}`
    }, ...prev]);
    showNotification(`📊 Target (${period === 'morning' ? 'ព្រឹក' : 'ល្ងាច'}) for ${unit} changed from ${oldTarget} to ${newTarget}`, 'info');
  };

  const processImport = async (newRawData) => {
    const isDraft = await isStoreDraft(STORAGE_KEYS.DATA);
    if (isDraft) {
      showNotification('⚠️ Current draft is not completed. New import is ignored.', 'warning');
      return;
    }
    const filteredData = newRawData.filter(item => {
      const warehouse = (item.exportWarehouse || '').toUpperCase().replace(/\s+/g, '');
      const isGIS = warehouse.includes('GIS');
      
      const statusCA = (item.statusCA || '').toUpperCase().replace(/\s+/g, ' ').trim();
      const isCAOK = statusCA.includes('UNSIGNED') || 
                     statusCA.includes('IS SIGNING') || 
                     statusCA.includes('ISSIGNING') || 
                     statusCA.includes('TRÌNH KÝ') || 
                     statusCA.includes('TRINH KY') ||
                     statusCA.includes('CANCEL') ||
                     statusCA.includes('HỦY') ||
                     statusCA.includes('HUY');
      return isGIS && isCAOK;
    });

    if (filteredData.length === 0) {
      showNotification('⚠️ No matching records found! (GIS + Unsigned/Is signing/Cancel)', 'warning');
      return;
    }

    const currentCodes = new Set(data.map(item => item.exportNoteCode));
    const newCodesSet = new Set(filteredData.map(item => item.exportNoteCode));
    
    const processedNewData = filteredData.map((item, index) => {
      // 🎯 ប្រើមុខងារ getUnit ថ្មី
      const unit = getUnit(item.exportWarehouse, item.exportNoteCode, item.exportCommandCode);
      const team = getTeamFromWarehouse(item.nameWarehouseEntering || item.exportWarehouse);
      const daysDiff = calculateDaysDiff(item.dateExport || item.dateCreate);
      const year = extractYearFromDate(item.dateExport || item.dateCreate);
      
      return {
        id: Math.max(...data.map(d => d.id), 0, index) + index + 1,
        no: index + 1,
        exportNoteCode: item.exportNoteCode || '',
        exportCommandCode: item.exportCommandCode || '',
        exportRequest: item.exportRequest || '',
        createRequester: item.createRequester || '',
        dateCreate: item.dateCreate || '',
        dateExport: item.dateExport || '',
        exportWarehouse: item.exportWarehouse || '',
        reasonExport: item.reasonExport || '',
        nameWarehouseEntering: item.nameWarehouseEntering || '',
        unitEntering: item.unitEntering || '',
        codeConstruction: item.codeConstruction || '',
        status: item.status || '',
        disapproveNot: item.disapproveNot || '',
        statusCA: item.statusCA || '',
        description: item.description || '',
        unit: unit,
        team: team,
        daysDiff: daysDiff,
        year: year,
        isCompleted: true
      };
    });
    
    const unitsInNewData = {};
    processedNewData.forEach(item => {
      if (item.unit !== 'OTHER') {
        unitsInNewData[item.unit] = (unitsInNewData[item.unit] || 0) + 1;
      }
    });
    
    const existingUnits = new Set(Object.keys(targets));
    const newUnitsFound = [];
    Object.keys(unitsInNewData).forEach(unit => {
      if (!existingUnits.has(unit)) {
        newUnitsFound.push(unit);
        autoCreateTargetForUnit(unit, unitsInNewData[unit]);
        showNotification(`🎯 Auto-created target for ${unit}: ${unitsInNewData[unit]}`, 'info');
      }
    });
    
    const completedCodesArray = [...currentCodes].filter(code => !newCodesSet.has(code));
    if (completedCodesArray.length > 0) {
      const newCompletions = completedCodesArray.map(code => {
        const foundItem = data.find(item => item.exportNoteCode === code);
        return { 
          exportNoteCode: code, 
          completedAt: new Date().toISOString(), 
          unit: foundItem?.unit || 'UNKNOWN' 
        };
      });
      setCompletionHistory(prev => [...newCompletions, ...prev]);
      completedCodesArray.forEach(code => {
        showNotification(`✅ COMPLETED: ${code} has been cleared! +1 Result`, 'success');
      });
      playAlarmSound();
    }
    
    setData(processedNewData);
    showNotification(`📊 Import Summary:\n✅ Completed: ${completedCodesArray.length}\n🆕 New Added: ${filteredData.length}\n🎯 New Units: ${newUnitsFound.length > 0 ? newUnitsFound.join(', ') : 'None'}`, 'info');
    return { completedCount: completedCodesArray.length, newCount: filteredData.length, newUnits: newUnitsFound };
  };

  // 🚫 Active valid GIS records (excluding non-GIS items and matching unit role)
  const activeRecords = useMemo(() => {
    let filtered = data;
    filtered = filtered.filter(item => 
      item.exportWarehouse && item.exportWarehouse.toUpperCase().includes('GIS')
    );
    if (isUnitUser) {
      filtered = filtered.filter(item => item.unit === userUnit || extractUnit(item) === userUnit);
    }
    return filtered;
  }, [data, isUnitUser, userUnit]);

  const calculateKPIData = useMemo(() => {
    const unitGroups = {};
    activeRecords.forEach(item => {
      const unit = item.unit;
      if (unit !== 'OTHER') {
        if (!unitGroups[unit]) {
          unitGroups[unit] = { codes: new Set(), unit: unit, count: 0, completed: 0 };
        }
        unitGroups[unit].codes.add(item.exportNoteCode);
        unitGroups[unit].count++;
        if (item.isCompleted) {
          unitGroups[unit].completed++;
        }
      }
    });
    
    const completedByUnit = {};
    completionHistory.forEach(completion => {
      if (completion.unit !== 'UNKNOWN') {
        completedByUnit[completion.unit] = (completedByUnit[completion.unit] || 0) + 1;
      }
    });
    
    Object.entries(confirmedStatus).forEach(([id, isConfirmed]) => {
      if (isConfirmed) {
        const item = data.find(d => d.id === parseInt(id));
        if (item && item.unit !== 'OTHER') {
          completedByUnit[item.unit] = (completedByUnit[item.unit] || 0) + 1;
        }
      }
    });
    
    const kpiData = [];
    let grandTargetMorning = 0;
    let grandTargetEvening = 0;
    let grandRemain = 0;
    let grandResult = 0;
    let grandTotalRecords = 0;
    const isMorning = new Date().getHours() < 12;
    
    const unitsToProcess = isUnitUser ? [userUnit] : allUnits;
    
    unitsToProcess.forEach(unit => {
      const morningTarget = targets[unit]?.morning || 0;
      const eveningTarget = targets[unit]?.evening || 0;
      const target = isMorning ? morningTarget : (eveningTarget > 0 ? eveningTarget : morningTarget);
      const currentCount = unitGroups[unit]?.count || 0;
      const completedCount = completedByUnit[unit] || 0;
      const result = completedCount;
      const remain = target > 0 ? Math.max(0, target - result) : currentCount;
      let ratio = 0;
      if (target > 0) ratio = (result / target) * 100;
      else if (currentCount === 0 && result === 0) ratio = 100;
      
      let status = 'No Data';
      if (currentCount > 0 || result > 0 || target > 0) {
        if (remain === 0 && target > 0) status = 'Completed';
        else if (ratio >= 80) status = 'Good';
        else if (ratio >= 50) status = 'Warning';
        else if (target > 0 && ratio < 50 && ratio > 0) status = 'Critical';
        else if (target === 0 && currentCount > 0) status = 'No Target';
      }
      
      kpiData.push({
        unit, morningTarget, eveningTarget, target, remain, result, ratio: Math.min(100, ratio), total: currentCount,
        status, hasData: currentCount > 0 || result > 0, isNew: !targets[unit] && currentCount > 0,
        hasChange: morningTarget !== eveningTarget && eveningTarget > 0
      });
      
      grandTargetMorning += morningTarget;
      grandTargetEvening += eveningTarget;
      grandRemain += remain;
      grandResult += result;
      grandTotalRecords += currentCount;
    });
    
    let filteredData = kpiData;
    if (kpiViewMode === 'active') filteredData = kpiData.filter(item => item.hasData && item.remain > 0);
    else if (kpiViewMode === 'completed') filteredData = kpiData.filter(item => item.hasData && item.remain === 0 && item.target > 0);
    
    filteredData.sort((a, b) => {
      let aVal, bVal;
      switch (kpiSortBy) {
        case 'ratio': aVal = a.ratio; bVal = b.ratio; break;
        case 'remain': aVal = a.remain; bVal = b.remain; break;
        case 'result': aVal = a.result; bVal = b.result; break;
        case 'morning': aVal = a.morningTarget; bVal = b.morningTarget; break;
        case 'evening': aVal = a.eveningTarget; bVal = b.eveningTarget; break;
        case 'total': aVal = a.total; bVal = b.total; break;
        default: aVal = a.unit; bVal = b.unit;
      }
      return kpiSortOrder === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });
    
    return {
      data: filteredData,
      allData: kpiData,
      summary: {
        targetMorning: grandTargetMorning,
        targetEvening: grandTargetEvening,
        remain: grandRemain,
        result: grandResult,
        ratio: grandTargetEvening > 0 ? (grandResult / grandTargetEvening) * 100 : 0,
        totalRecords: grandTotalRecords,
        activeUnits: kpiData.filter(item => item.hasData).length,
        completedUnits: kpiData.filter(item => item.hasData && item.remain === 0 && item.target > 0).length
      }
    };
  }, [activeRecords, targets, completionHistory, confirmedStatus, kpiViewMode, kpiSortBy, kpiSortOrder, isUnitUser, userUnit]);

  const parsePastedData = (text) => {
    const rows = text.split(/\r?\n/);
    const parsedRows = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i].trim();
      if (!row) continue;
      const cells = row.split(/\t| {2,}/);
      if (cells.length >= 8) {
        const firstCell = cells[0].trim().replace(/\.$/, '');
        const isSequence = /^\d+$/.test(firstCell);
        const offset = isSequence ? 1 : 0;
        
        if (cells.length - offset >= 8) {
          parsedRows.push({
            exportNoteCode: cells[offset + 0] || '',
            exportCommandCode: cells[offset + 1] || '',
            exportRequest: cells[offset + 2] || '',
            createRequester: cells[offset + 3] || '',
            dateCreate: cells[offset + 4] || '',
            dateExport: cells[offset + 5] || '',
            exportWarehouse: cells[offset + 6] || '',
            reasonExport: cells[offset + 7] || '',
            nameWarehouseEntering: cells[offset + 8] || '',
            unitEntering: cells[offset + 9] || '',
            codeConstruction: cells[offset + 10] || '',
            status: cells[offset + 11] || '',
            disapproveNot: cells[offset + 12] || '',
            statusCA: cells[offset + 13] || '',
            description: cells[offset + 14] || ''
          });
        }
      }
    }
    return parsedRows;
  };

  const handleSmartImport = () => {
    const parsedData = parsePastedData(pasteData);
    if (parsedData.length === 0) {
      showNotification('No valid data found to import!', 'warning');
      return;
    }
    processImport(parsedData);
    setShowPasteModal(false);
    setPasteData('');
  };

  const updateCell = (id, field, value) => {
    const updatedData = data.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        if (field === 'dateCreate' || field === 'dateExport') {
          const targetDate = field === 'dateExport' ? (value || item.dateCreate) : (item.dateExport || value);
          updated.daysDiff = calculateDaysDiff(targetDate);
          updated.year = extractYearFromDate(targetDate);
        }
        if (field === 'exportWarehouse' || field === 'exportNoteCode' || field === 'exportCommandCode') {
          // 🎯 ប្រើមុខងារ getUnit ថ្មី
          updated.unit = getUnit(
            field === 'exportWarehouse' ? value : item.exportWarehouse,
            field === 'exportNoteCode' ? value : item.exportNoteCode,
            field === 'exportCommandCode' ? value : item.exportCommandCode
          );
        }
        if (field === 'status') {
          const upperVal = (value || '').toUpperCase();
          updated.isCompleted = upperVal.includes('ACTUAL EXPORT ALL') || upperVal.includes('THỰC XUẤT HẾT') || upperVal.includes('THUC XUAT HET');
        }
        return updated;
      }
      return item;
    });
    setData(updatedData);
  };

  const clearAllData = async () => {
    if (window.confirm('⚠️ Are you sure you want to delete ALL data? This cannot be undone!')) {
      setData([]);
      setCompletionHistory([]);
      setTargets({});
      setConfirmedStatus({});
      
      // Clear localStorage immediately
      localStorage.removeItem(STORAGE_KEYS.DATA);
      localStorage.removeItem(STORAGE_KEYS.COMPLETION);
      localStorage.removeItem(STORAGE_KEYS.TARGETS);
      localStorage.removeItem(STORAGE_KEYS.CONFIRMED);
      
      // Show notification instantly
      showNotification('All data cleared!', 'warning');
      
      // Clear DB stores in background
      Promise.all([
        clearStore(STORAGE_KEYS.DATA),
        clearStore(STORAGE_KEYS.COMPLETION),
        clearStore(STORAGE_KEYS.TARGETS),
        clearStore(STORAGE_KEYS.CONFIRMED)
      ]).catch(err => {
        console.error("Error clearing DB store:", err);
      });
    }
  };

  const deleteSelectedRows = () => {
    if (selectedRows.size === 0) return;
    if (window.confirm(`⚠️ Delete ${selectedRows.size} row(s)?`)) {
      const deletedCodes = data.filter(item => selectedRows.has(item.id)).map(item => item.exportNoteCode);
      const newCompletions = deletedCodes.map(code => ({
        exportNoteCode: code, completedAt: new Date().toISOString(),
        unit: data.find(item => item.exportNoteCode === code)?.unit || 'UNKNOWN'
      }));
      setCompletionHistory(prev => [...newCompletions, ...prev]);
      const newData = data.filter(item => !selectedRows.has(item.id));
      setData(newData.map((item, index) => ({ ...item, no: index + 1, id: index + 1 })));
      setSelectedRows(new Set());
      showNotification(`${deletedCodes.length} item(s) marked as Completed!`, 'success');
      playAlarmSound();
    }
  };

  const updateTarget = (unit, period, newTarget) => {
    updateTargetWithHistory(unit, period, newTarget);
    setEditingTarget(null);
  };

  const handleSort = (sortBy) => {
    if (kpiSortBy === sortBy) setKpiSortOrder(kpiSortOrder === 'asc' ? 'desc' : 'asc');
    else { setKpiSortBy(sortBy); setKpiSortOrder('asc'); }
  };

  const startEdit = (id, field, value) => setEditingCell({ id, field, value });
  const saveEdit = (id, field, newValue) => { updateCell(id, field, newValue); setEditingCell(null); };
  const handleKeyPress = (e, id, field) => {
    if (e.key === 'Enter') saveEdit(id, field, e.target.value);
    else if (e.key === 'Escape') setEditingCell(null);
  };

  const toggleRowSelection = (id) => setSelectedRows(prev => {
    const newSet = new Set(prev);
    newSet.has(id) ? newSet.delete(id) : newSet.add(id);
    return newSet;
  });
  const toggleSelectAll = () => {
    if (selectedRows.size === filteredData.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(filteredData.map(item => item.id)));
  };

  const exportToExcel = () => {
    const exportData = filteredData.map(item => ({
      'No': item.no,
      'Export Note Code': item.exportNoteCode,
      'Export Command Code': item.exportCommandCode,
      'Export Request': item.exportRequest,
      'Create Requester': item.createRequester,
      'Date Create': item.dateCreate,
      'Date Export': item.dateExport,
      'Export Warehouse': item.exportWarehouse,
      'Reason export': item.reasonExport,
      'Name Warehouse Entering': item.nameWarehouseEntering,
      'Unit Entering': item.unitEntering,
      'Code Contruction': item.codeConstruction,
      'Status': item.status,
      'Disapprove not': item.disapproveNot,
      'Status CA': item.statusCA,
      'Description': item.description,
      'Unit': item.unit,
      "Q'ty of day": item.daysDiff,
      'TEAM': item.team || getTeamFromWarehouse(item.nameWarehouseEntering || item.exportWarehouse),
      'Year': item.year
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    
    const colWidths = Object.keys(exportData[0] || {}).map(key => {
      const maxLength = Math.max(
        key.toString().length,
        ...exportData.map(row => (row[key] !== undefined && row[key] !== null ? row[key].toString().length : 0))
      );
      return { wch: Math.min(Math.max(maxLength + 3, 10), 50) };
    });
    ws['!cols'] = colWidths;
    
    for (let cell in ws) {
      if (cell[0] === '!') continue;
      if (ws[cell] && typeof ws[cell] === 'object') {
        if (!ws[cell].s) ws[cell].s = {};
        ws[cell].s.alignment = { wrapText: true, vertical: 'top' };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Export CA Data');
    XLSX.writeFile(wb, `export_ca_data_${new Date().toISOString().split('T')[0]}.xlsx`);
    showNotification('📎 Export completed!', 'success');
  };

  const exportKPItoExcel = () => {
    const exportData = calculateKPIData.allData.map(item => ({
      'Unit': item.unit,
      'Target': item.target,
      'Remain': item.remain,
      'Result': item.result,
      'Ratio (%)': item.ratio.toFixed(1),
      'In System': item.total,
      'Status': item.status
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    
    const colWidths = Object.keys(exportData[0] || {}).map(key => {
      const maxLength = Math.max(
        key.toString().length,
        ...exportData.map(row => (row[key] !== undefined && row[key] !== null ? row[key].toString().length : 0))
      );
      return { wch: Math.min(Math.max(maxLength + 3, 10), 50) };
    });
    ws['!cols'] = colWidths;
    
    for (let cell in ws) {
      if (cell[0] === '!') continue;
      if (ws[cell] && typeof ws[cell] === 'object') {
        if (!ws[cell].s) ws[cell].s = {};
        ws[cell].s.alignment = { wrapText: true, vertical: 'top' };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Export CA KPI');
    XLSX.writeFile(wb, `export_ca_kpi_${new Date().toISOString().split('T')[0]}.xlsx`);
    showNotification('📎 KPI Export completed!', 'success');
  };

  // 🎯 FILTER: Show matching warehouses (GIS only)
  const filteredData = useMemo(() => {
    let filtered = activeRecords;
    if (searchTerm) {
      const term = searchTerm.trim().toLowerCase();
      const isTermUnit = allUnits.some(u => u.toLowerCase() === term) || term === 'other';

      filtered = filtered.filter(item => {
        if (isTermUnit) {
          return (item.unit || '').toLowerCase() === term;
        }
        return (
          item.exportNoteCode?.toLowerCase().includes(term) ||
          item.exportCommandCode?.toLowerCase().includes(term) ||
          item.exportRequest?.toLowerCase().includes(term) ||
          item.createRequester?.toLowerCase().includes(term) ||
          item.exportWarehouse?.toLowerCase().includes(term) ||
          item.reasonExport?.toLowerCase().includes(term) ||
          item.nameWarehouseEntering?.toLowerCase().includes(term) ||
          item.unitEntering?.toLowerCase().includes(term) ||
          item.codeConstruction?.toLowerCase().includes(term) ||
          item.unit?.toLowerCase().includes(term) ||
          item.team?.toLowerCase().includes(term) ||
          item.status?.toLowerCase().includes(term) ||
          item.statusCA?.toLowerCase().includes(term) ||
          item.description?.toLowerCase().includes(term)
        );
      });
    }
    return filtered;
  }, [activeRecords, searchTerm]);

  const totalItems = filteredData.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [filteredData.length, totalPages, currentPage]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredData.slice(startIndex, startIndex + pageSize);
  }, [filteredData, currentPage, pageSize]);

  const alarmItems = useMemo(() => {
    return filteredData.filter(item => (item.daysDiff >= alarmThreshold || (item.statusCA && (item.statusCA.toUpperCase().includes('UNSIGNED') || item.statusCA.toUpperCase().includes('CHƯA') || item.statusCA.toUpperCase().includes('CHUA')))) && !dismissedItems.has(item.id));
  }, [filteredData, alarmThreshold, dismissedItems]);

  const [alarmSearchTerm, setAlarmSearchTerm] = useState('');
  const [selectedAlarmUnit, setSelectedAlarmUnit] = useState('');

  const alarmUnits = useMemo(() => {
    const units = alarmItems.map(item => item.unit).filter(Boolean);
    return [...new Set(units)].sort();
  }, [alarmItems]);

  const filteredAlarmItems = useMemo(() => {
    let filtered = alarmItems;
    if (selectedAlarmUnit) {
      filtered = filtered.filter(item => item.unit === selectedAlarmUnit);
    }
    if (alarmSearchTerm.trim()) {
      const term = alarmSearchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        item.unit?.toLowerCase().includes(term) ||
        item.exportNoteCode?.toLowerCase().includes(term) ||
        item.exportWarehouse?.toLowerCase().includes(term) ||
        item.createRequester?.toLowerCase().includes(term)
      );
    }
    return filtered;
  }, [alarmItems, alarmSearchTerm, selectedAlarmUnit]);

  const copyAlarmsToClipboard = () => {
    if (filteredAlarmItems.length === 0) return;
    const text = filteredAlarmItems.map(item => 
      `${item.unit}\n| Export Note: ${item.exportNoteCode}\n📅 Date Create: ${item.dateCreate} | Year: ${item.year} | ⏰ Delay: +${item.daysDiff} days\nWarehouse: ${item.exportWarehouse || '-'}`
    ).join('\n\n');
    navigator.clipboard.writeText(text);
    showNotification('📋 Alarm list copied to clipboard!', 'success');
  };

  useEffect(() => {
    setData(prevData => {
      let changed = false;
      const updated = prevData.map(item => {
        const targetDate = item.dateExport || item.dateCreate;
        const currentDaysDiff = calculateDaysDiff(targetDate);
        const currentYear = extractYearFromDate(targetDate);
        if (item.daysDiff !== currentDaysDiff || item.year !== currentYear) {
          changed = true;
          return { ...item, daysDiff: currentDaysDiff, year: currentYear };
        }
        return item;
      });
      return changed ? updated : prevData;
    });
  }, []);

  useEffect(() => {
    if (alarmItems.length > 0) {
      let shownIds = new Set();
      try {
        const stored = sessionStorage.getItem('shown_export_ca_alarms');
        if (stored) shownIds = new Set(JSON.parse(stored));
      } catch (e) {}

      const newAlarms = alarmItems.filter(item => !shownIds.has(item.id));
      if (newAlarms.length > 0) {
        setShowAlarmModal(true);
        playAlarmSound();
        alarmItems.forEach(item => shownIds.add(item.id));
        try {
          sessionStorage.setItem('shown_export_ca_alarms', JSON.stringify([...shownIds]));
        } catch (e) {}
      }
    }
  }, [alarmItems]);
  const getDaysColor = (days) => {
    if (days < 0) return 'text-rose-600 bg-rose-50';
    if (days >= alarmThreshold) return 'text-rose-700 bg-rose-100 animate-pulse';
    if (days === 0) return 'text-amber-600 bg-amber-50';
    if (days <= 3) return 'text-yellow-600 bg-yellow-50';
    return 'text-emerald-600 bg-emerald-50';
  };

  const getStatusBadgeKPI = (status) => {
    const config = {
      'Completed': { icon: '✅', bg: 'bg-emerald-100', text: 'text-emerald-800' },
      'Good': { icon: '📈', bg: 'bg-blue-100', text: 'text-blue-800' },
      'Warning': { icon: '⚠️', bg: 'bg-amber-100', text: 'text-amber-800' },
      'Critical': { icon: '🚨', bg: 'bg-rose-100', text: 'text-rose-800' },
      'No Target': { icon: '❓', bg: 'bg-orange-100', text: 'text-orange-800' },
      'No Data': { icon: '📭', bg: 'bg-gray-100', text: 'text-gray-500' }
    };
    const c = config[status] || config['No Data'];
    return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.icon} {status}</span>;
  };

  const alarmCount = alarmItems.length;

  // ─── MODALS ───
  const renderTargetHistoryModal = () => {
    if (!showTargetHistoryModal) return null;
    return (
      <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
        <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col border border-gray-100 animate-scaleIn">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📜</span>
                <h2 className="text-xl font-bold text-white">Target Change History</h2>
              </div>
              <button onClick={() => setShowTargetHistoryModal(false)} className="text-white/80 hover:text-white text-2xl">✕</button>
            </div>
          </div>
          <div className="p-6 overflow-y-auto flex-1">
            {(() => {
              const displayHistory = isUnitUser 
                ? targetHistory.filter(h => h.unit === userUnit)
                : targetHistory;

              if (displayHistory.length === 0) {
                return (
                  <div className="text-center text-gray-500 py-8">
                    <div className="text-4xl mb-2">📭</div>
                    <p>No target changes recorded yet.</p>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {displayHistory.map(history => (
                    <div key={history.id} className="bg-gray-50 rounded-xl p-4 border-l-4 border-blue-500">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-bold text-lg">{history.unit}</div>
                          <div className="text-sm text-gray-600">
                            {history.oldTarget !== null ? (
                              <>Changed from <span className="line-through text-rose-500">{history.oldTarget}</span> → <span className="text-emerald-600 font-bold">{history.newTarget}</span></>
                            ) : (<>Auto-created target: <span className="text-emerald-600 font-bold">{history.newTarget}</span></>)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">{history.reason} | By: {history.changedBy}</div>
                        </div>
                        <div className="text-xs text-gray-400">{new Date(history.changedAt).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          <div className="p-4 border-t bg-gray-50 flex justify-end">
            <button onClick={() => setShowTargetHistoryModal(false)} className="px-4 py-2 bg-gray-200 rounded-xl hover:bg-gray-300 transition-colors">Close</button>
          </div>
        </div>
      </div>
    );
  };

  const renderKPIModal = () => {
    if (!showKPIModal) return null;
    return (
      <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
        <div className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col border border-gray-100 animate-scaleIn">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📊</span>
                <div>
                  <h2 className="text-xl font-bold text-white">KPI Dashboard - Export CA Performance</h2>
                  <p className="text-purple-100 text-sm">Complete Unit Performance | Dynamic Target Management</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowTargetHistoryModal(true)} className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-xl text-sm transition-colors">📜 History</button>
                <button onClick={() => setShowKPIModal(false)} className="text-white/80 hover:text-white text-2xl">✕</button>
              </div>
            </div>
          </div>
          <div className="p-6 overflow-y-auto flex-1">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-xs opacity-90">Target ព្រឹក</div>
                <div className="text-2xl font-bold">{calculateKPIData.summary.targetMorning}</div>
              </div>
              <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-xs opacity-90">Target ល្ងាច</div>
                <div className="text-2xl font-bold">{calculateKPIData.summary.targetEvening}</div>
              </div>
              <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-xs opacity-90">Remaining</div>
                <div className="text-2xl font-bold">{calculateKPIData.summary.remain}</div>
              </div>
              <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-xs opacity-90">Result</div>
                <div className="text-2xl font-bold">{calculateKPIData.summary.result}</div>
              </div>
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-xs opacity-90">Ratio</div>
                <div className="text-2xl font-bold">{calculateKPIData.summary.ratio.toFixed(1)}%</div>
              </div>
              <div className="bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-xs opacity-90">In System</div>
                <div className="text-2xl font-bold">{calculateKPIData.summary.totalRecords}</div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-6">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Overall Progress (based on Evening Target)</span>
                <span className="font-bold">{calculateKPIData.summary.ratio.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-500 to-blue-500 h-4 rounded-full transition-all duration-500" style={{ width: `${calculateKPIData.summary.ratio}%` }}></div>
              </div>
            </div>

            {/* View Mode Tabs */}
            <div className="flex gap-2 mb-4 border-b pb-2">
              <button onClick={() => setKpiViewMode('all')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${kpiViewMode === 'all' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>📋 All ({calculateKPIData.allData.length})</button>
              <button onClick={() => setKpiViewMode('active')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${kpiViewMode === 'active' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>🔄 Active</button>
              <button onClick={() => setKpiViewMode('completed')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${kpiViewMode === 'completed' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>✅ Completed</button>
            </div>

            {/* KPI Table */}
            <div className="border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700" onClick={() => handleSort('unit')}>
                        Unit {kpiSortBy === 'unit' && (kpiSortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700" onClick={() => handleSort('morning')}>
                        ព្រឹក {kpiSortBy === 'morning' && (kpiSortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700" onClick={() => handleSort('evening')}>
                        ល្ងាច {kpiSortBy === 'evening' && (kpiSortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700" onClick={() => handleSort('remain')}>
                        Remain {kpiSortBy === 'remain' && (kpiSortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700" onClick={() => handleSort('result')}>
                        Result {kpiSortBy === 'result' && (kpiSortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700" onClick={() => handleSort('ratio')}>
                        Ratio {kpiSortBy === 'ratio' && (kpiSortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none" onClick={() => handleSort('total')}>
                        In System {kpiSortBy === 'total' && (kpiSortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Status</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {calculateKPIData.data.map((item) => (
                      <tr key={item.unit} className={`hover:bg-gray-50 transition-colors ${item.hasChange ? 'bg-amber-50' : ''}`}>
                        <td className="px-4 py-3 text-sm font-medium">
                          {item.unit}
                          {item.hasChange && <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs bg-amber-200 text-amber-800">📊 Changed</span>}
                          {item.isNew && <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs bg-emerald-200 text-emerald-800">🆕 New</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-right">
                          {editingTarget === `${item.unit}-morning` ? (
                            <input type="number" defaultValue={item.morningTarget} autoFocus onBlur={(e) => { updateTarget(item.unit, 'morning', e.target.value); setEditingTarget(null); }} className="w-20 px-2 py-1 text-right border rounded-xl bg-white" />
                          ) : (
                            <span className="cursor-pointer hover:bg-gray-100 px-2 py-1 rounded" onClick={() => setEditingTarget(`${item.unit}-morning`)}>{item.morningTarget || '-'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right">
                          {editingTarget === `${item.unit}-evening` ? (
                            <input type="number" defaultValue={item.eveningTarget} autoFocus onBlur={(e) => { updateTarget(item.unit, 'evening', e.target.value); setEditingTarget(null); }} className="w-20 px-2 py-1 text-right border rounded-xl bg-white" />
                          ) : (
                            <span className={`cursor-pointer hover:bg-gray-100 px-2 py-1 rounded ${item.hasChange ? 'font-bold text-purple-600' : ''}`} onClick={() => setEditingTarget(`${item.unit}-evening`)}>{item.eveningTarget || '-'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right"><span className={`font-medium ${item.remain > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{item.remain}</span></td>
                        <td className="px-4 py-3 text-sm text-right text-emerald-600 font-medium">{item.result}</td>
                        <td className="px-4 py-3 text-sm text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-medium">{item.ratio.toFixed(1)}%</span>
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                              <div className={`h-2 rounded-full ${item.ratio >= 80 ? 'bg-emerald-500' : item.ratio >= 50 ? 'bg-amber-500' : item.ratio > 0 ? 'bg-rose-500' : 'bg-gray-400'}`} style={{ width: `${item.ratio}%` }}></div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500">{item.total}</td>
                        <td className="px-4 py-3 text-center">{getStatusBadgeKPI(item.status)}</td>
                        <td className="px-4 py-3 text-center">
                          {item.hasData && (
                            <button onClick={() => { setSearchTerm(item.unit); setShowKPIModal(false); }} className="text-blue-500 hover:text-blue-700 text-xs transition-colors">View</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-bold">
                    <tr>
                      <td className="px-4 py-3 text-sm">TOTAL</td>
                      <td className="px-4 py-3 text-sm text-right">{calculateKPIData.summary.targetMorning}</td>
                      <td className="px-4 py-3 text-sm text-right">{calculateKPIData.summary.targetEvening}</td>
                      <td className="px-4 py-3 text-sm text-right text-amber-600">{calculateKPIData.summary.remain}</td>
                      <td className="px-4 py-3 text-sm text-right text-emerald-600">{calculateKPIData.summary.result}</td>
                      <td className="px-4 py-3 text-sm text-right">{calculateKPIData.summary.ratio.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-sm text-right">{calculateKPIData.summary.totalRecords}</td>
                      <td className="px-4 py-3 text-center">-</td>
                      <td className="px-4 py-3 text-center">-</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {null}
          </div>
          <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
            <button onClick={() => setShowKPIModal(false)} className="px-4 py-2 bg-gray-200 rounded-xl hover:bg-gray-300 transition-colors">Close</button>
            <button onClick={exportKPItoExcel} className="px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors">📎 Export KPI</button>
            <button onClick={exportToExcel} className="px-4 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors">📎 Export Data</button>
          </div>
        </div>
      </div>
    );
  };

  const renderPasteModal = () => {
    if (!showPasteModal) return null;
    return (
      <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
        <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full mx-4">
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-4 rounded-t-2xl">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-white">🔄 Smart Import</h2>
                <p className="text-blue-100 text-sm">Auto-filters GIS Warehouse + Actual Export all + Unsigned/Is signing</p>
              </div>
              <button onClick={() => setShowPasteModal(false)} className="text-white/80 hover:text-white text-2xl">✕</button>
            </div>
          </div>
          <div className="p-6">
            <textarea 
              value={pasteData} 
              onChange={(e) => setPasteData(e.target.value)} 
              placeholder="Paste your system data here...&#10;&#10;Format: Export Note Code, Export Command Code, Export Request, Create Requester, Date Create, Date Export, Export Warehouse, Reason export, Name Warehouse Entering, Unit Entering, Code Contruction, Status, Disapprove not, Status CA, Description&#10;&#10;Note: Only GIS Warehouse + Actual Export all + Unsigned/Is signing will be imported." 
              className="w-full h-64 px-4 py-3 border rounded-xl font-mono text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
            {null}
            {data.length > 0 && (
              <div className="mt-3 p-2 bg-amber-50 rounded-xl text-sm text-amber-800">
                ⚠️ Current data has {data.length} record(s). Import will replace existing data.
              </div>
            )}
          </div>
          <div className="p-4 border-t bg-gray-50 rounded-b-2xl flex justify-end gap-3">
            <button onClick={() => { setShowPasteModal(false); setPasteData(''); }} className="px-4 py-2 bg-gray-200 rounded-xl hover:bg-gray-300 transition-colors">Cancel</button>
            <button onClick={handleSmartImport} disabled={!pasteData.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">🔄 Smart Import</button>
          </div>
        </div>
      </div>
    );
  };

  const renderAlarmModal = () => {
    if (!showAlarmModal) return null;
    return (
      <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
        <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 overflow-hidden flex flex-col max-h-[85vh]">
          <div className="bg-gradient-to-r from-rose-600 to-rose-700 px-6 py-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="animate-bounce text-2xl">🚨</span>
                <div>
                  <h2 className="text-xl font-bold text-white">ALARM DETECTED!</h2>
                  <p className="text-rose-100 text-xs">{alarmItems.length} record(s) exceed {alarmThreshold}-day threshold</p>
                </div>
              </div>
              <button onClick={() => { setShowAlarmModal(false); setAlarmSearchTerm(''); setSelectedAlarmUnit(''); }} className="text-white/80 hover:text-white text-2xl">✕</button>
            </div>
          </div>
          
          <div className="px-6 py-3 bg-gray-50 border-b flex gap-2 justify-between items-center">
            <select
              value={selectedAlarmUnit}
              onChange={(e) => setSelectedAlarmUnit(e.target.value)}
              className="px-3 py-1.5 border rounded-xl text-xs bg-white w-40"
            >
              <option value="">All Units</option>
              {alarmUnits.map(unit => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
            <input 
              type="text" 
              placeholder="Search alarm list..." 
              value={alarmSearchTerm} 
              onChange={(e) => setAlarmSearchTerm(e.target.value)} 
              className="flex-1 px-3 py-1.5 border rounded-xl text-xs bg-white"
            />
            <button onClick={copyAlarmsToClipboard} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-sm transition-colors">
              📋 Copy ({filteredAlarmItems.length})
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            {filteredAlarmItems.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <div className="text-3xl mb-2">🔍</div>
                <p>No alarm items match your search.</p>
              </div>
            ) : (
              filteredAlarmItems.map(item => (
                <div key={item.id} className="mb-3 p-3 bg-rose-50 rounded-xl border border-rose-200">
                  <div className="flex justify-between items-start gap-4">
                    <div className="text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-rose-700 text-sm">{item.unit}</span>
                        <span className="text-gray-500 font-mono">| Export: {item.exportNoteCode}</span>
                      </div>
                      <div className="text-gray-600 mt-1">📅 Date: {item.dateCreate} | Year: {item.year} | ⏰ Delay: <span className="font-semibold text-rose-600 font-mono">+{item.daysDiff} days</span></div>
                      <div className="text-[11px] text-gray-500 mt-1">Warehouse: {item.exportWarehouse} | Status CA: {item.statusCA}</div>
                    </div>
                    <button onClick={() => setDismissedItems(prev => new Set([...prev, item.id]))} className="px-2.5 py-1 text-xs bg-white border border-rose-300 rounded-xl hover:bg-rose-50 text-rose-700 transition-colors">Dismiss</button>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
            <button onClick={() => { setShowAlarmModal(false); setAlarmSearchTerm(''); setSelectedAlarmUnit(''); }} className="px-4 py-2 bg-gray-200 rounded-xl hover:bg-gray-300 transition-colors text-xs">Close</button>
            <button onClick={() => { setDismissedItems(prev => new Set([...prev, ...alarmItems.map(i => i.id)])); setShowAlarmModal(false); setAlarmSearchTerm(''); setSelectedAlarmUnit(''); }} className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs transition-colors shadow-md">Dismiss All</button>
          </div>
        </div>
      </div>
    );
  };

  const renderFloatingButtons = () => (
    <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-40">
      {alarmCount > 0 && !showAlarmModal && (
        <button onClick={() => setShowAlarmModal(true)} className="bg-rose-600 text-white px-5 py-3 rounded-full shadow-lg animate-bounce flex items-center gap-2 hover:bg-rose-700 transition-colors">
          <span className="text-xl">🚨</span>
          <span className="font-bold">{alarmCount}</span>
        </button>
      )}
      <button onClick={() => setShowKPIModal(true)} className="bg-purple-600 text-white px-5 py-3 rounded-full shadow-lg hover:bg-purple-700 transition-colors flex items-center gap-2">
        <span className="text-xl">📊</span>
        <span className="font-bold">KPI</span>
      </button>
    </div>
  );

  return (
    <div className="w-full px-4 py-6 bg-gray-50 min-h-screen">
      
      {/* ─── MODALS ─── */}
      {renderTargetHistoryModal()}
      {renderKPIModal()}
      {renderPasteModal()}
      {renderAlarmModal()}
      {renderFloatingButtons()}

      {/* ─── MAIN CONTENT ─── */}
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
        
        {/* ─── HEADER ─── */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-5">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                  <span>📤</span> EXPORT CA
                </h1>
                <span className="bg-white/20 text-white text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider border border-white/30">
                  🟢 Live • {currentTime.toLocaleTimeString()}
                </span>
              </div>
              <p className="text-blue-100 mt-1 text-sm">**របាយការណ៍បញ្ជីបង្កាន់ដៃ Stock Out ប្រចាំខែ ដែលមិនទាន់បានចុះហត្ថលេខា "CA" ក្នុងប្រព័ន្ធ។**</p>
            </div>
            <div className="flex gap-2">
              {!isUnitUser && (
                <button onClick={clearAllData} className="bg-rose-500 hover:bg-rose-600 text-white px-3 py-2 rounded-xl text-sm transition-colors">🗑️ Clear All</button>
              )}
              <button onClick={() => setShowKPIModal(true)} className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-xl transition-colors">📊 KPI</button>
            </div>
          </div>
        </div>

        {/* ─── TOOLBAR ─── */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex flex-wrap gap-3 justify-between items-center">
            <div className="flex flex-wrap gap-2">
              {!isUnitUser && (
                <button onClick={() => setShowPasteModal(true)} className="px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors text-sm flex items-center gap-1">🔄 Smart Import</button>
              )}
              <button onClick={exportToExcel} className="px-4 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors text-sm flex items-center gap-1">📎 Export</button>
              {selectedRows.size > 0 && (
                <button onClick={deleteSelectedRows} className="px-4 py-2 bg-rose-600 text-white rounded-xl hover:bg-rose-700 transition-colors text-sm flex items-center gap-1">🗑️ Complete ({selectedRows.size})</button>
              )}
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <div className="flex items-center gap-1 bg-amber-100 px-3 py-1.5 rounded-full">
                <span className="text-sm">⚠️ &ge;</span>
                <input type="number" value={alarmThreshold} onChange={(e) => setAlarmThreshold(parseInt(e.target.value) || 4)} className="w-16 px-2 py-1 text-sm border rounded-lg text-center bg-white" min="1"/>
                <span className="text-sm">days</span>
              </div>
              <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-48 sm:w-64 px-4 py-2 pl-10 text-sm border rounded-xl bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" />
            </div>
          </div>
        </div>

        {/* ─── STATS BAR ─── */}
        <div className="px-6 py-4 bg-gray-100 border-b border-gray-200 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-white rounded-xl px-3 py-2 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Total Records</div>
            <div className="text-2xl font-black text-blue-600 mt-1">{activeRecords.length}</div>
          </div>
          <div className="bg-white rounded-xl px-3 py-2 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">GIS Records</div>
            <div className="text-2xl font-black text-emerald-600 mt-1">{filteredData.length}</div>
          </div>
          <div className="bg-white rounded-xl px-3 py-2 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Selected</div>
            <div className="text-2xl font-black text-indigo-600 mt-1">{selectedRows.size}</div>
          </div>
          <div className="bg-white rounded-xl px-3 py-2 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Threshold</div>
            <div className="text-2xl font-black text-amber-600 mt-1">&ge;{alarmThreshold}d</div>
          </div>
          <div className={`bg-white rounded-xl px-3 py-2 shadow-sm cursor-pointer hover:bg-rose-50 transition-colors ${alarmCount > 0 ? 'border-2 border-rose-500' : ''}`} onClick={() => { if (alarmCount > 0) setShowAlarmModal(true); }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Alarms</div>
            <div className={`text-2xl font-black ${alarmCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{alarmCount}</div>
          </div>
          <div className="bg-white rounded-xl px-3 py-2 shadow-sm cursor-pointer hover:bg-purple-50 transition-colors" onClick={() => setShowKPIModal(true)}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Total Confirmed</div>
            <div className="text-2xl font-black text-purple-600 mt-1">{calculateKPIData.summary.result}</div>
          </div>
        </div>

        {/* ─── TABLE WITH STICKY HEADER ─── */}
        <div className="relative overflow-x-auto overflow-y-auto max-h-[calc(100vh-420px)] border-b border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 table-auto text-xs">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 w-8 bg-gray-50 sticky top-0 z-10 border-b border-gray-200 shadow-[inset_0_-1px_0_rgba(229,231,235,1)]">
                  <input type="checkbox" checked={selectedRows.size === filteredData.length && filteredData.length > 0} onChange={toggleSelectAll} className="rounded" />
                </th>
                {columns.map(col => (
                  <th key={col.key} className={`px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase ${col.width} whitespace-nowrap bg-gray-50 sticky top-0 z-10 border-b border-gray-200 shadow-[inset_0_-1px_0_rgba(229,231,235,1)]`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedData.map((item) => {
                const isAlarm = (item.daysDiff >= alarmThreshold || (item.statusCA && (item.statusCA.toUpperCase().includes('UNSIGNED') || item.statusCA.toUpperCase().includes('CHƯA') || item.statusCA.toUpperCase().includes('CHUA')))) && !dismissedItems.has(item.id);
                return (
                  <tr key={item.id} className={`${isAlarm ? 'bg-rose-50' : ''} ${selectedRows.has(item.id) ? 'bg-blue-50' : ''} hover:bg-gray-50 transition-colors`}>
                    <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={selectedRows.has(item.id)} onChange={() => toggleRowSelection(item.id)} className="rounded" /></td>
                    <td className="px-2 py-1.5 text-xs text-gray-500 text-center">{item.no}</td>
                    <td className="px-2 py-1.5 text-xs font-mono break-all">
                      {editingCell?.id === item.id && editingCell?.field === 'exportNoteCode' ? (
                        <input type="text" defaultValue={item.exportNoteCode} autoFocus onBlur={(e) => saveEdit(item.id, 'exportNoteCode', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'exportNoteCode')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'exportNoteCode', item.exportNoteCode)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{item.exportNoteCode || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs font-mono break-all">
                      {editingCell?.id === item.id && editingCell?.field === 'exportCommandCode' ? (
                        <input type="text" defaultValue={item.exportCommandCode} autoFocus onBlur={(e) => saveEdit(item.id, 'exportCommandCode', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'exportCommandCode')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'exportCommandCode', item.exportCommandCode)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{item.exportCommandCode || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs break-words">
                      {editingCell?.id === item.id && editingCell?.field === 'exportRequest' ? (
                        <input type="text" defaultValue={item.exportRequest} autoFocus onBlur={(e) => saveEdit(item.id, 'exportRequest', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'exportRequest')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'exportRequest', item.exportRequest)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{item.exportRequest || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs break-words">
                      {editingCell?.id === item.id && editingCell?.field === 'createRequester' ? (
                        <input type="text" defaultValue={item.createRequester} autoFocus onBlur={(e) => saveEdit(item.id, 'createRequester', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'createRequester')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'createRequester', item.createRequester)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{item.createRequester || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs font-mono text-center">
                      {editingCell?.id === item.id && editingCell?.field === 'dateCreate' ? (
                        <input type="text" defaultValue={item.dateCreate} autoFocus onBlur={(e) => saveEdit(item.id, 'dateCreate', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'dateCreate')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs font-mono bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'dateCreate', item.dateCreate)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded font-mono">{item.dateCreate || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs font-mono text-center">
                      {editingCell?.id === item.id && editingCell?.field === 'dateExport' ? (
                        <input type="text" defaultValue={item.dateExport} autoFocus onBlur={(e) => saveEdit(item.id, 'dateExport', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'dateExport')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs font-mono bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'dateExport', item.dateExport)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded font-mono">{item.dateExport || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs break-words">
                      {editingCell?.id === item.id && editingCell?.field === 'exportWarehouse' ? (
                        <input type="text" defaultValue={item.exportWarehouse} autoFocus onBlur={(e) => saveEdit(item.id, 'exportWarehouse', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'exportWarehouse')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'exportWarehouse', item.exportWarehouse)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{getWarehouseBadge(item.exportWarehouse)}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs break-words">
                      {editingCell?.id === item.id && editingCell?.field === 'reasonExport' ? (
                        <input type="text" defaultValue={item.reasonExport} autoFocus onBlur={(e) => saveEdit(item.id, 'reasonExport', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'reasonExport')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'reasonExport', item.reasonExport)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{item.reasonExport || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs break-words">
                      {editingCell?.id === item.id && editingCell?.field === 'nameWarehouseEntering' ? (
                        <input type="text" defaultValue={item.nameWarehouseEntering} autoFocus onBlur={(e) => saveEdit(item.id, 'nameWarehouseEntering', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'nameWarehouseEntering')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'nameWarehouseEntering', item.nameWarehouseEntering)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{item.nameWarehouseEntering || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs break-words">
                      {editingCell?.id === item.id && editingCell?.field === 'unitEntering' ? (
                        <input type="text" defaultValue={item.unitEntering} autoFocus onBlur={(e) => saveEdit(item.id, 'unitEntering', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'unitEntering')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'unitEntering', item.unitEntering)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{item.unitEntering || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs break-words">
                      {editingCell?.id === item.id && editingCell?.field === 'codeConstruction' ? (
                        <input type="text" defaultValue={item.codeConstruction} autoFocus onBlur={(e) => saveEdit(item.id, 'codeConstruction', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'codeConstruction')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'codeConstruction', item.codeConstruction)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{item.codeConstruction || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {editingCell?.id === item.id && editingCell?.field === 'status' ? (
                        <input type="text" defaultValue={item.status} autoFocus onBlur={(e) => saveEdit(item.id, 'status', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'status')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'status', item.status)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{getStatusBadge(item.status)}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {editingCell?.id === item.id && editingCell?.field === 'disapproveNot' ? (
                        <input type="text" defaultValue={item.disapproveNot} autoFocus onBlur={(e) => saveEdit(item.id, 'disapproveNot', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'disapproveNot')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'disapproveNot', item.disapproveNot)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{getDisapproveNotBadge(item.disapproveNot)}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {editingCell?.id === item.id && editingCell?.field === 'statusCA' ? (
                        <select defaultValue={item.statusCA} autoFocus onBlur={(e) => saveEdit(item.id, 'statusCA', e.target.value)} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white">
                          <option value="Unsigned">📝 Unsigned</option>
                          <option value="Is signing">✍️ Is signing</option>
                        </select>
                      ) : (
                        <div onClick={() => startEdit(item.id, 'statusCA', item.statusCA)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{getStatusCABadge(item.statusCA)}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs break-words max-w-xs">
                      {editingCell?.id === item.id && editingCell?.field === 'description' ? (
                        <input type="text" defaultValue={item.description} autoFocus onBlur={(e) => saveEdit(item.id, 'description', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'description')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'description', item.description)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded truncate">{item.description || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center"><span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">{item.unit}</span></td>
                    <td className="px-2 py-1.5 text-center"><span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${getDaysColor(item.daysDiff)}`}>{item.daysDiff > 0 ? `+${item.daysDiff}` : item.daysDiff} {Math.abs(item.daysDiff) === 1 ? 'day' : 'days'}</span></td>
                    <td className="px-2 py-1.5 text-center"><span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-100 font-mono">{item.team || getTeamFromWarehouse(item.nameWarehouseEntering || item.exportWarehouse)}</span></td>
                    <td className="px-2 py-1.5 text-center font-mono font-bold text-blue-600">{item.year || '-'}</td>
                  </tr>
                );
              })}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center gap-3">
                      <div className="text-4xl">📭</div>
                      <p className="text-lg font-medium">No records found matching filters</p>
                      <p className="text-sm text-gray-400">Filters: GIS Warehouse + Actual Export all + Unsigned/Is signing</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ─── PAGINATION ─── */}
        <div className="bg-white px-6 py-4 border-t flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-700 relative">
          <div className="flex items-center gap-2 sm:absolute sm:left-6">
            <span>Show</span>
            <select 
              value={pageSize} 
              onChange={(e) => { setPageSize(parseInt(e.target.value)); setCurrentPage(1); }} 
              className="border rounded-xl px-2 py-1 bg-white"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>entries</span>
            <span className="text-gray-400">|</span>
            <span>Showing {totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0} to {Math.min(currentPage * pageSize, totalItems)} of {totalItems} entries</span>
          </div>
          
          <div className="flex items-center gap-1 sm:mx-auto">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} 
              disabled={currentPage === 1}
              className={`px-3 py-1 rounded-xl border ${currentPage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-blue-600 hover:bg-gray-50'}`}
            >
              Previous
            </button>
            
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum = currentPage;
              if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              if (pageNum < 1 || pageNum > totalPages) return null;
              return (
                <button 
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`px-3 py-1 rounded-xl border font-medium ${currentPage === pageNum ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {pageNum}
                </button>
              );
            })}

            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} 
              disabled={currentPage === totalPages}
              className={`px-3 py-1 rounded-xl border ${currentPage === totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-blue-600 hover:bg-gray-50'}`}
            >
              Next
            </button>
          </div>
        </div>

        {/* ─── FOOTER ─── */}
        <div className="bg-gray-50 px-6 py-3 border-t text-sm text-gray-500 flex justify-between flex-wrap gap-2">
          <span>📋 In System: <strong>{activeRecords.length}</strong> rows | Total GIS (Actual Export all + Unsigned/Is signing): <strong>{filteredData.length}</strong> rows | Alarms: <strong>{alarmCount}</strong></span>
          {/* <div className="flex gap-3 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-500"></span>GIS Warehouse</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse"></span>Alarm (&ge;{alarmThreshold}d)</span>
            <span className="flex items-center gap-1 text-gray-400">|</span>
            <span className="flex items-center gap-1"><span className="text-amber-600">✍️</span> Is signing</span>
            <span className="flex items-center gap-1"><span className="text-gray-600">📝</span> Unsigned</span>
            <span className="flex items-center gap-1"><span className="text-emerald-600">✅</span> Actual Export all</span>
          </div> */}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        .animate-slideIn { animation: slideIn 0.3s ease-out; }
        .animate-bounce { animation: bounce 1s infinite; }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .animate-pulse { animation: pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
};

export default Export_CA;