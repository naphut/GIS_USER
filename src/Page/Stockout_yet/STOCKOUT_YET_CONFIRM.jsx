import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { loadFromDb, saveToDb, clearStore } from '../../services/dbStore';

// Complete list of all possible Units
const allUnits = [
  'BAN', 'BAT', 'CHA', 'CHH', 'KAM', 'KAN', 'KANZ1', 'KOH', 'KRA',
  'MON', 'ODD', 'PNP', 'PNPZ1', 'PNPZ2', 'PRE', 'PRH', 'PUR', 'ROT',
  'SIE', 'SIH', 'SPE', 'STU', 'SVA', 'TAK', 'THO'
];

// Storage Keys
const STORAGE_KEYS = {
  DATA: 'kpi_stockout_data',
  COMPLETION: 'kpi_stockout_completionHistory',
  TARGETS: 'kpi_stockout_targets',
  TARGET_HISTORY: 'kpi_stockout_targetHistory',
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

// Helper function to extract Unit from Group Receiver
// Uses 2-step approach: province from GIS_XXX_ prefix + FBC/SOS number anywhere in string
// This correctly handles complex names like GIS_KAN_STOCK_NOC_FBCTEAM01 → KANZ1
const getUnitFromGroupReceiver = (groupReceiver) => {
  if (!groupReceiver) return null;
  
  let upper = groupReceiver.toUpperCase().replace(/\s+/g, '');
  upper = upper.replace(/FB_TEAMC/g, 'FBC').replace(/FB_TEAM/g, 'FBC').replace(/FBC012/g, 'FBC12');
  
  // Direct unit label overrides (explicit _PNPZ1_, ^KANZ1, etc.)
  if (/_PNPZ1_/.test(upper) || /^PNPZ1\b/.test(upper)) return 'PNPZ1';
  if (/_PNPZ2_/.test(upper) || /^PNPZ2\b/.test(upper)) return 'PNPZ2';
  if (/_KANZ1_/.test(upper) || /^KANZ1\b/.test(upper)) return 'KANZ1';

  // Step 1: Extract province from GIS_XXX_ prefix
  const gisMatch = upper.match(/^GIS_([A-Z]+)_/);
  const province = gisMatch ? gisMatch[1] : null;

  // Step 2: Find FBC or SOS number ANYWHERE in the string
  const fbcMatch = upper.match(/FBC[^\d]*(\d+)/);
  const sosMatch = upper.match(/SOS[^\d]*(\d+)/);

  if (fbcMatch && province) {
    const num = String(parseInt(fbcMatch[1])).padStart(2, '0');
    if (province === 'PNP') {
      const PNPZ1 = ['01','03','05','06','07','10','11','13','14'];
      const PNPZ2 = ['02','04','08','09','12'];
      if (PNPZ1.includes(num)) return 'PNPZ1';
      if (PNPZ2.includes(num)) return 'PNPZ2';
      return 'PNP';
    }
    if (province === 'KAN') {
      const KANZ1 = ['01','02','03','04','05','06','07'];
      if (KANZ1.includes(num)) return 'KANZ1';
      return 'KAN';
    }
    // Other provinces: use province directly if it's a known unit
    if (allUnits.includes(province)) return province;
  }

  if (sosMatch && province) {
    // SOS always maps to base province (PNP SOS → PNP, KAN SOS → KAN)
    if (allUnits.includes(province)) return province;
  }

  // Planning department
  if (upper.includes('PLANNING') || upper.includes('_PLA')) {
    if (province && allUnits.includes(province)) return province;
  }

  // Fallback: if we have a known province from GIS prefix, return it
  if (province && allUnits.includes(province)) return province;

  // Last resort: check if it starts with any unit code
  const sortedUnits = [...allUnits].sort((a, b) => b.length - a.length);
  for (const unit of sortedUnits) {
    if (upper.includes(`GIS_${unit}_`) || upper.startsWith(unit + '_') || upper === unit) {
      return unit;
    }
  }
  
  return null;
};

// Updated getUnit function with groupReceiver priority
const getUnit = (exportCode, exportNo, groupReceiver, stockReceiver) => {
  // 1. Try groupReceiver first (most specific)
  const unitFromGroup = getUnitFromGroupReceiver(groupReceiver);
  if (unitFromGroup && allUnits.includes(unitFromGroup)) {
    return unitFromGroup;
  }
  
  // 2. Try stockReceiver (e.g. GIS_KAN_STOCK_NOC_FBCTEAM01 → KANZ1)
  if (stockReceiver && stockReceiver !== '-') {
    const unitFromStock = getUnitFromGroupReceiver(stockReceiver);
    if (unitFromStock && allUnits.includes(unitFromStock)) {
      return unitFromStock;
    }
  }
  
  // 3. Fallback: try to get from exportCode or exportNo
  const code = (exportCode || exportNo || '').toUpperCase();
  if (!code) return 'OTHER';
  
  // Check specific zones (longer strings) first so PNPZ1 is not matched as PNP
  const unitMap = {
    'PNPZ1': 'PNPZ1', 'PNPZ2': 'PNPZ2', 'KANZ1': 'KANZ1',
    'BAN': 'BAN', 'BAT': 'BAT', 'CHA': 'CHA', 'CHH': 'CHH',
    'KAM': 'KAM', 'KAN': 'KAN', 'KOH': 'KOH', 'KRA': 'KRA',
    'MON': 'MON', 'ODD': 'ODD', 'PNP': 'PNP', 'PRE': 'PRE',
    'PRH': 'PRH', 'PUR': 'PUR', 'ROT': 'ROT', 'SIE': 'SIE',
    'SIH': 'SIH', 'SPE': 'SPE', 'STU': 'STU', 'SVA': 'SVA',
    'TAK': 'TAK', 'THO': 'THO'
  };
  
  for (const [key, value] of Object.entries(unitMap)) {
    if (code.includes(key)) return value;
  }
  return 'OTHER';
};

const getTeam = (stockReceiver, groupReceiver) => {
  const group = (groupReceiver || '').trim();
  const rawTeam = (group && group !== '-') ? group : (stockReceiver || '').trim();
  if (!rawTeam || rawTeam === '-') return '-';
  
  let upper = rawTeam.toUpperCase();
  upper = upper.replace(/FB_TEAMC/g, 'FBC').replace(/FB_TEAM/g, 'FBC').replace(/FBC012/g, 'FBC12');
  
  // Find FBC or SOS team number
  let teamNum = '';
  let teamType = '';
  
  const fbcMatch = upper.match(/FBC[^\d]*(\d+)/);
  if (fbcMatch) {
    teamType = 'FBC';
    teamNum = String(parseInt(fbcMatch[1])).padStart(2, '0');
  } else {
    const sosMatch = upper.match(/SOS[^\d]*(\d+)/);
    if (sosMatch) {
      teamType = 'SOS';
      teamNum = String(parseInt(sosMatch[1])).padStart(2, '0');
    }
  }
  
  if (teamType && teamNum) {
    // Use GIS_XXX_ prefix to get province — avoids false matches
    // e.g. GIS_KAN_STOCK_ROTATIONAL_... → KAN (not ROT from "ROTATIONAL")
    let province = '';
    const gisProvince = upper.match(/^GIS_([A-Z]+)_/);
    if (gisProvince) {
      province = gisProvince[1];
    } else {
      // Fallback: search unit codes but only as whole words (bounded by _ or start)
      const units = [
        'BAN','BAT','CHA','CHH','KAM','KOH','KRA','MON','ODD',
        'PNP','PRE','PRH','PUR','ROT','SIE','SIH','SPE','STU',
        'SVA','TAK','THO','KAN'
      ].sort((a, b) => b.length - a.length);
      for (const u of units) {
        // Match unit code only when bounded by _ or at string start/end
        if (new RegExp(`(^|_)${u}($|_)`).test(upper)) {
          province = u;
          break;
        }
      }
    }
    
    if (province) {
      return `GIS_${province}_${teamType}${teamNum}`;
    }
  }
  
  upper = upper.replace(/_TEAM(\d+)/i, '$1');
  upper = upper.replace(/TEAM(\d+)/i, '$1');
  return upper;
};

const STOCKOUT_YET_CONFIRM = ({ user }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const isLoaded = useRef(false);
  
  const isUnitUser = user && user.role === 'unit' && user.unit;
  const userUnit = user?.unit;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const [data, setData] = useState(() => getStorageData(STORAGE_KEYS.DATA) || []);
  const [completionHistory, setCompletionHistory] = useState(() => getStorageData(STORAGE_KEYS.COMPLETION) || []);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterGIS, setFilterGIS] = useState(true);
  const [showAlarmModal, setShowAlarmModal] = useState(false);
  const [alarmThreshold, setAlarmThreshold] = useState(4);
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
  const [showComparisonAlert, setShowComparisonAlert] = useState(false);
  const [comparisonChanges, setComparisonChanges] = useState([]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Load data from DB on mount
  useEffect(() => {
    const fetchDbData = async () => {
      const dbData = await loadFromDb(STORAGE_KEYS.DATA, []);
      
      // Enrich/update data with correct unit and full team name
      // This auto-corrects any previously stored wrong unit values (e.g. KAN → KANZ1)
      const enrichedData = dbData.map(item => ({
        ...item,
        unit: getUnit(item.exportCode, item.exportNo, item.groupReceiver, item.stockReceiver),
        team: getTeam(item.stockReceiver, item.groupReceiver)
      }));
      setData(enrichedData);
      
      const dbCompletion = await loadFromDb(STORAGE_KEYS.COMPLETION, []);
      setCompletionHistory(dbCompletion);

      const dbTargets = await loadFromDb(STORAGE_KEYS.TARGETS, {});
      setTargets(dbTargets);

      const dbTargetHistory = await loadFromDb(STORAGE_KEYS.TARGET_HISTORY, []);
      setTargetHistory(dbTargetHistory);
      
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

  // Columns
  const columns = [
    { key: 'no', label: '#', width: 'w-12', align: 'text-center' },
    { key: 'exportCode', label: 'Warehouse Stock out', width: 'w-32', align: 'text-left' },
    { key: 'exportNo', label: 'Export No', width: 'w-32', align: 'text-left' },
    { key: 'realExport', label: 'Date', width: 'w-24', align: 'text-center' },
    { key: 'stockReceiver', label: 'Stock Receiver', width: 'w-24', align: 'text-left' },
    { key: 'groupReceiver', label: 'Group Receiver', width: 'w-40', align: 'text-left' },
    { key: 'constructionReceiver', label: 'Construction', width: 'w-44', align: 'text-left' },
    { key: 'unit', label: 'Unit', width: 'w-16', align: 'text-center' },
    { key: 'daysDiff', label: 'Days', width: 'w-16', align: 'text-center' },
    { key: 'team', label: 'TEAM', width: 'min-w-[150px]', align: 'text-center' }
  ];

  // Helper functions
  const calculateDaysDiff = (dateString) => {
    if (!dateString) return 0;
    const parts = dateString.split(/[/\s:-]+/);
    if (parts.length < 3) return 0;
    let day, month, year;
    if (parts[0].length === 4) {
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      day = parseInt(parts[2], 10);
    } else {
      day = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
    }
    const exportDate = new Date(year, month, day);
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const diffTime = currentDate - exportDate;
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
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

  // 🚫 FILTER FUNCTION: Check if item should be excluded
  const shouldExcludeItem = (item) => {
    // Exclude if constructionReceiver contains "GPON" (case insensitive) ONLY for units: SPE, TAK, KAM, CHH
    if (item.constructionReceiver && 
        item.constructionReceiver.toUpperCase().includes('GPON')) {
      const unit = item.unit || getUnit(item.exportCode, item.exportNo, item.groupReceiver, item.stockReceiver);
      const excludedGponUnits = ['SPE', 'TAK', 'KAM', 'CHH'];
      if (excludedGponUnits.includes(unit)) {
        return true;
      }
    }
    // Exclude if groupReceiver contains "GIS_MOD"
    if (item.groupReceiver && 
        item.groupReceiver.toUpperCase().includes('GIS_MOD')) {
      return true;
    }
    // Exclude if not a GIS item (neither stockReceiver has GIS nor groupReceiver has GIS/unit)
    const isStockReceiverGIS = item.stockReceiver && item.stockReceiver.includes('GIS');
    const isGroupReceiverGIS = item.groupReceiver && (item.groupReceiver.includes('GIS') || getUnitFromGroupReceiver(item.groupReceiver) !== null);
    if (!isStockReceiverGIS && !isGroupReceiverGIS) {
      return true;
    }
    return false;
  };

  // 🚫 Active valid GIS records (excluding excluded rows and matching unit role)
  const activeRecords = useMemo(() => {
    let filtered = data;
    filtered = filtered.filter(item => !shouldExcludeItem(item));
    if (isUnitUser) {
      filtered = filtered.filter(item => {
        const u = item.unit || getUnitFromGroupReceiver(item.groupReceiver) || getUnitFromGroupReceiver(item.stockReceiver) || getUnitFromGroupReceiver(item.warehouseEntering);
        return u === userUnit;
      });
    }
    return filtered;
  }, [data, isUnitUser, userUnit]);

  // Auto create target based on time of day
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
    
    const historyEntry = {
      id: Date.now(),
      unit: unit,
      period: period,
      oldTarget: null,
      newTarget: newTarget,
      changedAt: new Date().toISOString(),
      changedBy: `System (Auto - ${isMorning ? 'ព្រឹក' : 'ល្ងាច'})`,
      reason: `Auto-created target based on ${dataCount} record(s)`
    };
    setTargetHistory(prev => [historyEntry, ...prev]);
    
    return newTarget;
  };

  // Check for target changes between morning and evening
  const checkTargetChanges = () => {
    const changes = [];
    Object.keys(targets).forEach(unit => {
      const morning = targets[unit]?.morning || 0;
      const evening = targets[unit]?.evening || 0;
      if (morning !== evening && evening > 0) {
        const diff = evening - morning;
        changes.push({
          unit,
          morning,
          evening,
          diff,
          type: diff > 0 ? 'increase' : 'decrease',
          percentage: morning > 0 ? ((diff / morning) * 100).toFixed(1) : '100'
        });
      }
    });
    
    if (changes.length > 0) {
      setComparisonChanges(changes);
      setShowComparisonAlert(true);
      playAlarmSound();
      showNotification(`📊 Target changes detected for ${changes.length} Unit(s)!`, 'info');
    }
  };

  // Update target manually
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
    
    const historyEntry = {
      id: Date.now(),
      unit: unit,
      period: period,
      oldTarget: oldTarget,
      newTarget: newTarget,
      changedAt: new Date().toISOString(),
      changedBy: 'User',
      reason: `Manual target adjustment for ${period === 'morning' ? 'ព្រឹក' : 'ល្ងាច'}`
    };
    setTargetHistory(prev => [historyEntry, ...prev]);
    
    showNotification(`📊 Target (${period === 'morning' ? 'ព្រឹក' : 'ល្ងាច'}) for ${unit}: ${oldTarget} → ${newTarget}`, 'info');
  };

  // Process import with auto-target creation and FILTERS
  const processImport = (newRawData) => {
    // 🚫 Step 1: Filter out excluded items BEFORE processing
    const filteredRawData = newRawData.filter(item => !shouldExcludeItem(item));
    
    if (filteredRawData.length === 0) {
      showNotification('⚠️ All data was filtered out (GPON or GIS_MOD excluded)!', 'warning');
      return;
    }

    const currentExportNos = new Set(data.map(item => item.exportNo));
    const newExportNosSet = new Set(filteredRawData.map(item => item.exportNo));
    
    const processedNewData = filteredRawData.map((item, index) => {
      const stockRec = item.stockReceiver || '';
      const groupRec = item.groupReceiver || '';
      return {
        id: Math.max(...data.map(d => d.id), 0, index) + index + 1,
        no: index + 1,
        exportCode: item.exportCode,
        exportNo: item.exportNo,
        realExport: item.realExport,
        stockReceiver: stockRec,
        groupReceiver: groupRec,
        constructionReceiver: item.constructionReceiver || '',
        unit: getUnit(item.exportCode, item.exportNo, groupRec, stockRec),
        team: getTeam(stockRec, groupRec),
        daysDiff: calculateDaysDiff(item.realExport)
      };
    });
    
    // Auto-create targets for new units
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
        showNotification(`🎯 Auto-created target for ${unit}`, 'info');
      }
    });
    
    // Find completed items
    const completedExportNosArray = [...currentExportNos].filter(no => !newExportNosSet.has(no));
    
    if (completedExportNosArray.length > 0) {
      const newCompletions = completedExportNosArray.map(no => {
        const foundItem = data.find(item => item.exportNo === no);
        return {
          exportNo: no,
          completedAt: new Date().toISOString(),
          unit: foundItem?.unit || 'UNKNOWN'
        };
      });
      setCompletionHistory(prev => [...newCompletions, ...prev]);
      
      completedExportNosArray.forEach(no => {
        showNotification(`✅ COMPLETED: ${no} cleared! +1 Result`, 'success');
      });
      playAlarmSound();
    }
    
    setData(processedNewData);
    setTimeout(() => checkTargetChanges(), 500);
    
    const excludedCount = newRawData.length - filteredRawData.length;
    showNotification(`📊 Import Summary:\n✅ Completed: ${completedExportNosArray.length}\n🆕 New Added: ${filteredRawData.length}\n🚫 Excluded: ${excludedCount} (GPON/GIS_MOD)\n🎯 New Units: ${newUnitsFound.length > 0 ? newUnitsFound.join(', ') : 'None'}`, 'info');
  };

  // Calculate KPI Data
  const calculateKPIData = useMemo(() => {
    const unitGroups = {};
    
    activeRecords.forEach(item => {
      const unit = item.unit;
      if (unit !== 'OTHER') {
        if (!unitGroups[unit]) {
          unitGroups[unit] = { currentExportNos: new Set(), count: 0 };
        }
        unitGroups[unit].currentExportNos.add(item.exportNo);
        unitGroups[unit].count++;
      }
    });
    
    const completedByUnit = {};
    completionHistory.forEach(completion => {
      if (completion.unit !== 'UNKNOWN') {
        completedByUnit[completion.unit] = (completedByUnit[completion.unit] || 0) + 1;
      }
    });
    
    const kpiData = [];
    let grandTargetMorning = 0;
    let grandTargetEvening = 0;
    let grandRemain = 0;
    let grandResult = 0;
    let grandTotalRecords = 0;
    
    const unitsToProcess = isUnitUser ? [userUnit] : allUnits;
    
    unitsToProcess.forEach(unit => {
      const morningTarget = targets[unit]?.morning || 0;
      const eveningTarget = targets[unit]?.evening || 0;
      const target = eveningTarget > 0 ? eveningTarget : morningTarget;
      const currentCount = unitGroups[unit]?.count || 0;
      const completedCount = completedByUnit[unit] || 0;
      
      const result = completedCount;
      const remain = target > 0 ? Math.max(0, target - result) : currentCount;
      let ratio = 0;
      if (target > 0) {
        ratio = (result / target) * 100;
      } else if (currentCount === 0 && result === 0) {
        ratio = 100;
      }
      
      let status = 'No Data';
      if (currentCount > 0 || result > 0 || target > 0) {
        if (remain === 0 && target > 0) status = 'Completed';
        else if (ratio >= 80) status = 'Good';
        else if (ratio >= 50) status = 'Warning';
        else if (target > 0 && ratio < 50 && ratio > 0) status = 'Critical';
        else if (target === 0 && currentCount > 0) status = 'No Target';
      }
      
      kpiData.push({
        unit,
        morningTarget,
        eveningTarget,
        target,
        remain,
        result,
        ratio: Math.min(100, ratio),
        total: currentCount,
        status,
        hasData: currentCount > 0 || result > 0,
        isNew: !targets[unit] && currentCount > 0,
        hasChange: morningTarget !== eveningTarget && eveningTarget > 0
      });
      
      grandTargetMorning += morningTarget;
      grandTargetEvening += eveningTarget;
      grandRemain += remain;
      grandResult += result;
      grandTotalRecords += currentCount;
    });
    
    let filteredData = kpiData;
    if (kpiViewMode === 'active') {
      filteredData = kpiData.filter(item => item.hasData && item.remain > 0);
    } else if (kpiViewMode === 'completed') {
      filteredData = kpiData.filter(item => item.hasData && item.remain === 0 && item.target > 0);
    }
    
    filteredData.sort((a, b) => {
      let aVal, bVal;
      switch (kpiSortBy) {
        case 'ratio': aVal = a.ratio; bVal = b.ratio; break;
        case 'remain': aVal = a.remain; bVal = b.remain; break;
        case 'result': aVal = a.result; bVal = b.result; break;
        case 'morning': aVal = a.morningTarget; bVal = b.morningTarget; break;
        case 'evening': aVal = a.eveningTarget; bVal = b.eveningTarget; break;
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
        completedUnits: kpiData.filter(item => item.hasData && item.remain === 0 && item.target > 0).length,
        unitsWithChanges: kpiData.filter(item => item.hasChange).length
      }
    };
  }, [activeRecords, targets, completionHistory, kpiViewMode, kpiSortBy, kpiSortOrder, isUnitUser, userUnit]);

  // Parse pasted data
  const parsePastedData = (text) => {
    const rows = text.split(/\r?\n/);
    const parsedRows = [];
    if (rows.length === 0) return parsedRows;

    let exportCodeIdx = -1;
    let exportNoIdx = -1;
    let realExportIdx = -1;
    let stockReceiverIdx = -1;
    let groupReceiverIdx = -1;
    let constructionReceiverIdx = -1;

    let startRowIndex = 0;
    
    const firstRow = rows[0].trim();
    if (firstRow) {
      const headerCells = firstRow.split(/\t| {2,}/).map(c => c.trim().toLowerCase());
      
      const hasHeaderWord = headerCells.some(cell => {
        const clean = cell.replace(/[^a-z0-9]/g, ' ');
        return clean.includes('code') || 
               clean.includes('warehouse') || 
               clean.includes('stock out') || 
               clean.includes('stockout') || 
               clean.includes('no') || 
               clean.includes('date') || 
               clean.includes('receiver');
      });
      
      if (hasHeaderWord) {
        startRowIndex = 1;
        headerCells.forEach((cell, idx) => {
          const clean = cell.replace(/[^a-z0-9]/g, ' ');
          
          if (clean.includes('no') && (clean.includes('seq') || clean === 'no')) return;
          
          if (clean.includes('code') || clean.includes('warehouse') || clean.includes('stock out') || clean.includes('stockout')) {
            exportCodeIdx = idx;
          } else if (clean.includes('export') && (clean.includes('no') || clean.includes('num'))) {
            exportNoIdx = idx;
          } else if (clean.includes('date') || clean.includes('time') || clean.includes('real')) {
            realExportIdx = idx;
          } else if (clean.includes('stock') && clean.includes('receiver')) {
            stockReceiverIdx = idx;
          } else if (clean.includes('group') && clean.includes('receiver')) {
            groupReceiverIdx = idx;
          } else if (clean.includes('construction') && clean.includes('receiver')) {
            constructionReceiverIdx = idx;
          }
        });
      }
    }

    for (let i = startRowIndex; i < rows.length; i++) {
      const row = rows[i].trim();
      if (!row) continue;
      
      const cells = row.split(/\t| {2,}/);
      if (cells.length === 0) continue;

      if (exportCodeIdx === -1 && exportNoIdx === -1 && realExportIdx === -1) {
        const firstCell = cells[0].trim().replace(/\.$/, '');
        const isSequence = /^\d+$/.test(firstCell);
        const offset = isSequence ? 1 : 0;
        
        if (cells.length - offset >= 3) {
          parsedRows.push({
            exportCode: cells[offset + 0] || '',
            exportNo: cells[offset + 1] || '',
            realExport: cells[offset + 2] || '',
            stockReceiver: cells[offset + 3] || '',
            groupReceiver: cells[offset + 4] || '',
            constructionReceiver: cells[offset + 5] || ''
          });
        }
      } else {
        parsedRows.push({
          exportCode: exportCodeIdx !== -1 ? (cells[exportCodeIdx] || '') : '',
          exportNo: exportNoIdx !== -1 ? (cells[exportNoIdx] || '') : '',
          realExport: realExportIdx !== -1 ? (cells[realExportIdx] || '') : '',
          stockReceiver: stockReceiverIdx !== -1 ? (cells[stockReceiverIdx] || '') : '',
          groupReceiver: groupReceiverIdx !== -1 ? (cells[groupReceiverIdx] || '') : '',
          constructionReceiver: constructionReceiverIdx !== -1 ? (cells[constructionReceiverIdx] || '') : ''
        });
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
      if (item.id === id) return { ...item, [field]: value };
      return item;
    });
    const computedData = updatedData.map(item => {
      const stockRec = item.stockReceiver || '';
      const groupRec = item.groupReceiver || '';
      return {
        ...item,
        unit: getUnit(item.exportCode, item.exportNo, groupRec, stockRec),
        team: getTeam(stockRec, groupRec),
        daysDiff: calculateDaysDiff(item.realExport)
      };
    });
    setData(computedData);
  };

  const clearAllData = async () => {
    if (window.confirm('⚠️ Are you sure you want to delete ALL data?')) {
      setData([]);
      setCompletionHistory([]);
      setTargets({});
      
      // Clear localStorage immediately
      localStorage.removeItem(STORAGE_KEYS.DATA);
      localStorage.removeItem(STORAGE_KEYS.COMPLETION);
      localStorage.removeItem(STORAGE_KEYS.TARGETS);
      localStorage.removeItem(STORAGE_KEYS.TARGET_HISTORY);
      
      // Show notification instantly
      showNotification('All data cleared!', 'warning');
      
      // Clear DB stores in background
      Promise.all([
        clearStore(STORAGE_KEYS.DATA),
        clearStore(STORAGE_KEYS.COMPLETION),
        clearStore(STORAGE_KEYS.TARGETS),
        clearStore(STORAGE_KEYS.TARGET_HISTORY)
      ]).catch(err => {
        console.error("Error clearing DB store:", err);
      });
    }
  };

  const deleteSelectedRows = () => {
    if (selectedRows.size === 0) return;
    if (window.confirm(`⚠️ Delete ${selectedRows.size} row(s)?`)) {
      const deletedExportNos = data.filter(item => selectedRows.has(item.id)).map(item => item.exportNo);
      const newCompletions = deletedExportNos.map(no => ({
        exportNo: no, completedAt: new Date().toISOString(),
        unit: data.find(item => item.exportNo === no)?.unit || 'UNKNOWN'
      }));
      setCompletionHistory(prev => [...newCompletions, ...prev]);
      const newData = data.filter(item => !selectedRows.has(item.id));
      setData(newData.map((item, index) => ({ ...item, no: index + 1 })));
      setSelectedRows(new Set());
      showNotification(`${deletedExportNos.length} item(s) marked as Completed!`, 'success');
      playAlarmSound();
    }
  };

  /*
  const deleteRow = (id) => {
    const itemToDelete = data.find(item => item.id === id);
    if (itemToDelete && window.confirm(`Delete this row?`)) {
      setCompletionHistory(prev => [{
        exportNo: itemToDelete.exportNo, completedAt: new Date().toISOString(), unit: itemToDelete.unit
      }, ...prev]);
      const newData = data.filter(item => item.id !== id);
      setData(newData.map((item, index) => ({ ...item, no: index + 1 })));
      setSelectedRows(prev => { const newSet = new Set(prev); newSet.delete(id); return newSet; });
      showNotification(`✅ Completed: ${itemToDelete.exportNo}`, 'success');
      playAlarmSound();
    }
  };
  */

  const updateTarget = (unit, period, newTarget) => updateTargetWithHistory(unit, period, newTarget);
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
    if (selectedRows.size === data.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(data.map(item => item.id)));
  };

  const exportToExcel = () => {
    const exportData = filteredData.map(item => ({
      'No': item.no, 'Warehouse Stock out': item.exportCode, 'Export No': item.exportNo,
      'Date': item.realExport, 'Stock Receiver': item.stockReceiver,
      'Group Receiver': item.groupReceiver, 'Construction Receiver': item.constructionReceiver,
      'Unit': item.unit, "Days": item.daysDiff, 'TEAM': item.team || '-',
      'Status': item.daysDiff >= alarmThreshold ? 'ALARM' : 'Normal'
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
    XLSX.utils.book_append_sheet(wb, ws, 'Stockout Data');
    XLSX.writeFile(wb, `stockout_data_${new Date().toISOString().split('T')[0]}.xlsx`);
    showNotification('📎 Export completed!', 'success');
  };

  const exportKPItoExcel = () => {
    const exportData = calculateKPIData.allData.map(item => ({
      'Unit': item.unit, 'Target ព្រឹក': item.morningTarget, 'Target ល្ងាច': item.eveningTarget,
      'Remain': item.remain, 'Result': item.result, 'Ratio (%)': item.ratio.toFixed(1),
      'In System': item.total, 'Status': item.status
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
    XLSX.utils.book_append_sheet(wb, ws, 'KPI Dashboard');
    XLSX.writeFile(wb, `kpi_dashboard_${new Date().toISOString().split('T')[0]}.xlsx`);
    showNotification('📎 KPI Export completed!', 'success');
  };

  // 🚫 Filtered data with exclusions applied
  const filteredData = useMemo(() => {
    let filtered = activeRecords;
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase().trim();
      const isTermUnit = allUnits.some(u => u.toLowerCase() === term) || term === 'other';
      
      filtered = filtered.filter(item => {
        if (isTermUnit) {
          return item.unit?.toLowerCase() === term;
        }
        return (
          item.exportCode?.toLowerCase().includes(term) ||
          item.exportNo?.toLowerCase().includes(term) ||
          item.groupReceiver?.toLowerCase().includes(term) ||
          item.constructionReceiver?.toLowerCase().includes(term) ||
          item.unit?.toLowerCase().includes(term) ||
          item.team?.toLowerCase().includes(term)
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
    return filteredData.filter(item => item.daysDiff >= alarmThreshold && !dismissedItems.has(item.id));
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
        item.exportCode?.toLowerCase().includes(term) ||
        item.exportNo?.toLowerCase().includes(term) ||
        item.stockReceiver?.toLowerCase().includes(term) ||
        item.groupReceiver?.toLowerCase().includes(term) ||
        item.constructionReceiver?.toLowerCase().includes(term)
      );
    }
    return filtered;
  }, [alarmItems, alarmSearchTerm, selectedAlarmUnit]);

  const copyAlarmsToClipboard = () => {
    if (filteredAlarmItems.length === 0) return;
    const text = filteredAlarmItems.map(item => 
      `${item.unit}\n| Code: ${item.exportCode} | No: ${item.exportNo}\n📅 Date: ${item.realExport} | ⏰ Delay: +${item.daysDiff} days\nReceiver: ${item.stockReceiver || '-'} (${item.groupReceiver || '-'})`
    ).join('\n\n');
    navigator.clipboard.writeText(text);
    showNotification('📋 Alarm list copied to clipboard!', 'success');
  };

  useEffect(() => {
    setData(prevData => {
      let changed = false;
      const updated = prevData.map(item => {
        const currentDaysDiff = calculateDaysDiff(item.realExport);
        if (item.daysDiff !== currentDaysDiff) {
          changed = true;
          return { ...item, daysDiff: currentDaysDiff };
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
        const stored = sessionStorage.getItem('shown_stockout_alarms');
        if (stored) shownIds = new Set(JSON.parse(stored));
      } catch (e) {}

      const newAlarms = alarmItems.filter(item => !shownIds.has(item.id));
      if (newAlarms.length > 0) {
        setShowAlarmModal(true);
        playAlarmSound();
        
        alarmItems.forEach(item => shownIds.add(item.id));
        try {
          sessionStorage.setItem('shown_stockout_alarms', JSON.stringify([...shownIds]));
        } catch (e) {}
      }
    }
  }, [alarmItems]);

  const getDaysColor = (days) => {
    if (days < 0) return 'text-rose-600 bg-rose-50';
    if (days === 0) return 'text-amber-600 bg-amber-50';
    if (days <= 3) return 'text-yellow-600 bg-yellow-50';
    if (days >= alarmThreshold) return 'text-rose-700 bg-rose-100 animate-pulse';
    return 'text-emerald-600 bg-emerald-50';
  };

  const getStatusBadge = (status) => {
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
  // Target Comparison Alert Modal
  const renderComparisonAlert = () => {
    if (!showComparisonAlert) return null;
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4">
          <div className="bg-gradient-to-r from-orange-500 to-rose-600 px-6 py-4 rounded-t-2xl">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="text-2xl animate-bounce">📊</div>
                <h2 className="text-xl font-bold text-white">Target Changes (ព្រឹក → ល្ងាច)</h2>
              </div>
              <button onClick={() => setShowComparisonAlert(false)} className="text-white/80 hover:text-white text-2xl">✕</button>
            </div>
          </div>
          <div className="p-6">
            <p className="text-gray-600 mb-4">Changes detected for {comparisonChanges.length} Unit(s):</p>
            <div className="max-h-64 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">ព្រឹក</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">ល្ងាច</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {comparisonChanges.map((change, idx) => (
                    <tr key={idx} className={change.diff > 0 ? 'bg-emerald-50' : 'bg-rose-50'}>
                      <td className="px-4 py-2 text-sm font-medium">{change.unit}</td>
                      <td className="px-4 py-2 text-sm text-right">{change.morning}</td>
                      <td className="px-4 py-2 text-sm text-right font-bold">{change.evening}</td>
                      <td className={`px-4 py-2 text-sm text-right font-bold ${change.diff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {change.diff > 0 ? `+${change.diff}` : change.diff} ({change.percentage}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setShowComparisonAlert(false)} className="px-4 py-2 bg-gray-200 rounded-xl hover:bg-gray-300 transition-colors">Close</button>
              <button onClick={() => { setShowComparisonAlert(false); setShowKPIModal(true); }} className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors">View KPI Dashboard</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Target History Modal
  const renderTargetHistoryModal = () => {
    if (!showTargetHistoryModal) return null;
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
        <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
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
                          <div className="font-bold text-lg text-gray-800">{history.unit} {history.period && `(${history.period === 'morning' ? 'ព្រឹក' : 'ល្ងាច'})`}</div>
                          <div className="text-sm text-gray-600">
                            {history.oldTarget !== null ? (
                              <>Changed from <span className="line-through text-rose-500">{history.oldTarget}</span> → <span className="text-emerald-600 font-bold">{history.newTarget}</span></>
                            ) : (
                              <>Auto-created: <span className="text-emerald-600 font-bold">{history.newTarget}</span></>
                            )}
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

  // KPI Modal
  const renderKPIModal = () => {
    if (!showKPIModal) return null;
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
        <div className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📊</span>
                <div>
                  <h2 className="text-xl font-bold text-white">KPI Dashboard - Stockout Performance</h2>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowTargetHistoryModal(true)} className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-lg text-sm transition-colors">📜 History</button>
                <button onClick={() => setShowKPIModal(false)} className="text-white/80 hover:text-white text-2xl">✕</button>
              </div>
            </div>
          </div>
          
          <div className="p-6 overflow-y-auto flex-1">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-xs opacity-90">Target ព្រឹក</div>
                <div className="text-2xl font-bold">{calculateKPIData.summary.targetMorning}</div>
              </div>
              <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-xs opacity-90">Target ល្ងាច</div>
                <div className="text-2xl font-bold">{calculateKPIData.summary.targetEvening}</div>
              </div>
              <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl p-4 text-white shadow-lg">
                <div className="text-xs opacity-90">Remain</div>
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
                      <th className="px-4 py-3 text-left text-xs font-medium cursor-pointer hover:text-gray-700" onClick={() => handleSort('unit')}>Unit {kpiSortBy === 'unit' && (kpiSortOrder === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium cursor-pointer hover:text-gray-700" onClick={() => handleSort('morning')}>ព្រឹក {kpiSortBy === 'morning' && (kpiSortOrder === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium cursor-pointer hover:text-gray-700" onClick={() => handleSort('evening')}>ល្ងាច {kpiSortBy === 'evening' && (kpiSortOrder === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium cursor-pointer hover:text-gray-700" onClick={() => handleSort('remain')}>Remain</th>
                      <th className="px-4 py-3 text-right text-xs font-medium cursor-pointer hover:text-gray-700" onClick={() => handleSort('result')}>Result</th>
                      <th className="px-4 py-3 text-right text-xs font-medium cursor-pointer hover:text-gray-700" onClick={() => handleSort('ratio')}>Ratio</th>
                      <th className="px-4 py-3 text-right text-xs font-medium">In System</th>
                      <th className="px-4 py-3 text-center text-xs font-medium">Status</th>
                      <th className="px-4 py-3 text-center text-xs font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {calculateKPIData.data.map((item) => (
                      <tr key={item.unit} className={`hover:bg-gray-50 ${item.hasChange ? 'bg-amber-50' : ''}`}>
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
                        <td className="px-4 py-3 text-center">{getStatusBadge(item.status)}</td>
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
                      <td className="px-4 py-3">សរុប</td>
                      <td className="px-4 py-3 text-right">{calculateKPIData.summary.targetMorning}</td>
                      <td className="px-4 py-3 text-right">{calculateKPIData.summary.targetEvening}</td>
                      <td className="px-4 py-3 text-right text-amber-600">{calculateKPIData.summary.remain}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{calculateKPIData.summary.result}</td>
                      <td className="px-4 py-3 text-right">{calculateKPIData.summary.ratio.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-right">{calculateKPIData.summary.totalRecords}</td>
                      <td className="px-4 py-3 text-center">-</td>
                      <td className="px-4 py-3 text-center">-</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
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

  // Smart Import Modal
  const renderPasteModal = () => {
    if (!showPasteModal) return null;
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full mx-4">
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-4 rounded-t-2xl">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-white">🔄 Smart Import</h2>
                <p className="text-blue-100 text-sm">Auto-filters GPON (for SPE, TAK, KAM, CHH) & GIS_MOD | Unit from Group Receiver</p>
              </div>
              <button onClick={() => setShowPasteModal(false)} className="text-white/80 hover:text-white text-2xl">✕</button>
            </div>
          </div>
          <div className="p-6">
            <textarea 
              value={pasteData} 
              onChange={(e) => setPasteData(e.target.value)} 
              placeholder="Paste your system data here...&#10;&#10;Format: Export Code, Export No, Date, Stock Receiver, Group Receiver, Construction Receiver&#10;&#10;🚫 Items with GPON (for SPE, TAK, KAM, CHH) or GIS_MOD will be automatically excluded" 
              className="w-full h-64 px-4 py-3 border rounded-xl font-mono text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
            <div className="mt-4 p-3 bg-gray-50 rounded-xl">
              <div className="text-sm text-gray-600">
                <strong>📊 What will happen:</strong>
                <ul className="mt-1 ml-4 list-disc">
                  <li>🎯 <span className="text-purple-600">Unit</span> → Extracted from Group Receiver</li>
                  <li>🚫 <span className="text-rose-600">EXCLUDED</span> → GPON (for SPE, TAK, KAM, CHH) &amp; GIS_MOD (Group Receiver)</li>
                  <li>🎯 <span className="text-purple-600">New Unit</span> → Auto-create target (morning/evening)</li>
                  <li>✅ <span className="text-emerald-600">COMPLETED</span> → Missing Export No (+1 Result)</li>
                  <li>📋 <span className="text-blue-600">REMAINING</span> → Same Export No</li>
                </ul>
              </div>
            </div>
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

  // Alarm Modal
  const renderAlarmModal = () => {
    if (!showAlarmModal) return null;
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
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
                        <span className="text-gray-500 font-mono">| Code: {item.exportCode} | No: {item.exportNo}</span>
                      </div>
                      <div className="text-gray-600 mt-1">📅 Date: {item.realExport} | ⏰ Delay: <span className="font-semibold text-rose-600 font-mono">+{item.daysDiff} days</span></div>
                      <div className="text-[11px] text-gray-500 mt-1">Receiver: {item.stockReceiver || '-'} ({item.groupReceiver || '-'})</div>
                    </div>
                    <button onClick={() => setDismissedItems(prev => new Set([...prev, item.id]))} className="px-2.5 py-1 text-xs bg-white border border-rose-300 rounded-lg hover:bg-rose-50 text-rose-700 transition-colors">Dismiss</button>
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

  // ─── FLOATING BUTTONS ───
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
      {renderComparisonAlert()}
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
                  <span>📦</span> STOCKOUT YET CONFIRM
                </h1>
                <span className="bg-white/20 text-white text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider border border-white/30">
                  🟢 Live • {currentTime.toLocaleTimeString()}
                </span>
              </div>
              <p className="text-blue-100 mt-1 text-sm">TEAM STEP 1</p>
              <p className="text-blue-100 mt-1 text-sm">**តាមដានសម្ភារៈដែលបាន Request ហើយត្រូវបាន Export ពីស្តុក METFONE មកកាន់ស្តុក GIS។**</p>
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
              {null}
            </div>
          </div>
        </div>

        {/* ─── STATS BAR ─── */}
        <div className="px-6 py-3 bg-gray-100 border-b border-gray-200 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white rounded-xl px-3 py-2 shadow-sm">
            <div className="text-xs text-gray-500">In System</div>
            <div className="text-xl font-bold text-blue-600">{activeRecords.length}</div>
          </div>
          <div className="bg-white rounded-xl px-3 py-2 shadow-sm">
            <div className="text-xs text-gray-500">GIS Records</div>
            <div className="text-xl font-bold text-emerald-600">{filteredData.length}</div>
          </div>
          <div className="bg-white rounded-xl px-3 py-2 shadow-sm">
            <div className="text-xs text-gray-500">Selected</div>
            <div className="text-xl font-bold text-indigo-600">{selectedRows.size}</div>
          </div>
          <div className="bg-white rounded-xl px-3 py-2 shadow-sm">
            <div className="text-xs text-gray-500">Threshold</div>
            <div className="text-xl font-bold text-amber-600">&ge;{alarmThreshold}d</div>
          </div>
          <div className={`bg-white rounded-xl px-3 py-2 shadow-sm cursor-pointer hover:bg-rose-50 transition-colors ${alarmCount > 0 ? 'border-2 border-rose-500' : ''}`} onClick={() => { if (alarmCount > 0) setShowAlarmModal(true); }}>
            <div className="text-xs text-gray-500">Alarms</div>
            <div className={`text-xl font-bold ${alarmCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{alarmCount}</div>
          </div>
          <div className="bg-white rounded-xl px-3 py-2 shadow-sm cursor-pointer hover:bg-purple-50 transition-colors" onClick={() => setShowKPIModal(true)}>
            <div className="text-xs text-gray-500">Result (Cleared)</div>
            <div className="text-xl font-bold text-purple-600">{calculateKPIData.summary.result}</div>
          </div>
        </div>

        {/* ─── TABLE WITH STICKY HEADER ─── */}
        <div className="relative overflow-x-auto overflow-y-auto max-h-[calc(100vh-420px)] border-b border-gray-200">
          <table className="min-w-full border-separate border-spacing-0 table-auto text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-2 w-8 bg-gray-50 sticky top-0 z-10 border-b border-gray-200 shadow-[inset_0_-1px_0_rgba(229,231,235,1)]">
                  <input type="checkbox" checked={selectedRows.size === data.length && data.length > 0} onChange={toggleSelectAll} className="rounded" />
                </th>
                {columns.map(col => (
                  <th key={col.key} className={`px-2 py-2 text-xs font-semibold text-gray-600 uppercase ${col.width} whitespace-nowrap bg-gray-50 sticky top-0 z-10 border-b border-gray-200 shadow-[inset_0_-1px_0_rgba(229,231,235,1)] ${col.align || 'text-left'}`}>
                    {col.label}
                  </th>
                ))}
              </tr>

            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedData.map((item) => {
                const isAlarm = item.daysDiff >= alarmThreshold && !dismissedItems.has(item.id);
                return (
                  <tr key={item.id} className={`${isAlarm ? 'bg-rose-50' : ''} ${selectedRows.has(item.id) ? 'bg-blue-50' : ''} hover:bg-gray-50 transition-colors`}>
                    <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={selectedRows.has(item.id)} onChange={() => toggleRowSelection(item.id)} className="rounded" /></td>
                    <td className="px-2 py-1.5 text-xs text-gray-500 text-center">{item.no}</td>
                    <td className="px-2 py-1.5 text-xs font-mono break-all">
                      {editingCell?.id === item.id && editingCell?.field === 'exportCode' ? (
                        <input type="text" defaultValue={item.exportCode} autoFocus onBlur={(e) => saveEdit(item.id, 'exportCode', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'exportCode')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'exportCode', item.exportCode)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{item.exportCode || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs font-mono break-all">
                      {editingCell?.id === item.id && editingCell?.field === 'exportNo' ? (
                        <input type="text" defaultValue={item.exportNo} autoFocus onBlur={(e) => saveEdit(item.id, 'exportNo', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'exportNo')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'exportNo', item.exportNo)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">{item.exportNo || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center text-xs font-mono">
                      {editingCell?.id === item.id && editingCell?.field === 'realExport' ? (
                        <input type="text" defaultValue={item.realExport} placeholder="DD/MM/YYYY" autoFocus onBlur={(e) => saveEdit(item.id, 'realExport', e.target.value)} onKeyDown={(e) => handleKeyPress(e, item.id, 'realExport')} className="w-full px-1.5 py-0.5 border rounded-xl text-xs text-center bg-white" />
                      ) : (
                        <div onClick={() => startEdit(item.id, 'realExport', item.realExport)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded text-center transition-colors">{item.realExport || '-'}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs whitespace-normal break-words">
                      <div onClick={() => startEdit(item.id, 'stockReceiver', item.stockReceiver)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">
                        {item.stockReceiver?.includes('GIS') ? (
                          <span className="text-emerald-600 font-medium">{item.stockReceiver}</span>
                        ) : item.stockReceiver || '-'}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-xs whitespace-normal break-words">
                      <div onClick={() => startEdit(item.id, 'groupReceiver', item.groupReceiver)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">
                        {(item.groupReceiver?.includes('GIS') || getUnitFromGroupReceiver(item.groupReceiver) !== null) ? (
                          <span className="text-emerald-600 font-medium">{item.groupReceiver}</span>
                        ) : item.groupReceiver || '-'}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-xs whitespace-normal break-words">
                      <div onClick={() => startEdit(item.id, 'constructionReceiver', item.constructionReceiver)} className="cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded transition-colors">
                        {item.constructionReceiver?.toUpperCase().includes('GPON') && ['SPE', 'TAK', 'KAM', 'CHH'].includes(item.unit) ? (
                          <span className="text-rose-500 line-through font-medium">{item.constructionReceiver} 🚫</span>
                        ) : item.constructionReceiver || '-'}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${isAlarm ? 'bg-rose-200 text-rose-800' : 'bg-indigo-100 text-indigo-800'}`}>{item.unit}</span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${getDaysColor(item.daysDiff)}`}>
                        {item.daysDiff > 0 ? `+${item.daysDiff}` : item.daysDiff} {Math.abs(item.daysDiff) === 1 ? 'day' : 'days'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center font-semibold text-gray-700 whitespace-nowrap">
                      {item.team || '-'}
                    </td>
                  </tr>
                );
              })}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center gap-3">
                      <div className="text-4xl">📭</div>
                      <p className="text-lg font-medium">No data in system</p>
                      <p className="text-sm text-gray-400">Click "Smart Import" to import data</p>
                      <p className="text-xs text-rose-400">🚫 GPON (for SPE, TAK, KAM, CHH) and GIS_MOD are automatically filtered out</p>
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
          <span>📋 In System: <strong>{activeRecords.length}</strong> rows | GIS: <strong>{filteredData.length}</strong> rows | Alarms: <strong>{alarmCount}</strong></span>
          {/* <span>🎯 Unit from Group Receiver | 🚫 Excluded: GPON (Construction) | GIS_MOD (Group Receiver)</span> */}
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

export default STOCKOUT_YET_CONFIRM;