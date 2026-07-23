import React, { useState } from 'react';
import * as XLSX from 'xlsx';

const Sidebar = ({ onSelect, selected, user, onLogout }) => {
  const [isStockoutOpen, setIsStockoutOpen] = useState(false);
  const [isSignedCAOpen, setIsSignedCAOpen] = useState(false);
  const [isRestockOpen, setIsRestockOpen] = useState(false);

  React.useEffect(() => {
    if (['STOCKOUT_YET_CONFIRM', 'NO_CREATE_HAND_OVER', 'STOCK_OUT_NOTE_CONFIRMED', 'stockout_group'].includes(selected)) {
      setIsStockoutOpen(true);
      setIsSignedCAOpen(false);
      setIsRestockOpen(false);
    } else if (['STOCK_OUT_IS_SIGNING', 'STOCK_IN_IS_SIGNING', 'signed_ca_group'].includes(selected)) {
      setIsSignedCAOpen(true);
      setIsStockoutOpen(false);
      setIsRestockOpen(false);
    } else if (['RESTOCK_IN', 'RESTOCK_OUT', 'restock_group'].includes(selected)) {
      setIsRestockOpen(true);
      setIsStockoutOpen(false);
      setIsSignedCAOpen(false);
    }
  }, [selected]);

  const menuItems = [
    { 
      id: 'dashboard', 
      label: 'MAIN DASHBOARD', 
      icon: '🏠',
      number: '00'
    },
    { 
      id: 'stockout_group', 
      label: 'CONFIRMED HAND OVER', 
      icon: '📋',
      number: '01',
      isGroup: true,
      children: [
        { 
          id: 'STOCKOUT_YET_CONFIRM', 
          label: 'STOCKOUT YET CONFIRM', 
          icon: '📦',
          number: '01',
          desc: 'Pending confirmations'
        },
        { 
          id: 'NO_CREATE_HAND_OVER', 
          label: 'NOT CREATE HAND OVER', 
          icon: '📝',
          number: '02',
          desc: 'Not yet created'
        },
        { 
          id: 'STOCK_OUT_NOTE_CONFIRMED', 
          label: 'HAND OVER YET CONFIRM', 
          icon: '⚠️',
          number: '03',
          desc: 'Awaiting confirmation'
        },
      ]
    },
    { 
      id: 'signed_ca_group', 
      label: 'SIGNED "CA" SYSTEM', 
      icon: '✅',
      number: '02',
      isGroup: true,
      children: [
        { 
          id: 'STOCK_OUT_IS_SIGNING', 
          label: 'STOCK OUT IS SIGNING', 
          icon: '📤',
          number: '01',
          desc: 'Export signing'
        },
        { 
          id: 'STOCK_IN_IS_SIGNING', 
          label: 'STOCK IN IS SIGNING', 
          icon: '📥',
          number: '02',
          desc: 'Import signing'
        },
      ]
    },
    { 
      id: 'restock_group', 
      label: 'RESTOCK IN / OUT', 
      icon: '🔄',
      number: '03',
      isGroup: true,
      children: [
        { 
          id: 'RESTOCK_IN', 
          label: 'RESTOCK IN', 
          icon: '📥',
          number: '01',
          desc: 'Incoming restock'
        },
        { 
          id: 'RESTOCK_OUT', 
          label: 'RESTOCK OUT', 
          icon: '📤',
          number: '02',
          desc: 'Outgoing restock'
        },
      ]
    },
  ];

  const isGroupActive = (groupItem) => {
    if (groupItem.isGroup) {
      return groupItem.children.some(child => selected === child.id);
    }
    return false;
  };

  const toggleStockout = () => {
    setIsStockoutOpen(!isStockoutOpen);
    setIsSignedCAOpen(false);
    setIsRestockOpen(false);
  };

  const toggleSignedCA = () => {
    setIsSignedCAOpen(!isSignedCAOpen);
    setIsStockoutOpen(false);
    setIsRestockOpen(false);
  };

  const toggleRestock = () => {
    setIsRestockOpen(!isRestockOpen);
    setIsStockoutOpen(false);
    setIsSignedCAOpen(false);
  };

  const getToggleFunction = (itemId) => {
    if (itemId === 'stockout_group') return toggleStockout;
    if (itemId === 'signed_ca_group') return toggleSignedCA;
    if (itemId === 'restock_group') return toggleRestock;
    return () => {};
  };

  const isGroupOpen = (itemId) => {
    if (itemId === 'stockout_group') return isStockoutOpen;
    if (itemId === 'signed_ca_group') return isSignedCAOpen;
    if (itemId === 'restock_group') return isRestockOpen;
    return false;
  };

  const getUnitFromRequestCode = (code) => {
    if (!code) return '';
    const cleanCode = String(code).toUpperCase().trim();
    const parts = cleanCode.split('_');
    for (const part of parts) {
      if (part.startsWith('GIS')) {
        const subParts = part.split('-');
        if (subParts.length > 1) return subParts[1];
      }
    }
    const VALID_UNITS = [
      'BAN', 'BAT', 'CHA', 'CHH', 'KAM', 'KAN', 'KANZ1', 'KOH', 'KRA',
      'MON', 'ODD', 'PNP', 'PNPZ1', 'PNPZ2', 'PRE', 'PRH', 'PUR', 'ROT',
      'SIE', 'SIH', 'SPE', 'STU', 'SVA', 'TAK', 'THO'
    ];
    for (const u of VALID_UNITS) {
      if (cleanCode.includes(u)) return u;
    }
    return '';
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
    return '';
  };

  const handleExportAllExcel = () => {
    const getStorageData = (key) => {
      try {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : null;
      } catch (e) {
        return null;
      }
    };

    const isUnitUser = user && user.role === 'unit' && user.unit;
    const userUnit = user?.unit;

    const filterByUnit = (list, type) => {
      if (!list || !Array.isArray(list)) return [];
      if (!isUnitUser) return list;
      return list.filter(item => {
        if (type === 'ca') {
          return item.unit === userUnit || extractUnit(item) === userUnit;
        } else if (type === 'restock_in') {
          return (item.unit || getUnitFromRequestCode(item.importRequestCode)) === userUnit;
        } else if (type === 'restock_out') {
          return (item.unit || getUnitFromRequestCode(item.requestExportCode)) === userUnit;
        } else {
          return item.unit === userUnit;
        }
      });
    };

    // CONFIRMED HAND OVER DATA
    const stockoutData = filterByUnit(getStorageData('kpi_stockout_data') || [], 'stockout');
    const stockoutHistory = filterByUnit(getStorageData('kpi_stockout_completionHistory') || [], 'stockout');
    const stockoutTargets = getStorageData('kpi_stockout_targets') || {};

    const nocreateData = filterByUnit(getStorageData('kpi_nocreate_data') || [], 'nocreate');
    const nocreateHistory = filterByUnit(getStorageData('kpi_nocreate_completionHistory') || [], 'nocreate');
    const nocreateConfirmed = getStorageData('kpi_nocreate_confirmedStatus') || {};
    const nocreateTargets = getStorageData('kpi_nocreate_targets') || {};

    const notconfirmedData = filterByUnit(getStorageData('kpi_notconfirmed_data') || [], 'notconfirmed');
    const notconfirmedHistory = filterByUnit(getStorageData('kpi_notconfirmed_completionHistory') || [], 'notconfirmed');
    const notconfirmedConfirmed = getStorageData('kpi_notconfirmed_confirmedStatus') || {};
    const notconfirmedTargets = getStorageData('kpi_notconfirmed_targets') || {};

    // SIGNED CA DATA
    const exportCaData = filterByUnit(getStorageData('export_ca_data') || [], 'ca');
    const exportCaHistory = filterByUnit(getStorageData('export_ca_completionHistory') || [], 'ca');
    const exportCaTargets = getStorageData('export_ca_targets') || {};
    const globalCaTargets = getStorageData('kpi_targets') || {};

    const importCaData = filterByUnit(getStorageData('import_ca_data') || [], 'ca');
    const importCaHistory = filterByUnit(getStorageData('import_ca_completionHistory') || [], 'ca');
    const importCaTargets = getStorageData('import_ca_targets') || {};

    // RESTOCK DATA
    const restockInData = filterByUnit(getStorageData('restock_in_data') || [], 'restock_in');
    const restockInHistory = filterByUnit(getStorageData('restock_in_completionHistory') || [], 'restock_in');
    const restockInConfirmed = getStorageData('restock_in_confirmedStatus') || {};
    const restockInTargets = getStorageData('restock_in_targets') || {};
    const globalRestockTargets = getStorageData('kpi_restock_targets') || {};

    const restockOutData = filterByUnit(getStorageData('restock_out_data') || [], 'restock_out');
    const restockOutHistory = filterByUnit(getStorageData('restock_out_completionHistory') || [], 'restock_out');
    const restockOutConfirmed = getStorageData('restock_out_confirmedStatus') || {};
    const restockOutTargets = getStorageData('restock_out_targets') || {};

    // KPI Summary Calculations
    const m1Result = stockoutHistory.length;
    const m1InSystem = stockoutData.length;
    const m1Morning = isUnitUser ? (stockoutTargets[userUnit]?.morning || 0) : Object.values(stockoutTargets).reduce((sum, t) => sum + (t?.morning || 0), 0);
    const m1Evening = isUnitUser ? (stockoutTargets[userUnit]?.evening || 0) : Object.values(stockoutTargets).reduce((sum, t) => sum + (t?.evening || 0), 0);
    const m1Target = new Date().getHours() < 12 ? m1Morning : (m1Evening > 0 ? m1Evening : m1Morning);
    const m1Remain = m1Target > 0 ? Math.max(0, m1Target - m1Result) : m1InSystem;
    const m1Ratio = m1Target > 0 ? ((m1Result / m1Target) * 100).toFixed(2) : (m1Remain === 0 ? '100.00' : '0.00');

    const m2ConfirmedCount = nocreateData.filter(item => nocreateConfirmed[item.id]).length;
    const m2Result = nocreateHistory.length + m2ConfirmedCount;
    const m2InSystem = nocreateData.length + nocreateHistory.length;
    const m2Morning = isUnitUser ? (nocreateTargets[userUnit]?.morning || 0) : Object.values(nocreateTargets).reduce((sum, t) => sum + (t?.morning || 0), 0);
    const m2Evening = isUnitUser ? (nocreateTargets[userUnit]?.evening || 0) : Object.values(nocreateTargets).reduce((sum, t) => sum + (t?.evening || 0), 0);
    const m2Target = new Date().getHours() < 12 ? m2Morning : (m2Evening > 0 ? m2Evening : m2Morning);
    const m2Remain = m2Target > 0 ? Math.max(0, m2Target - m2Result) : (nocreateData.length - m2ConfirmedCount);
    const m2Ratio = m2Target > 0 ? ((m2Result / m2Target) * 100).toFixed(2) : (m2Remain === 0 ? '100.00' : '0.00');

    const m3ConfirmedCount = notconfirmedData.filter(item => notconfirmedConfirmed[item.id]).length;
    const m3Result = notconfirmedHistory.length + m3ConfirmedCount;
    const m3InSystem = notconfirmedData.length + notconfirmedHistory.length;
    const m3Morning = isUnitUser ? (notconfirmedTargets[userUnit]?.morning || 0) : Object.values(notconfirmedTargets).reduce((sum, t) => sum + (t?.morning || 0), 0);
    const m3Evening = isUnitUser ? (notconfirmedTargets[userUnit]?.evening || 0) : Object.values(notconfirmedTargets).reduce((sum, t) => sum + (t?.evening || 0), 0);
    const m3Target = new Date().getHours() < 12 ? m3Morning : (m3Evening > 0 ? m3Evening : m3Morning);
    const m3Remain = m3Target > 0 ? Math.max(0, m3Target - m3Result) : (notconfirmedData.length - m3ConfirmedCount);
    const m3Ratio = m3Target > 0 ? ((m3Result / m3Target) * 100).toFixed(2) : (m3Remain === 0 ? '100.00' : '0.00');

    const caOutResult = exportCaHistory.length;
    const caOutInSystem = exportCaData.length + exportCaHistory.length;
    const caOutMorning = isUnitUser ? (exportCaTargets[userUnit]?.morning || 0) : (globalCaTargets.stock_out?.morning || Object.values(exportCaTargets).reduce((sum, t) => sum + (t?.morning || 0), 0));
    const caOutEvening = isUnitUser ? (exportCaTargets[userUnit]?.evening || 0) : (globalCaTargets.stock_out?.evening || Object.values(exportCaTargets).reduce((sum, t) => sum + (t?.evening || 0), 0));
    const caOutTarget = new Date().getHours() < 12 ? caOutMorning : (caOutEvening > 0 ? caOutEvening : caOutMorning);
    const caOutRemain = caOutTarget > 0 ? Math.max(0, caOutTarget - caOutResult) : exportCaData.length;
    const caOutRatio = caOutTarget > 0 ? ((caOutResult / caOutTarget) * 100).toFixed(2) : (caOutRemain === 0 ? '100.00' : '0.00');

    const caInResult = importCaHistory.length;
    const caInInSystem = importCaData.length + importCaHistory.length;
    const caInMorning = isUnitUser ? (importCaTargets[userUnit]?.morning || 0) : (globalCaTargets.stock_in?.morning || Object.values(importCaTargets).reduce((sum, t) => sum + (t?.morning || 0), 0));
    const caInEvening = isUnitUser ? (importCaTargets[userUnit]?.evening || 0) : (globalCaTargets.stock_in?.evening || Object.values(importCaTargets).reduce((sum, t) => sum + (t?.evening || 0), 0));
    const caInTarget = new Date().getHours() < 12 ? caInMorning : (caInEvening > 0 ? caInEvening : caInMorning);
    const caInRemain = caInTarget > 0 ? Math.max(0, caInTarget - caInResult) : importCaData.length;
    const caInRatio = caInTarget > 0 ? ((caInResult / caInTarget) * 100).toFixed(2) : (caInRemain === 0 ? '100.00' : '0.00');

    const restockInConfirmedCount = restockInData.filter(item => restockInConfirmed[item.id]).length;
    const restockInResultCount = restockInHistory.length + restockInConfirmedCount;
    const restockInInSystemCount = restockInData.length + restockInHistory.length;
    const restockInMorningTarget = isUnitUser ? (restockInTargets[userUnit]?.morning || 0) : (globalRestockTargets.restock_in?.morning || Object.values(restockInTargets).reduce((sum, t) => sum + (t?.morning || 0), 0));
    const restockInEveningTarget = isUnitUser ? (restockInTargets[userUnit]?.evening || 0) : (globalRestockTargets.restock_in?.evening || Object.values(restockInTargets).reduce((sum, t) => sum + (t?.evening || 0), 0));
    const restockInTargetVal = new Date().getHours() < 12 ? restockInMorningTarget : (restockInEveningTarget > 0 ? restockInEveningTarget : restockInMorningTarget);
    const restockInRemainVal = restockInTargetVal > 0 ? Math.max(0, restockInTargetVal - restockInResultCount) : (restockInData.length - restockInConfirmedCount);
    const restockInRatioVal = restockInTargetVal > 0 ? ((restockInResultCount / restockInTargetVal) * 100).toFixed(2) : (restockInRemainVal === 0 ? '100.00' : '0.00');

    const restockOutConfirmedCount = restockOutData.filter(item => restockOutConfirmed[item.id]).length;
    const restockOutResultCount = restockOutHistory.length + restockOutConfirmedCount;
    const restockOutInSystemCount = restockOutData.length + restockOutHistory.length;
    const restockOutMorningTarget = isUnitUser ? (restockOutTargets[userUnit]?.morning || 0) : (globalRestockTargets.restock_out?.morning || Object.values(restockOutTargets).reduce((sum, t) => sum + (t?.morning || 0), 0));
    const restockOutEveningTarget = isUnitUser ? (restockOutTargets[userUnit]?.evening || 0) : (globalRestockTargets.restock_out?.evening || Object.values(restockOutTargets).reduce((sum, t) => sum + (t?.evening || 0), 0));
    const restockOutTargetVal = new Date().getHours() < 12 ? restockOutMorningTarget : (restockOutEveningTarget > 0 ? restockOutEveningTarget : restockOutMorningTarget);
    const restockOutRemainVal = restockOutTargetVal > 0 ? Math.max(0, restockOutTargetVal - restockOutResultCount) : (restockOutData.length - restockOutConfirmedCount);
    const restockOutRatioVal = restockOutTargetVal > 0 ? ((restockOutResultCount / restockOutTargetVal) * 100).toFixed(2) : (restockOutRemainVal === 0 ? '100.00' : '0.00');

    const summaryData = [
      {
        'Module': 'CONFIRMED HAND OVER',
        'KPI Task': 'STOCKOUT YET CONFIRM',
        'Target Morning': m1Morning,
        'Target Evening': m1Evening,
        'Active Target': m1Target,
        'Result': m1Result,
        'Remaining': m1Remain,
        'Completion Rate': `${m1Ratio}%`,
        'In System': m1InSystem
      },
      {
        'Module': 'CONFIRMED HAND OVER',
        'KPI Task': 'NOT CREATE HAND OVER',
        'Target Morning': m2Morning,
        'Target Evening': m2Evening,
        'Active Target': m2Target,
        'Result': m2Result,
        'Remaining': m2Remain,
        'Completion Rate': `${m2Ratio}%`,
        'In System': m2InSystem
      },
      {
        'Module': 'CONFIRMED HAND OVER',
        'KPI Task': 'HAND OVER YET CONFIRM',
        'Target Morning': m3Morning,
        'Target Evening': m3Evening,
        'Active Target': m3Target,
        'Result': m3Result,
        'Remaining': m3Remain,
        'Completion Rate': `${m3Ratio}%`,
        'In System': m3InSystem
      },
      {
        'Module': 'SIGNED CA SYSTEM',
        'KPI Task': 'STOCK OUT IS SIGNING',
        'Target Morning': caOutMorning,
        'Target Evening': caOutEvening,
        'Active Target': caOutTarget,
        'Result': caOutResult,
        'Remaining': caOutRemain,
        'Completion Rate': `${caOutRatio}%`,
        'In System': caOutInSystem
      },
      {
        'Module': 'SIGNED CA SYSTEM',
        'KPI Task': 'STOCK IN IS SIGNING',
        'Target Morning': caInMorning,
        'Target Evening': caInEvening,
        'Active Target': caInTarget,
        'Result': caInResult,
        'Remaining': caInRemain,
        'Completion Rate': `${caInRatio}%`,
        'In System': caInInSystem
      },
      {
        'Module': 'RESTOCK IN / OUT',
        'KPI Task': 'RESTOCK IN',
        'Target Morning': restockInMorningTarget,
        'Target Evening': restockInEveningTarget,
        'Active Target': restockInTargetVal,
        'Result': restockInResultCount,
        'Remaining': restockInRemainVal,
        'Completion Rate': `${restockInRatioVal}%`,
        'In System': restockInInSystemCount
      },
      {
        'Module': 'RESTOCK IN / OUT',
        'KPI Task': 'RESTOCK OUT',
        'Target Morning': restockOutMorningTarget,
        'Target Evening': restockOutEveningTarget,
        'Active Target': restockOutTargetVal,
        'Result': restockOutResultCount,
        'Remaining': restockOutRemainVal,
        'Completion Rate': `${restockOutRatioVal}%`,
        'In System': restockOutInSystemCount
      }
    ];

    const handOverDetails = [];
    stockoutData.forEach(item => {
      handOverDetails.push({
        'Task Type': 'STOCKOUT YET CONFIRM',
        'Code / Id': item.exportNoteCode || item.id || '',
        'Unit': item.unit || '',
        'Warehouse': item.exportWarehouse || '',
        'Date': item.dateCreate || '',
        'Status': item.isCompleted ? 'Completed' : 'Pending'
      });
    });
    nocreateData.forEach(item => {
      handOverDetails.push({
        'Task Type': 'NOT CREATE HAND OVER',
        'Code / Id': item.exportNoteCode || item.id || '',
        'Unit': item.unit || '',
        'Warehouse': item.exportWarehouse || '',
        'Date': item.dateCreate || '',
        'Status': nocreateConfirmed[item.id] ? 'Confirmed' : (item.isCompleted ? 'Completed' : 'Pending')
      });
    });
    notconfirmedData.forEach(item => {
      handOverDetails.push({
        'Task Type': 'HAND OVER YET CONFIRM',
        'Code / Id': item.exportNoteCode || item.id || '',
        'Unit': item.unit || '',
        'Warehouse': item.exportWarehouse || '',
        'Date': item.dateCreate || '',
        'Status': notconfirmedConfirmed[item.id] ? 'Confirmed' : (item.isCompleted ? 'Completed' : 'Pending')
      });
    });

    const signedCaDetails = [];
    exportCaData.forEach(item => {
      signedCaDetails.push({
        'Type': 'STOCK OUT SIGNING',
        'Note Code': item.exportNoteCode || '',
        'Warehouse': item.exportWarehouse || '',
        'Unit': item.unit || extractUnit(item) || '',
        'Date Created': item.dateCreate || '',
        'Status CA': item.statusCA || ''
      });
    });
    importCaData.forEach(item => {
      signedCaDetails.push({
        'Type': 'STOCK IN SIGNING',
        'Receipt Code': item.codeReceipt || '',
        'Warehouse': item.warehouse || '',
        'Unit': item.unit || extractUnit(item) || '',
        'Date Created': item.date || '',
        'Status CA': item.statusCA || ''
      });
    });

    const restockDetails = [];
    restockInData.forEach(item => {
      restockDetails.push({
        'Type': 'RESTOCK IN',
        'Request Code': item.importRequestCode || '',
        'Unit': item.unit || getUnitFromRequestCode(item.importRequestCode) || '',
        'Date Created': item.dateCreate || '',
        'Status': restockInConfirmed[item.id] ? 'Confirmed' : (item.isCompleted ? 'Completed' : 'Pending')
      });
    });
    restockOutData.forEach(item => {
      restockDetails.push({
        'Type': 'RESTOCK OUT',
        'Request Code': item.requestExportCode || '',
        'Unit': item.unit || getUnitFromRequestCode(item.requestExportCode) || '',
        'Date Created': item.dateCreate || '',
        'Status': restockOutConfirmed[item.id] ? 'Confirmed' : (item.isCompleted ? 'Completed' : 'Pending')
      });
    });

    const wb = XLSX.utils.book_new();
    
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Main Summary');

    const wsHandOver = XLSX.utils.json_to_sheet(handOverDetails.length > 0 ? handOverDetails : [{'Info': 'No records available'}]);
    XLSX.utils.book_append_sheet(wb, wsHandOver, 'Hand Over');

    const wsSignedCa = XLSX.utils.json_to_sheet(signedCaDetails.length > 0 ? signedCaDetails : [{'Info': 'No records available'}]);
    XLSX.utils.book_append_sheet(wb, wsSignedCa, 'Signed CA');

    const wsRestock = XLSX.utils.json_to_sheet(restockDetails.length > 0 ? restockDetails : [{'Info': 'No records available'}]);
    XLSX.utils.book_append_sheet(wb, wsRestock, 'Restock');

    const fileName = `GIS_ALL_DASHBOARD_${isUnitUser ? userUnit : 'ADMIN'}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };


  return (
    <div className="w-64 h-full bg-white shadow-xl flex flex-col border-r border-gray-100">
      {/* ─── LOGO ─── */}
      <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center overflow-hidden shadow-lg shadow-blue-200/50">
            <img src="/gis_asset_logo.png" alt="GIS Logo" className="w-full h-full object-cover" style={{ transform: 'scale(1.3) translateY(-1px)' }} />
          </div>
          <div>
            <div className="text-xl font-bold text-gray-800 leading-none">
              GI<span className="text-blue-600">S</span>
            </div>
            <div className="text-[10px] text-gray-500 font-medium tracking-wider mt-0.5">
              ASSET MANAGEMENT
            </div>
          </div>
        </div>
      </div>
      
      {/* ─── NAVIGATION ─── */}
      <nav className="flex-1 p-4 overflow-y-auto scrollbar-thin">
        <div className="space-y-2">
          {menuItems.map((item) => (
            <div key={item.id}>
              {item.isGroup ? (
                <div>
                  {/* Group Header */}
                  <button
                    onClick={() => {
                      const toggleFn = getToggleFunction(item.id);
                      toggleFn();
                      onSelect(item.id);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-3 rounded-2xl transition-all duration-300 group ${
                      isGroupActive(item) || selected === item.id || isGroupOpen(item.id)
                        ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white shadow-md shadow-blue-500/25'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 hover:shadow-xs'
                    }`}
                  >
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md transition-colors flex-shrink-0 ${
                      isGroupActive(item) || selected === item.id || isGroupOpen(item.id)
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700'
                    }`}>
                      {item.number}
                    </span>
                    <span className="text-lg flex-shrink-0">{item.icon}</span>
                    <span className="text-xs font-extrabold flex-1 text-left truncate tracking-tight uppercase">
                      {item.label}
                    </span>
                    <span className={`transition-transform duration-300 text-[10px] flex-shrink-0 ${isGroupOpen(item.id) ? 'rotate-180' : ''}`}>
                      ▼
                    </span>
                    {(isGroupActive(item) || selected === item.id || isGroupOpen(item.id)) && (
                      <span className="w-2 h-2 rounded-full bg-white animate-pulse flex-shrink-0"></span>
                    )}
                  </button>
                  
                  {/* Group Children */}
                  <div className={`ml-4 pl-2 border-l-2 border-slate-100 space-y-1.5 overflow-hidden transition-all duration-300 ${
                    isGroupOpen(item.id) ? 'max-h-[500px] opacity-100 mt-2' : 'max-h-0 opacity-0'
                  }`}>
                    {item.children.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => {
                          onSelect(child.id);
                          if (item.id === 'stockout_group') {
                            setIsStockoutOpen(true);
                          } else if (item.id === 'signed_ca_group') {
                            setIsSignedCAOpen(true);
                          } else if (item.id === 'restock_group') {
                            setIsRestockOpen(true);
                          }
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-200 group ${
                          selected === child.id
                            ? 'bg-indigo-50/90 text-indigo-700 font-extrabold border-l-4 border-indigo-600 shadow-xs'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        <span className={`text-[9.5px] font-mono font-bold transition-colors flex-shrink-0 ${
                          selected === child.id ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'
                        }`}>
                          {child.number}
                        </span>
                        <span className="text-base flex-shrink-0">{child.icon}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold truncate block">
                            {child.label}
                          </span>
                          {child.desc && (
                            <span className="text-[9px] text-slate-400 truncate block font-medium">
                              {child.desc}
                            </span>
                          )}
                        </div>
                        {selected === child.id && (
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 flex-shrink-0"></span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* Main Menu Item */
                <button
                  onClick={() => onSelect(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-3 rounded-2xl transition-all duration-300 group ${
                    selected === item.id
                      ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white shadow-md shadow-blue-500/25'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 hover:shadow-xs'
                  }`}
                >
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md transition-colors flex-shrink-0 ${
                    selected === item.id
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700'
                  }`}>
                    {item.number}
                  </span>
                  <span className="text-lg flex-shrink-0">{item.icon}</span>
                  <span className="text-xs font-extrabold flex-1 text-left truncate tracking-tight uppercase">
                    {item.label}
                  </span>
                  {selected === item.id && (
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse flex-shrink-0"></span>
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      </nav>

      {/* ─── EXPORT ALL DASHBOARD BUTTON ─── */}
      <div className="px-4 mb-3">
        <button
          onClick={handleExportAllExcel}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white font-extrabold text-xs shadow-md shadow-emerald-600/20 active:scale-[0.98] transition-all uppercase tracking-wider cursor-pointer"
        >
          📊 Export All Dashboard (Excel)
        </button>
      </div>

      {/* ─── USER PROFILE BLOCK ─── */}
      {user && (
        <div className="p-4 mx-3 mb-2 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col gap-2.5 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-lg shadow-inner">
              {user.role === 'admin' ? '🔑' : '🏢'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-black text-gray-800 truncate leading-none">
                {user.username}
              </div>
              <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1">
                {user.role === 'admin' ? 'Administrator' : `Unit: ${user.unit}`}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('gis_logged_in_user');
              if (onLogout) onLogout();
            }}
            className="w-full py-2 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-100/60 text-[10px] font-bold text-rose-600 transition-colors uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
          >
            🚪 ចាកចេញ (Logout)
          </button>
        </div>
      )}

      {/* ─── FOOTER ─── */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
              <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75"></div>
            </div>
            <span className="text-[10px] font-bold text-slate-700">System Online</span>
          </div>
          <span className="text-[9px] text-slate-400 font-bold bg-white px-2 py-0.5 rounded-full border border-slate-200">v1.0.0</span>
        </div>
        <div className="mt-1.5 text-[8px] text-slate-400 font-medium">
          © 2026 KPI Pro Management
        </div>
      </div>

      <style>{`
        .scrollbar-thin::-webkit-scrollbar {
          width: 3px;
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
        .border-l-3 {
          border-left-width: 3px;
        }
      `}</style>
    </div>
  );
};

export default Sidebar;