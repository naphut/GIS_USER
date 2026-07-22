import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import html2canvas from 'html2canvas';
import Navbar from '../../common/Navbar';
import Sidebar from '../../common/Sidebar';
import { 
  sendToTelegram, 
  sendToAllTelegram, 
  sendPhotoToTelegram,
  sendDocumentToTelegram,
  generateStockoutExcelBlob,
  getAllUnits,
  getConfiguredUnits,
  hasGroupId,
  hasToken,
  getSavedTemplates,
  saveTemplate,
  deleteTemplate,
  cleanWarehouseName,
  // eslint-disable-next-line no-unused-vars
  getTeamFromRecipient,
  getUnitFromTeam
} from '../../../services/telegramBot';
import NO_CREATE_HAND_OVER from '../../../Page/Stockout_yet/NO_CREATE_HAND_OVER';
import { loadFromDb } from '../../../services/dbStore';
import STOCKOUT_YET_CONFIRM from '../../../Page/Stockout_yet/STOCKOUT_YET_CONFIRM';
import STOCK_OUT_NOTE_CONFIRMED from '../../../Page/Stockout_yet/stock_out_note_confirmed';

const Dashboad_Stockout = ({ isEmbedded = false, onNavigate, user }) => {
  const [selectedComponent, setSelectedComponent] = useState('dashboard');
  const [syncVersion, setSyncVersion] = useState(0);

  // Sync all dashboard data from database on mount
  useEffect(() => {
    const syncAllData = async () => {
      const keys = [
        'kpi_stockout_data', 'kpi_stockout_completionHistory', 'kpi_stockout_targets',
        'kpi_nocreate_data', 'kpi_nocreate_completionHistory', 'kpi_nocreate_targets', 'kpi_nocreate_confirmedStatus',
        'kpi_notconfirmed_data', 'kpi_notconfirmed_completionHistory', 'kpi_notconfirmed_targets', 'kpi_notconfirmed_confirmedStatus'
      ];
      await Promise.all(keys.map(key => loadFromDb(key)));
      setSyncVersion(prev => prev + 1);
    };
    syncAllData();
  }, []);

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

  const isUnitUser = user && user.role === 'unit' && user.unit;
  const userUnit = user?.unit;

  const abortControllerRef = useRef(null);
  const [isSending, setIsSending] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState(isUnitUser ? userUnit : 'BAT');
  const [showUnitSelector, setShowUnitSelector] = useState(false);
  const [sendProgress, setSendProgress] = useState(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [sendResults, setSendResults] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [screenshotUnit, setScreenshotUnit] = useState(null);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [activeM1Items, setActiveM1Items] = useState([]);
  const [activeM2Items, setActiveM2Items] = useState([]);
  const [activeM3Items, setActiveM3Items] = useState([]);
  // eslint-disable-next-line no-unused-vars
  const [screenshotPartText, setScreenshotPartText] = useState("");
  // eslint-disable-next-line no-unused-vars
  const [screenshotTitle, setScreenshotTitle] = useState("CONFIRMED HAND OVER REPORT");
  const [summaryImageMode, setSummaryImageMode] = useState(false);
  const [isSelectingForSummary, setIsSelectingForSummary] = useState(false);
  const [openBatchDropdown, setOpenBatchDropdown] = useState(false);
  const [openSingleDropdown, setOpenSingleDropdown] = useState(false);

  // Sync selectedUnit if user changes
  useEffect(() => {
    if (isUnitUser) {
      setSelectedUnit(userUnit);
    }
  }, [userUnit, isUnitUser]);

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const getKpis = () => {
    const allUnitsList = isUnitUser 
      ? [userUnit]
      : [
          'BAN', 'BAT', 'CHA', 'CHH', 'KAM', 'KAN', 'KANZ1', 'KOH', 'KRA',
          'MON', 'ODD', 'PNP', 'PNPZ1', 'PNPZ2', 'PRE', 'PRH', 'PUR', 'ROT',
          'SIE', 'SIH', 'SPE', 'STU', 'SVA', 'TAK', 'THO'
        ];

    // Function to get data from localStorage
    const getStorageData = (key) => {
      try {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : null;
      } catch (e) {
        return null;
      }
    };

    // Module 1: STOCKOUT_YET_CONFIRM
    let m1Target = 0, m1Result = 0, m1Remain = 0;
    let m1TargetMorning = 0, m1TargetEvening = 0, m1InSystem = 0;
    try {
      const data = getStorageData('kpi_stockout_data') || [];
      const targets = getStorageData('kpi_stockout_targets') || {};
      const completionHistory = getStorageData('kpi_stockout_completionHistory') || [];
      
      const unitGroups = {};
      data.forEach(item => {
        const unit = item.unit;
        if (unit !== 'OTHER') {
          unitGroups[unit] = (unitGroups[unit] || 0) + 1;
        }
      });
      m1InSystem = data.filter(item => item.unit !== 'OTHER').length;
      
      const completedByUnit = {};
      completionHistory.forEach(c => {
        if (c.unit !== 'UNKNOWN') {
          completedByUnit[c.unit] = (completedByUnit[c.unit] || 0) + 1;
        }
      });

      allUnitsList.forEach(unit => {
        const morning = targets[unit]?.morning || 0;
        const evening = targets[unit]?.evening || 0;
        const target = evening > 0 ? evening : morning;
        const currentCount = unitGroups[unit] || 0;
        const result = completedByUnit[unit] || 0;
        const remain = target > 0 ? Math.max(0, target - result) : currentCount;
        
        m1Target += target;
        m1Result += result;
        m1Remain += remain;
        m1TargetMorning += morning;
        m1TargetEvening += evening;
      });
    } catch (e) {
      console.error('Error getting stockout data:', e);
    }

    // Module 2: NO_CREATE_HAND_OVER
    let m2Target = 0, m2Result = 0, m2Remain = 0;
    let m2TargetMorning = 0, m2TargetEvening = 0, m2InSystem = 0;
    try {
      const data = getStorageData('kpi_nocreate_data') || [];
      const targets = getStorageData('kpi_nocreate_targets') || {};
      const completionHistory = getStorageData('kpi_nocreate_completionHistory') || [];
      const confirmedStatus = getStorageData('kpi_nocreate_confirmedStatus') || {};

      const unitGroups = {};
      data.forEach(item => {
        const unit = item.unit;
        if (unit !== 'OTHER') {
          unitGroups[unit] = (unitGroups[unit] || 0) + 1;
        }
      });
      m2InSystem = data.filter(item => item.unit !== 'OTHER').length;
      
      const completedByUnit = {};
      completionHistory.forEach(c => {
        if (c.unit !== 'UNKNOWN') {
          completedByUnit[c.unit] = (completedByUnit[c.unit] || 0) + 1;
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

      allUnitsList.forEach(unit => {
        const target = targets[unit]?.target || 0;
        const currentCount = unitGroups[unit] || 0;
        const result = completedByUnit[unit] || 0;
        const remain = target > 0 ? Math.max(0, target - result) : currentCount;
        
        m2Target += target;
        m2Result += result;
        m2Remain += remain;
        m2TargetMorning += target;
        m2TargetEvening += target;
      });
    } catch (e) {
      console.error('Error getting nocreate data:', e);
    }

    // Module 3: STOCK_OUT_NOTE_CONFIRMED
    let m3Target = 0, m3Result = 0, m3Remain = 0;
    let m3TargetMorning = 0, m3TargetEvening = 0, m3InSystem = 0;
    try {
      const data = getStorageData('kpi_notconfirmed_data') || [];
      const targets = getStorageData('kpi_notconfirmed_targets') || {};
      const completionHistory = getStorageData('kpi_notconfirmed_completionHistory') || [];
      const confirmedStatus = getStorageData('kpi_notconfirmed_confirmedStatus') || {};

      const unitGroups = {};
      data.forEach(item => {
        const unit = item.unit;
        if (unit !== 'OTHER') {
          unitGroups[unit] = (unitGroups[unit] || 0) + 1;
        }
      });
      m3InSystem = data.filter(item => item.unit !== 'OTHER').length;
      
      const completedByUnit = {};
      completionHistory.forEach(c => {
        if (c.unit !== 'UNKNOWN') {
          completedByUnit[c.unit] = (completedByUnit[c.unit] || 0) + 1;
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

      allUnitsList.forEach(unit => {
        const target = targets[unit]?.target || 0;
        const currentCount = unitGroups[unit] || 0;
        const result = completedByUnit[unit] || 0;
        const remain = target > 0 ? Math.max(0, target - result) : currentCount;
        
        m3Target += target;
        m3Result += result;
        m3Remain += remain;
        m3TargetMorning += target;
        m3TargetEvening += target;
      });
    } catch (e) {
      console.error('Error getting notconfirmed data:', e);
    }

    return [
      {
        id: 1,
        task: 'STOCKOUT YET CONFIRM',
        target: m1Target,
        targetMorning: m1TargetMorning,
        targetEvening: m1TargetEvening,
        remain: m1Remain,
        result: m1Result,
        ratio: m1Target > 0 ? ((m1Result / m1Target) * 100).toFixed(2) + '%' : (m1Remain === 0 && m1Result === 0 ? '100.00%' : '0.00%'),
        inSystem: m1InSystem,
        component: 'STOCKOUT_YET_CONFIRM',
        color: 'from-blue-500 to-blue-600',
        icon: '📦',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200'
      },
      {
        id: 2,
        task: 'NO CREATE HAND OVER',
        target: m2Target,
        targetMorning: m2TargetMorning,
        targetEvening: m2TargetEvening,
        remain: m2Remain,
        result: m2Result,
        ratio: m2Target > 0 ? ((m2Result / m2Target) * 100).toFixed(2) + '%' : (m2Remain === 0 && m2Result === 0 ? '100.00%' : '0.00%'),
        inSystem: m2InSystem,
        component: 'NO_CREATE_HAND_OVER',
        color: 'from-emerald-500 to-emerald-600',
        icon: '📝',
        bgColor: 'bg-emerald-50',
        borderColor: 'border-emerald-200'
      },
      {
        id: 3,
        task: 'STOCK OUT NOTE - NOT CONFIRMED',
        target: m3Target,
        targetMorning: m3TargetMorning,
        targetEvening: m3TargetEvening,
        remain: m3Remain,
        result: m3Result,
        ratio: m3Target > 0 ? ((m3Result / m3Target) * 100).toFixed(2) + '%' : (m3Remain === 0 && m3Result === 0 ? '100.00%' : '0.00%'),
        inSystem: m3InSystem,
        component: 'STOCK_OUT_NOTE_CONFIRMED',
        color: 'from-purple-500 to-purple-600',
        icon: '⚠️',
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-200'
      }
    ];
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kpiData = useMemo(() => getKpis(), [selectedComponent, syncVersion]);

  // Load configured units on mount
  useEffect(() => {
    const units = getConfiguredUnits();
    console.log('Configured units with group IDs:', units);
  }, []);

  const allUnits = getAllUnits();

  // Calculate totals
  const totals = useMemo(() => {
    const target = kpiData.reduce((sum, item) => sum + item.target, 0);
    const targetMorning = kpiData.reduce((sum, item) => sum + item.targetMorning, 0);
    const targetEvening = kpiData.reduce((sum, item) => sum + item.targetEvening, 0);
    const result = kpiData.reduce((sum, item) => sum + item.result, 0);
    const remain = kpiData.reduce((sum, item) => sum + item.remain, 0);
    const inSystem = kpiData.reduce((sum, item) => sum + item.inSystem, 0);
    const ratio = target > 0 ? ((result / target) * 100).toFixed(2) : '0.00';
    return { target, targetMorning, targetEvening, remain, result, inSystem, ratio };
  }, [kpiData]);

  // Get data from all components
  const getReportData = () => {
    const getItemUnit1 = (item) => {
      const rawTeam = (item.team && item.team !== '-') ? item.team : (item.groupReceiver && item.groupReceiver !== '-' ? item.groupReceiver : (item.stockReceiver || '-'));
      const cleanTeam = getTeamFromRecipient(rawTeam);
      const teamUnit = getUnitFromTeam(cleanTeam);
      if (teamUnit) return teamUnit;
      return item.unit || 'OTHER';
    };

    const getItemUnit2 = (item) => {
      const rawTeam = (item.team && item.team !== '-') ? item.team : (item.recipient || '-');
      const cleanTeam = getTeamFromRecipient(rawTeam);
      const teamUnit = getUnitFromTeam(cleanTeam);
      if (teamUnit) return teamUnit;
      return item.unit || 'OTHER';
    };

    const getItemUnit3 = (item) => {
      const rawTeam = (item.team && item.team !== '-') ? item.team : (item.unitConfirm || '-');
      const cleanTeam = getTeamFromRecipient(rawTeam);
      const teamUnit = getUnitFromTeam(cleanTeam);
      if (teamUnit) return teamUnit;
      return item.unit || 'OTHER';
    };

    const getStockoutItems = (unitFilter = null) => {
      const data = JSON.parse(localStorage.getItem('kpi_stockout_data') || '[]');
      const completionHistory = JSON.parse(localStorage.getItem('kpi_stockout_completionHistory') || '[]');
      const remaining = data.filter(item => !completionHistory.some(c => c.exportNo === item.exportNo || c.code === item.exportNo));
      const enriched = remaining.map(item => {
        const teamRaw = item.team || item.groupReceiver || item.stockReceiver || item.warehouse || '';
        const teamVal = getTeamFromRecipient(teamRaw);
        return { ...item, team: teamVal };
      });
      return unitFilter ? enriched.filter(item => getItemUnit1(item) === unitFilter) : enriched;
    };

    const getNoCreateItems = (unitFilter = null) => {
      const data = JSON.parse(localStorage.getItem('kpi_nocreate_data') || '[]');
      const completionHistory = JSON.parse(localStorage.getItem('kpi_nocreate_completionHistory') || '[]');
      const confirmedStatus = JSON.parse(localStorage.getItem('kpi_nocreate_confirmedStatus') || '{}');
      const remaining = data.filter(item => !completionHistory.some(c => c.code === item.code) && !confirmedStatus[item.code]);
      const enriched = remaining.map(item => {
        const teamRaw = item.team || item.recipient || item.warehouse || '';
        const teamVal = getTeamFromRecipient(teamRaw);
        return { ...item, team: teamVal };
      });
      return unitFilter ? enriched.filter(item => getItemUnit2(item) === unitFilter) : enriched;
    };

    const getNotConfirmedItems = (unitFilter = null) => {
      const data = JSON.parse(localStorage.getItem('kpi_notconfirmed_data') || '[]');
      const completionHistory = JSON.parse(localStorage.getItem('kpi_notconfirmed_completionHistory') || '[]');
      const confirmedStatus = JSON.parse(localStorage.getItem('kpi_notconfirmed_confirmedStatus') || '{}');
      const remaining = data.filter(item => !completionHistory.some(c => c.code === item.code) && !confirmedStatus[item.code]);
      const enriched = remaining.map(item => {
        const teamRaw = item.team || item.unitConfirm || item.handoverUnit || '';
        const teamVal = getTeamFromRecipient(teamRaw);
        return { ...item, team: teamVal };
      });
      return unitFilter ? enriched.filter(item => getItemUnit3(item) === unitFilter) : enriched;
    };

    // Calculate unit-specific details
    const unitsMap = {};
    
    const stockoutTargets = JSON.parse(localStorage.getItem('kpi_stockout_targets') || '{}');
    const nocreateTargets = JSON.parse(localStorage.getItem('kpi_nocreate_targets') || '{}');
    const notconfirmedTargets = JSON.parse(localStorage.getItem('kpi_notconfirmed_targets') || '{}');

    const stockoutData = JSON.parse(localStorage.getItem('kpi_stockout_data') || '[]');
    const nocreateData = JSON.parse(localStorage.getItem('kpi_nocreate_data') || '[]');
    const notconfirmedData = JSON.parse(localStorage.getItem('kpi_notconfirmed_data') || '[]');

    const stockoutHistory = JSON.parse(localStorage.getItem('kpi_stockout_completionHistory') || '[]');
    const nocreateHistory = JSON.parse(localStorage.getItem('kpi_nocreate_completionHistory') || '[]');
    const notconfirmedHistory = JSON.parse(localStorage.getItem('kpi_notconfirmed_completionHistory') || '[]');

    const nocreateConfirmed = JSON.parse(localStorage.getItem('kpi_nocreate_confirmedStatus') || '{}');
    const notconfirmedConfirmed = JSON.parse(localStorage.getItem('kpi_notconfirmed_confirmedStatus') || '{}');

    const isMorning = new Date().getHours() < 12;

    allUnits.forEach(unit => {
      // Stockout stats
      const m1Morning = stockoutTargets[unit]?.morning || 0;
      const m1Evening = stockoutTargets[unit]?.evening || 0;
      const m1Target = isMorning ? m1Morning : (m1Evening > 0 ? m1Evening : m1Morning);
      const m1Count = stockoutData.filter(i => getItemUnit1(i) === unit).length;
      const m1Result = stockoutHistory.filter(c => c.unit === unit || (c.team && getUnitFromTeam(c.team) === unit)).length;
      const m1Remain = m1Target > 0 ? Math.max(0, m1Target - m1Result) : m1Count;

      // Nocreate stats
      const m2Morning = nocreateTargets[unit]?.morning || 0;
      const m2Evening = nocreateTargets[unit]?.evening || 0;
      const m2Target = isMorning ? m2Morning : (m2Evening > 0 ? m2Evening : m2Morning);
      const m2Count = nocreateData.filter(i => getItemUnit2(i) === unit).length;
      const m2Result = nocreateHistory.filter(c => c.unit === unit || (c.team && getUnitFromTeam(c.team) === unit)).length + 
                       Object.entries(nocreateConfirmed).filter(([code, confirmed]) => {
                         if (!confirmed) return false;
                         const item = nocreateData.find(d => d.code === code);
                         return item && getItemUnit2(item) === unit;
                       }).length;
      const m2Remain = m2Target > 0 ? Math.max(0, m2Target - m2Result) : m2Count;

      // Notconfirmed stats
      const m3Morning = notconfirmedTargets[unit]?.morning || 0;
      const m3Evening = notconfirmedTargets[unit]?.evening || 0;
      const m3Target = isMorning ? m3Morning : (m3Evening > 0 ? m3Evening : m3Morning);
      const m3Count = notconfirmedData.filter(i => getItemUnit3(i) === unit).length;
      const m3Result = notconfirmedHistory.filter(c => c.unit === unit || (c.team && getUnitFromTeam(c.team) === unit)).length + 
                       Object.entries(notconfirmedConfirmed).filter(([code, confirmed]) => {
                         if (!confirmed) return false;
                         const item = notconfirmedData.find(d => d.code === code);
                         return item && getItemUnit3(item) === unit;
                       }).length;
      const m3Remain = m3Target > 0 ? Math.max(0, m3Target - m3Result) : m3Count;

      const unitTarget = m1Target + m2Target + m3Target;
      const unitRemain = m1Remain + m2Remain + m3Remain;
      const unitResult = m1Result + m2Result + m3Result;
      const unitRatio = unitTarget > 0 ? parseFloat(((unitResult / unitTarget) * 100).toFixed(2)) : (unitRemain === 0 && unitResult === 0 ? 100 : 0);

      unitsMap[unit] = {
        target: unitTarget,
        remain: unitRemain,
        result: unitResult,
        ratio: unitRatio,
        targetMorning: m1Morning,
        targetEvening: m1Evening,
        inSystem: m1Count + m2Count + m3Count,
        stockoutYetConfirm: getStockoutItems(unit),
        noCreateHandOver: getNoCreateItems(unit),
        stockOutNoteNotConfirmed: getNotConfirmedItems(unit),
        
        // Also map to standard telegram bot keys:
        m1Target: m1Target,
        m1Morning: m1Morning,
        m1Evening: m1Evening,
        m1Result: m1Result,
        m1Remain: m1Remain,
        m1Ratio: m1Target > 0 ? parseFloat(((m1Result / m1Target) * 100).toFixed(2)) : (m1Remain === 0 && m1Result === 0 ? 100 : 0),
        m1Items: getStockoutItems(unit),
        
        m2Target: m2Target,
        m2Result: m2Result,
        m2Remain: m2Remain,
        m2Ratio: m2Target > 0 ? parseFloat(((m2Result / m2Target) * 100).toFixed(2)) : (m2Remain === 0 && m2Result === 0 ? 100 : 0),
        m2Items: getNoCreateItems(unit),
        
        m3Target: m3Target,
        m3Result: m3Result,
        m3Remain: m3Remain,
        m3Ratio: m3Target > 0 ? parseFloat(((m3Result / m3Target) * 100).toFixed(2)) : (m3Remain === 0 && m3Result === 0 ? 100 : 0),
        m3Items: getNotConfirmedItems(unit),
        
        totalResult: unitResult,
        totalRemain: unitRemain,
        totalRatio: unitRatio,
        totalInSystem: m1Count + m2Count + m3Count
      };
    });

    return {
      totalTarget: totals.target,
      totalRemain: totals.remain,
      totalResult: totals.result,
      totalRatio: parseFloat(totals.ratio),
      stockoutYetConfirm: getStockoutItems(),
      noCreateHandOver: getNoCreateItems(),
      stockOutNoteNotConfirmed: getNotConfirmedItems(),
      units: unitsMap
    };
  };

  // Send to ALL units
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
      
      const result = await sendToAllTelegram(data, (progress) => {
        setSendProgress(progress);
      }, customNote, abortControllerRef.current.signal);
      
      setSendResults(result.summary);
      
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


  // eslint-disable-next-line no-unused-vars
  const getUnitTotals = (unit) => {
    const data = getReportData();
    return data.units[unit] || {
      targetMorning: 0,
      targetEvening: 0,
      result: 0,
      remain: 0,
      ratio: '0.00',
      inSystem: 0
    };
  };

  const getUnitM1Items = (unit) => {
    const data = getReportData();
    return data.units[unit]?.m1Items || [];
  };

  const getUnitM2Items = (unit) => {
    const data = getReportData();
    return data.units[unit]?.m2Items || [];
  };

  const getUnitM3Items = (unit) => {
    const data = getReportData();
    return data.units[unit]?.m3Items || [];
  };

  const renderScreenshotReport = () => {
    if (!screenshotUnit) return null;
    
    const m1Items = activeM1Items;
    const m2Items = activeM2Items;
    const m3Items = activeM3Items;
    
    const sortedM1 = m1Items;
    const sortedM2 = m2Items;
    const sortedM3 = m3Items;
    
    // Color-coded delay badges (High-impact professional design)
    const getDelayBadge = (days, maxKpiDays = 3) => {
      const num = parseInt(days) || 0;
      if (num > maxKpiDays) {
        return (
          <span className="bg-red-600 text-white border border-red-700 font-black px-2.5 py-0.5 rounded-md text-[9.5px] inline-flex items-center gap-1 shadow-xs uppercase tracking-wider">
            🚨 +{num}d
          </span>
        );
      }
      return (
        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2 py-0.5 rounded-md text-[9px] inline-flex items-center gap-0.5">
          ✅ {num}d
        </span>
      );
    };

    return (
      <div 
        id="telegram-screenshot-report" 
        style={{ 
          position: 'absolute', 
          left: '0', 
          top: '0', 
          zIndex: -9999,
          pointerEvents: 'none',
          width: 'max-content',
          minWidth: '1150px', 
          minHeight: '500px',
          background: '#f8fafc', 
          padding: '24px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
        }}
      >

        {/* Module 1 Table */}
        {m1Items.length > 0 && (
          <div className="bg-white border border-gray-200/60 rounded-3xl p-5 shadow-sm mb-5">
            <h3 className="text-sm font-black text-gray-800 flex items-center justify-between pb-3 border-b border-gray-100 mb-3.5">
              <span className="flex items-center gap-2 text-indigo-900 uppercase font-black tracking-tight text-base">
                📦 TEAM STEP 1 <span className="text-xs text-slate-500 font-bold capitalize">(Stock out not Confirm goods)</span>
              </span>
              <span className="text-blue-800 font-extrabold text-xs bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                📋 {m1Items.length} Items
              </span>
            </h3>
            <div className="border border-slate-200/80 rounded-xl shadow-xs bg-white">
              <table className="min-w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-800 text-white text-[10px] font-black border-b-2 border-indigo-900">
                    <th className="border-r border-indigo-600/50 px-2.5 py-2 text-center font-extrabold uppercase">#</th>
                    <th className="border-r border-indigo-600/50 px-2.5 py-2 font-black uppercase">Warehouse Stock out</th>
                    <th className="border-r border-indigo-600/50 px-2.5 py-2 font-black uppercase">Export No</th>
                    <th className="border-r border-indigo-600/50 px-2.5 py-2 text-center font-black uppercase">Date</th>
                    <th className="border-r border-indigo-600/50 px-2.5 py-2 font-black uppercase">Stock Receiver</th>
                    <th className="border-r border-indigo-600/50 px-2.5 py-2 font-black uppercase">Group Receiver</th>
                    <th className="border-r border-indigo-600/50 px-2.5 py-2 font-black uppercase">Construction</th>
                    <th className="border-r border-indigo-600/50 px-2.5 py-2 text-center font-black uppercase">Unit</th>
                    <th className="border-r border-indigo-600/50 px-2.5 py-2 text-center font-black uppercase">Days</th>
                    <th className="px-2.5 py-2 font-black uppercase">TEAM</th>
                  </tr>
                </thead>
                <tbody className="text-[9.5px] font-medium divide-y divide-slate-100">
                  {sortedM1.map((item, index) => {
                    const isOverdue = (parseInt(item.daysDiff) || 0) > 4;
                    return (
                      <tr key={index} className={`transition-colors whitespace-nowrap ${isOverdue ? 'bg-red-50/90 text-red-950 font-semibold border-l-4 border-l-red-600' : 'hover:bg-slate-50/80 odd:bg-white even:bg-slate-50/40 text-slate-800'}`}>
                        <td className="border-r border-slate-100 px-2 py-1.5 text-center font-extrabold text-slate-500">{index + 1}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-800 font-mono whitespace-nowrap">{item.exportCode || '-'}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-black text-slate-900 tracking-tight font-mono whitespace-nowrap">{item.exportNo}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-700 font-mono text-center whitespace-nowrap">{item.realExport || '-'}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-800 whitespace-nowrap">{cleanWarehouseName(item.stockReceiver || '-')}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-800 whitespace-nowrap">{cleanWarehouseName(item.groupReceiver || '-')}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 text-slate-700 font-bold font-mono text-[9px] whitespace-nowrap">{item.constructionReceiver || '-'}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 text-center font-extrabold">
                          <span className="bg-indigo-50 text-indigo-800 px-1 rounded border border-indigo-100 text-[8.5px] inline-block font-black">{item.unit || '-'}</span>
                        </td>
                        <td className="border-r border-slate-100 px-2 py-1.5 text-center font-extrabold">{getDelayBadge(item.daysDiff, 4)}</td>
                        <td className="px-2 py-1.5 font-black text-indigo-950 font-mono text-[9.5px] whitespace-nowrap">{item.team || getTeamFromRecipient(item.groupReceiver || item.stockReceiver || '-')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Module 2 Table */}
        {m2Items.length > 0 && (
          <div className="bg-white border border-gray-200/60 rounded-3xl p-5 shadow-sm mb-5">
            <h3 className="text-sm font-black text-gray-800 flex items-center justify-between pb-3 border-b border-gray-100 mb-3.5">
              <span className="flex items-center gap-2 text-amber-900 uppercase font-black tracking-tight text-base">
                📝 ASSET STEP :2 <span className="text-xs text-slate-500 font-bold capitalize">(Stock out not create hand over)</span>
              </span>
              <span className="text-amber-800 font-extrabold text-xs bg-amber-50 px-3 py-1 rounded-full border border-amber-100">
                📋 {m2Items.length} Items
              </span>
            </h3>
            <div className="border border-slate-200/80 rounded-xl shadow-xs bg-white">
              <table className="min-w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-gradient-to-r from-amber-700 via-orange-700 to-slate-800 text-white text-[10px] font-black border-b-2 border-amber-900">
                    <th className="border-r border-amber-600/50 px-2.5 py-2 text-center font-extrabold uppercase">#</th>
                    <th className="border-r border-amber-600/50 px-2.5 py-2 font-black uppercase">Code of stock-out note</th>
                    <th className="border-r border-amber-600/50 px-2.5 py-2 font-black uppercase">Warehouse</th>
                    <th className="border-r border-amber-600/50 px-2.5 py-2 font-black uppercase">Recipient</th>
                    <th className="border-r border-amber-600/50 px-2.5 py-2 font-black uppercase">Creator</th>
                    <th className="border-r border-amber-600/50 px-2.5 py-2 text-center font-black uppercase">Creating date</th>
                    <th className="border-r border-amber-600/50 px-2.5 py-2 font-black uppercase">TEAM</th>
                    <th className="border-r border-amber-600/50 px-2.5 py-2 text-center font-black uppercase">Unit</th>
                    <th className="border-r border-amber-600/50 px-2.5 py-2 text-center font-black uppercase">Days</th>
                    <th className="px-2.5 py-2 text-center font-black uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="text-[9.5px] font-medium divide-y divide-slate-100">
                  {sortedM2.map((item, index) => {
                    const isOverdue = (parseInt(item.daysDiff) || 0) > 3;
                    return (
                      <tr key={index} className={`transition-colors whitespace-nowrap ${isOverdue ? 'bg-red-50/90 text-red-950 font-semibold border-l-4 border-l-red-600' : 'hover:bg-slate-50/80 odd:bg-white even:bg-slate-50/40 text-slate-800'}`}>
                        <td className="border-r border-slate-100 px-2 py-1.5 text-center font-extrabold text-slate-500">{index + 1}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-black text-slate-900 tracking-tight font-mono whitespace-nowrap">{item.code}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-800 whitespace-nowrap">{cleanWarehouseName(item.warehouse || '-')}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-800 whitespace-nowrap">{cleanWarehouseName(item.recipient || '-')}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-700 whitespace-nowrap">{item.creator || '-'}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-700 font-mono text-center whitespace-nowrap">{item.date || '-'}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-black text-indigo-950 font-mono text-[9.5px] whitespace-nowrap">{item.team || getTeamFromRecipient(item.recipient || item.warehouse || '-')}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 text-center font-extrabold">
                          <span className="bg-indigo-50 text-indigo-800 px-1 rounded border border-indigo-100 text-[8.5px] inline-block font-black">{item.unit || '-'}</span>
                        </td>
                        <td className="border-r border-slate-100 px-2 py-1.5 text-center font-extrabold">{getDelayBadge(item.daysDiff, 3)}</td>
                        <td className="px-2 py-1.5 text-center whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-extrabold ${item.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>{item.status || 'Pending'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Module 3 Table */}
        {m3Items.length > 0 && (
          <div className="bg-white border border-gray-200/60 rounded-3xl p-5 shadow-sm">
            <h3 className="text-sm font-black text-gray-800 flex items-center justify-between pb-3 border-b border-gray-100 mb-3.5">
              <span className="flex items-center gap-2 text-purple-900 uppercase font-black tracking-tight text-base">
                ⚠️ TEAM STEP 3 <span className="text-xs text-slate-500 font-bold capitalize">(Hand over not Confirmed)</span>
              </span>
              <span className="text-purple-800 font-extrabold text-xs bg-purple-50 px-3 py-1 rounded-full border border-purple-100">
                📋 {m3Items.length} Items
              </span>
            </h3>
            <div className="border border-slate-200/80 rounded-xl shadow-xs bg-white">
              <table className="min-w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-gradient-to-r from-purple-800 via-rose-800 to-slate-900 text-white text-[10px] font-black border-b-2 border-purple-950">
                    <th className="border-r border-purple-600/50 px-2.5 py-2 text-center font-extrabold uppercase">#</th>
                    <th className="border-r border-purple-600/50 px-2.5 py-2 font-black uppercase">Code of handover minutes</th>
                    <th className="border-r border-purple-600/50 px-2.5 py-2 font-black uppercase">Type of handover</th>
                    <th className="border-r border-purple-600/50 px-2.5 py-2 font-black uppercase">Handover unit</th>
                    <th className="border-r border-purple-600/50 px-2.5 py-2 font-black uppercase">Unit confirm handover</th>
                    <th className="border-r border-purple-600/50 px-2.5 py-2 text-center font-black uppercase">Handover date</th>
                    <th className="border-r border-purple-600/50 px-2.5 py-2 text-center font-black uppercase">Status</th>
                    <th className="border-r border-purple-600/50 px-2.5 py-2 font-black uppercase">TEAM</th>
                    <th className="border-r border-purple-600/50 px-2.5 py-2 text-center font-black uppercase">Days</th>
                    <th className="px-2.5 py-2 text-center font-black uppercase">UNIT</th>
                  </tr>
                </thead>
                <tbody className="text-[9.5px] font-medium divide-y divide-slate-100">
                  {sortedM3.map((item, index) => {
                    const isOverdue = (parseInt(item.daysDiff) || 0) > 3;
                    return (
                      <tr key={index} className={`transition-colors whitespace-nowrap ${isOverdue ? 'bg-red-50/90 text-red-950 font-semibold border-l-4 border-l-red-600' : 'hover:bg-slate-50/80 odd:bg-white even:bg-slate-50/40 text-slate-800'}`}>
                        <td className="border-r border-slate-100 px-2 py-1.5 text-center font-extrabold text-slate-500">{index + 1}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-black text-slate-900 tracking-tight font-mono whitespace-nowrap">{item.code}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-800 whitespace-nowrap">{item.type || '-'}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-800 whitespace-nowrap">{cleanWarehouseName(item.handoverUnit || '-')}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-800 whitespace-nowrap">{cleanWarehouseName(item.unitConfirm || '-')}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-bold text-slate-700 font-mono text-center whitespace-nowrap">{item.date || '-'}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 text-center whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-extrabold ${item.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>{item.status || 'Pending'}</span>
                        </td>
                        <td className="border-r border-slate-100 px-2 py-1.5 font-black text-indigo-950 font-mono text-[9.5px] whitespace-nowrap">{item.team || getTeamFromRecipient(item.unitConfirm || item.handoverUnit || '-')}</td>
                        <td className="border-r border-slate-100 px-2 py-1.5 text-center font-extrabold">{getDelayBadge(item.daysDiff, 3)}</td>
                        <td className="px-2 py-1.5 text-center font-extrabold whitespace-nowrap">
                          <span className="bg-indigo-50 text-indigo-800 px-1 rounded border border-indigo-100 text-[8.5px] inline-block font-black">{item.unit || '-'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty State / All Cleared */}
        {m1Items.length === 0 && m2Items.length === 0 && m3Items.length === 0 && (
          <div className="bg-emerald-50/40 border border-emerald-100 rounded-3xl p-6 text-center text-emerald-600 font-bold text-sm flex flex-col items-center gap-2">
            <span>🎉 ALL MODULES COMPLETED</span>
            <span className="text-xs text-emerald-500 font-medium">គ្មានទិន្នន័យចាល់ឡើយ (All Items Cleared)</span>
          </div>
        )}
      </div>
    );
  };

  const generateScreenshotTasks = (unit) => {
    const m1Items = getUnitM1Items(unit);
    const m2Items = getUnitM2Items(unit);
    const m3Items = getUnitM3Items(unit);
    
    // Sort items for readability
    const sortedM1 = [...m1Items].sort((a, b) => (a.groupReceiver || '').localeCompare(b.groupReceiver || ''));
    const sortedM2 = [...m2Items].sort((a, b) => (a.recipient || '').localeCompare(b.recipient || ''));
    const sortedM3 = [...m3Items].sort((a, b) => (a.unitConfirm || '').localeCompare(b.unitConfirm || ''));

    const tasks = [];
    const chunkSize = 25;

    // Helper to chunk array
    const chunkArray = (arr, size) => {
      const chunks = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

    if (sortedM1.length > 0) {
      const chunks = chunkArray(sortedM1, chunkSize);
      chunks.forEach((chunk, idx) => {
        tasks.push({
          m1: chunk,
          m2: [],
          m3: [],
          label: `Part ${idx + 1}/${chunks.length}`,
          title: "TEAM STEP 1"
        });
      });
    }

    if (sortedM2.length > 0) {
      const chunks = chunkArray(sortedM2, chunkSize);
      chunks.forEach((chunk, idx) => {
        tasks.push({
          m1: [],
          m2: chunk,
          m3: [],
          label: `Part ${idx + 1}/${chunks.length}`,
          title: "ASSET STEP :2"
        });
      });
    }

    if (sortedM3.length > 0) {
      const chunks = chunkArray(sortedM3, chunkSize);
      chunks.forEach((chunk, idx) => {
        tasks.push({
          m1: [],
          m2: [],
          m3: chunk,
          label: `Part ${idx + 1}/${chunks.length}`,
          title: "TEAM STEP 3"
        });
      });
    }

    if (tasks.length === 0) {
      tasks.push({
        m1: [],
        m2: [],
        m3: [],
        label: "Cleared",
        title: "CONFIRMED HAND OVER REPORT"
      });
    }

    return tasks;
  };

  const getSummaryRows = () => {
    const rows = [];
    const unitsToProcess = screenshotUnit ? [screenshotUnit] : allUnits;
    
    unitsToProcess.forEach(unit => {
      const m1Items = getUnitM1Items(unit);
      const m2Items = getUnitM2Items(unit);
      const m3Items = getUnitM3Items(unit);
      
      const teamsSet = new Set();
      m1Items.forEach(item => {
        const teamName = getTeamFromRecipient(item.team || item.groupReceiver || item.warehouse || '-');
        if (teamName && teamName !== '-') {
          // Only add team if it belongs to this unit according to the explicit lookup
          const resolvedUnit = getUnitFromTeam(teamName);
          if (!resolvedUnit || resolvedUnit === unit) teamsSet.add(teamName);
        }
      });
      m2Items.forEach(item => {
        const teamName = getTeamFromRecipient(item.team || item.recipient || '-');
        if (teamName && teamName !== '-') {
          const resolvedUnit = getUnitFromTeam(teamName);
          if (!resolvedUnit || resolvedUnit === unit) teamsSet.add(teamName);
        }
      });
      m3Items.forEach(item => {
        const teamName = getTeamFromRecipient(item.team || item.unitConfirm || '-');
        if (teamName && teamName !== '-') {
          const resolvedUnit = getUnitFromTeam(teamName);
          if (!resolvedUnit || resolvedUnit === unit) teamsSet.add(teamName);
        }
      });
      
      const teams = Array.from(teamsSet).sort((a, b) => a.localeCompare(b));
      
      teams.forEach(team => {
        const matchesTeam = (item, raw) => getTeamFromRecipient(raw || '-') === team;
        const s1Under = m1Items.filter(item => matchesTeam(item, item.team || item.groupReceiver || item.warehouse) && (parseInt(item.daysDiff) || 0) <= 4).length;
        const s1Over = m1Items.filter(item => matchesTeam(item, item.team || item.groupReceiver || item.warehouse) && (parseInt(item.daysDiff) || 0) > 4).length;
        
        const s2Under = m2Items.filter(item => matchesTeam(item, item.team || item.recipient) && (parseInt(item.daysDiff) || 0) <= 3).length;
        const s2Over = m2Items.filter(item => matchesTeam(item, item.team || item.recipient) && (parseInt(item.daysDiff) || 0) > 3).length;
        
        const s3Under = m3Items.filter(item => matchesTeam(item, item.team || item.unitConfirm) && (parseInt(item.daysDiff) || 0) <= 3).length;
        const s3Over = m3Items.filter(item => matchesTeam(item, item.team || item.unitConfirm) && (parseInt(item.daysDiff) || 0) > 3).length;
        
        const underKpi = s1Under + s2Under + s3Under;
        const overKpi = s1Over + s2Over + s3Over;
        const total = underKpi + overKpi;
        
        rows.push({
          unit,
          team,
          s1Under,
          s1Over,
          s1Total: s1Under + s1Over,
          s2Under,
          s2Over,
          s2Total: s2Under + s2Over,
          s3Under,
          s3Over,
          s3Total: s3Under + s3Over,
          underKpi,
          overKpi,
          total
        });
      });
    });
    return rows;
  };

  const renderSummaryReport = () => {
    if (!summaryImageMode || !screenshotUnit) return null;
    
    const rows = getSummaryRows();
    const totalS1Under = rows.reduce((sum, r) => sum + r.s1Under, 0);
    const totalS1Over = rows.reduce((sum, r) => sum + r.s1Over, 0);
    const totalS1Total = totalS1Under + totalS1Over;
    
    const totalS2Under = rows.reduce((sum, r) => sum + r.s2Under, 0);
    const totalS2Over = rows.reduce((sum, r) => sum + r.s2Over, 0);
    const totalS2Total = totalS2Under + totalS2Over;
    
    const totalS3Under = rows.reduce((sum, r) => sum + r.s3Under, 0);
    const totalS3Over = rows.reduce((sum, r) => sum + r.s3Over, 0);
    const totalS3Total = totalS3Under + totalS3Over;
    
    const totalUnder = totalS1Under + totalS2Under + totalS3Under;
    const totalOver = totalS1Over + totalS2Over + totalS3Over;
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
                Stockout KPI Summary Report
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
              <tr className="text-white text-[10px] border-b border-slate-200">
                <th rowSpan="3" className="bg-slate-700 border-r border-slate-650 w-[40px] py-2 font-bold uppercase tracking-wider">No</th>
                <th rowSpan="3" className="bg-slate-700 border-r border-slate-650 w-[70px] py-2 font-bold uppercase tracking-wider">Code</th>
                <th rowSpan="3" className="bg-slate-700 border-r border-slate-650 w-[200px] py-2 text-left px-4 font-bold uppercase tracking-wider">Units name</th>
                
                <th colSpan="3" className="bg-blue-600 border-r border-blue-700 py-2 font-bold uppercase tracking-wider">
                  TEAM STEP 1<br/>
                  <span className="text-[9px] font-normal text-white/80">Stock out not Confirm goods</span>
                </th>
                <th colSpan="3" className="bg-amber-600 border-r border-amber-700 py-2 font-bold uppercase tracking-wider">
                  ASSET STEP :2<br/>
                  <span className="text-[9px] font-normal text-white/80">Stock out not create hand over</span>
                </th>
                <th colSpan="3" className="bg-purple-600 border-r border-purple-700 py-2 font-bold uppercase tracking-wider">
                  TEAM STEP 3<br/>
                  <span className="text-[9px] font-normal text-white/80">Hand over not Confirmed</span>
                </th>
                <th colSpan="3" className="bg-indigo-900 py-2 font-bold uppercase tracking-wider">
                  Total Summary
                </th>
              </tr>
              <tr className="text-white text-[10px] border-b border-slate-200">
                <th colSpan="3" className="bg-blue-700 border-r border-blue-800 py-1.5 font-black text-blue-200">KPI = 4 DAYS</th>
                <th colSpan="3" className="bg-amber-700 border-r border-amber-800 py-1.5 font-black text-amber-200">KPI = 3 DAYS</th>
                <th colSpan="3" className="bg-purple-700 border-r border-purple-800 py-1.5 font-black text-purple-200">KPI = 3 DAYS</th>
                <th colSpan="3" className="bg-indigo-950 py-1.5 font-black text-indigo-200">KPI TARGETS</th>
              </tr>
              <tr className="bg-slate-100 text-slate-600 text-[9px] border-b border-slate-200 font-bold">
                
                <th className="border-r border-blue-100 py-2 text-blue-700 bg-blue-50/30">Day &lt;= 4</th>
                <th className="border-r border-blue-100 py-2 text-red-600 bg-blue-50/30">Day &gt; 4</th>
                <th className="border-r border-blue-200 py-2 bg-blue-100/50 text-blue-900">Total</th>
                
                <th className="border-r border-amber-100 py-2 text-amber-750 bg-amber-50/30">Day &lt;= 3</th>
                <th className="border-r border-amber-100 py-2 text-red-600 bg-amber-50/30">Day &gt; 3</th>
                <th className="border-r border-amber-200 py-2 bg-amber-100/50 text-amber-900">Total</th>
                
                <th className="border-r border-purple-100 py-2 text-purple-700 bg-purple-50/30">Day &lt;= 3</th>
                <th className="border-r border-purple-100 py-2 text-red-600 bg-purple-50/30">Day &gt; 3</th>
                <th className="border-r border-purple-200 py-2 bg-purple-100/50 text-purple-900">Total</th>
                
                <th className="border-r border-indigo-100 py-2 text-indigo-700 bg-indigo-50/30">Under KPI</th>
                <th className="border-r border-indigo-100 py-2 text-red-600 bg-indigo-50/30">Over KPI</th>
                <th className="py-2 bg-indigo-100/50 text-indigo-950 font-black">Overall Total</th>
              </tr>
              
              <tr className="bg-slate-50 text-slate-800 font-black text-[11px] border-b border-slate-300 shadow-inner">
                <td colSpan="3" className="border-r border-slate-300 text-center py-2.5 uppercase tracking-wider text-slate-950">TEAM</td>
                <td className="border-r border-blue-100 py-2.5 text-blue-800 bg-blue-50/20">{formatVal(totalS1Under)}</td>
                <td className={`border-r border-blue-200 py-2.5 bg-blue-50/20 ${totalS1Over > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalS1Over)}</td>
                <td className="border-r border-slate-200 py-2.5 bg-blue-100/30 text-blue-900 font-black">{formatVal(totalS1Total)}</td>
                
                <td className="border-r border-amber-100 py-2.5 text-amber-800 bg-amber-50/20">{formatVal(totalS2Under)}</td>
                <td className={`border-r border-amber-200 py-2.5 bg-amber-50/20 ${totalS2Over > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalS2Over)}</td>
                <td className="border-r border-slate-200 py-2.5 bg-amber-100/30 text-amber-900 font-black">{formatVal(totalS2Total)}</td>
                
                <td className="border-r border-purple-100 py-2.5 text-purple-800 bg-purple-50/20">{formatVal(totalS3Under)}</td>
                <td className={`border-r border-purple-200 py-2.5 bg-purple-50/20 ${totalS3Over > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalS3Over)}</td>
                <td className="border-r border-slate-200 py-2.5 bg-purple-100/30 text-purple-900 font-black">{formatVal(totalS3Total)}</td>
                
                <td className="border-r border-indigo-100 py-2.5 bg-indigo-50/20 text-indigo-800 font-bold">{formatVal(totalUnder)}</td>
                <td className={`border-r border-indigo-200 py-2.5 bg-indigo-50/20 ${totalOver > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>{formatVal(totalOver)}</td>
                <td className="py-2.5 bg-indigo-200 text-indigo-950 font-black text-xs">{formatVal(totalAll)}</td>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 bg-white">
              {rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50 transition-colors odd:bg-white even:bg-slate-50/20 text-slate-700">
                  <td className="border-r border-slate-200 py-2 font-bold text-slate-400">{idx + 1}</td>
                  <td className="border-r border-slate-200 py-2 font-bold text-slate-800">{row.unit}</td>
                  <td className="border-r border-slate-200 py-2 text-left px-4 font-semibold text-slate-900 break-all">{row.team}</td>
                  
                  {/* Sheet 01 */}
                  <td className="border-r border-slate-150 py-2 text-slate-600 bg-blue-50/5 font-medium">{formatVal(row.s1Under)}</td>
                  <td className={`border-r border-slate-150 py-2 bg-blue-50/5 ${row.s1Over > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>
                    {formatVal(row.s1Over)}
                  </td>
                  <td className="border-r border-slate-150 py-2 bg-blue-100/10 text-blue-900 font-bold">{formatVal(row.s1Total)}</td>
                  
                  {/* Sheet 02 */}
                  <td className="border-r border-slate-150 py-2 text-slate-600 bg-amber-50/5 font-medium">{formatVal(row.s2Under)}</td>
                  <td className={`border-r border-slate-150 py-2 bg-amber-50/5 ${row.s2Over > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>
                    {formatVal(row.s2Over)}
                  </td>
                  <td className="border-r border-slate-150 py-2 bg-amber-100/10 text-amber-900 font-bold">{formatVal(row.s2Total)}</td>
                  
                  {/* Sheet 03 */}
                  <td className="border-r border-slate-150 py-2 text-slate-600 bg-purple-50/5 font-medium">{formatVal(row.s3Under)}</td>
                  <td className={`border-r border-slate-150 py-2 bg-purple-50/5 ${row.s3Over > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>
                    {formatVal(row.s3Over)}
                  </td>
                  <td className="border-r border-slate-150 py-2 bg-purple-100/10 text-purple-900 font-bold">{formatVal(row.s3Total)}</td>
                  
                  {/* Total summary */}
                  <td className="border-r border-slate-200 py-2 bg-indigo-50/5 text-slate-600 font-medium">{formatVal(row.underKpi)}</td>
                  <td className={`border-r border-slate-200 py-2 bg-indigo-50/5 ${row.overKpi > 0 ? 'bg-red-100 text-red-700 font-black' : ''}`}>
                    {formatVal(row.overKpi)}
                  </td>
                  <td className="py-2 bg-indigo-100/10 text-indigo-950 font-black">{formatVal(row.total)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan="15" className="py-12 text-center text-slate-400 font-medium bg-slate-50/50 text-xs">
                    🎉 Outstanding completion! No pending stockout items found under this branch.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
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
        alert(`✅ Summary image sent successfully to ${unit} group!`);
      } else {
        throw new Error(result?.error || 'Failed to send summary photo to Telegram');
      }
    } catch (error) {
      console.error('Error sending summary image:', error);
      const isAbort = abortControllerRef.current.signal.aborted;
      if (!isAbort) {
        setSendProgress({
          current: 0,
          total: 1,
          unit: unit,
          status: 'failed',
          error: error.message
        });
        setSendResults({
          total: 1,
          success: 0,
          failed: 1
        });
        alert(`❌ Error sending summary image: ${error.message}`);
      }
    } finally {
      setIsSending(false);
      setScreenshotUnit(null);
      setSummaryImageMode(false);
      if (!abortControllerRef.current?.signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  // Send single unit screenshot
  const sendReportToTelegramScreenshot = async (unit) => {
    if (isSending) return;
    
    if (!hasGroupId(unit)) {
      alert(`⚠️ No group ID configured for ${unit}. Please add it first.`);
      return;
    }

    const reportData = getReportData();
    const unitData = reportData && reportData.units ? reportData.units[unit] : null;
    const totalPending = (unitData?.m1Items?.length || 0) + (unitData?.m2Items?.length || 0) + (unitData?.m3Items?.length || 0);
    if (totalPending === 0) {
      alert(`ℹ️ No pending items to send for ${unit}. (គ្មានទិន្នន័យត្រូវផ្ញើទេ)`);
      return;
    }
    
    setIsSending(true);
    setShowProgressModal(true);
    setSendProgress({
      current: 0,
      total: 1,
      unit: unit,
      status: 'sending'
    });
    setSendResults(null);
    
    abortControllerRef.current = new AbortController();
    
    try {
      const tasks = generateScreenshotTasks(unit);
      setSendProgress({
        current: 1,
        total: tasks.length,
        unit: unit,
        status: 'sending'
      });

      setScreenshotUnit(unit);

      for (let i = 0; i < tasks.length; i++) {
        if (abortControllerRef.current.signal.aborted) break;

        const task = tasks[i];
        setActiveM1Items(task.m1);
        setActiveM2Items(task.m2);
        setActiveM3Items(task.m3);
        setScreenshotPartText(tasks.length > 1 ? `(${task.label})` : "");
        setScreenshotTitle(task.title);

        setSendProgress({
          current: i + 1,
          total: tasks.length,
          unit: unit,
          status: 'sending'
        });

        // Wait for rendering
        await new Promise(resolve => setTimeout(resolve, 350));

        const element = document.getElementById('telegram-screenshot-report');
        if (!element) {
          throw new Error('Screenshot element not found in DOM');
        }

        const offsetWidth = Math.max(element.scrollWidth || 0, element.offsetWidth || 0, 1150);
        const offsetHeight = element.offsetHeight || 500;
        let scale = 3.0;
        if (offsetHeight > 1800) scale = 2.0;
        else if (offsetHeight > 1200) scale = 2.5;

        const canvas = await html2canvas(element, {
          useCORS: true,
          scale: scale,
          backgroundColor: '#f8fafc',
          width: offsetWidth,
          height: offsetHeight,
          scrollX: 0,
          scrollY: 0,
          windowWidth: Math.max(document.documentElement.offsetWidth, offsetWidth + 100),
          windowHeight: document.documentElement.offsetHeight,
          logging: false,
          onclone: (clonedDoc) => {
            const clonedEl = clonedDoc.getElementById('telegram-screenshot-report');
            if (clonedEl) {
              clonedEl.style.position = 'static';
              clonedEl.style.width = 'max-content';
              clonedEl.style.overflow = 'visible';
            }
            const style = clonedDoc.createElement('style');
            style.innerHTML = `
              #telegram-screenshot-report * {
                -webkit-font-smoothing: antialiased !important;
                -moz-osx-font-smoothing: grayscale !important;
                text-rendering: optimizeLegibility !important;
              }
            `;
            clonedDoc.head.appendChild(style);
          }
        });

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob || blob.size < 1000 || canvas.width < 100 || canvas.height < 100) {
          throw new Error(`Invalid screenshot generated: Canvas=${canvas.width}x${canvas.height}`);
        }

        const result = await sendPhotoToTelegram(
          unit,
          blob,
          '',
          abortControllerRef.current.signal
        );

        if (!result || !result.success) {
          throw new Error(result?.error || 'Failed to send photo to Telegram');
        }
      }

      // Generate & send SINGLE 3-sheet Stockout Excel file (.xlsx) ONCE at the very end after all screenshot parts
      try {
        const m1Items = getUnitM1Items(unit);
        const m2Items = getUnitM2Items(unit);
        const m3Items = getUnitM3Items(unit);
        const excelBlob = generateStockoutExcelBlob(m1Items, m2Items, m3Items, unit);
        const filename = `STOCKOUT_${unit}_${new Date().toISOString().slice(0, 10)}.xls`;
        await sendDocumentToTelegram(unit, excelBlob, filename, '', abortControllerRef.current.signal);
      } catch (excelErr) {
        console.error('Error sending Stockout Excel file:', excelErr);
      }

      setSendProgress({
        current: tasks.length,
        total: tasks.length,
        unit: unit,
        status: 'success'
      });
      setSendResults({
        total: 1,
        success: 1,
        failed: 0
      });
      alert(`✅ Screenshot report sent successfully to ${unit} group!`);
    } catch (error) {
      console.error('Error generating/sending screenshot:', error);
      const isAbort = abortControllerRef.current.signal.aborted;
      if (!isAbort) {
        setSendProgress({
          current: 0,
          total: 1,
          unit: unit,
          status: 'failed',
          error: error.message
        });
        setSendResults({
          total: 1,
          success: 0,
          failed: 1
        });
        alert(`❌ Error generating/sending screenshot: ${error.message}`);
      }
    } finally {
      setIsSending(false);
      setScreenshotUnit(null);
      setActiveM1Items([]);
      setActiveM2Items([]);
      setActiveM3Items([]);
      setScreenshotPartText("");
      setScreenshotTitle("CONFIRMED HAND OVER REPORT");
      if (!abortControllerRef.current?.signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  // Send all screenshots
  const sendToAllScreenshot = async () => {
    if (isSending) return;
    
    const configured = getConfiguredUnits();
    if (configured.length === 0) {
      alert('⚠️ No group IDs configured! Please add group IDs for at least one province.');
      return;
    }
    
    setIsSending(true);
    setShowProgressModal(true);
    setSendProgress({
      current: 0,
      total: configured.length,
      unit: 'Starting...',
      status: 'sending'
    });
    setSendResults(null);
    
    abortControllerRef.current = new AbortController();
    let successCount = 0;
    let failCount = 0;
    let completedCount = 0;
    
    try {
      setScreenshotUnit(null);

      for (const unit of configured) {
        if (abortControllerRef.current.signal.aborted) {
          break;
        }
        
        setSendProgress({
          current: completedCount + 1,
          total: configured.length,
          unit: unit,
          status: 'sending'
        });
        
        try {
          const tasks = generateScreenshotTasks(unit);
          setScreenshotUnit(unit);

          let unitSuccess = true;

          for (let i = 0; i < tasks.length; i++) {
            if (abortControllerRef.current.signal.aborted) break;

            const task = tasks[i];
            setActiveM1Items(task.m1);
            setActiveM2Items(task.m2);
            setActiveM3Items(task.m3);
            setScreenshotPartText(tasks.length > 1 ? `(${task.label})` : "");
            setScreenshotTitle(task.title);

            // Wait for rendering
            await new Promise(resolve => setTimeout(resolve, 350));
            
            const element = document.getElementById('telegram-screenshot-report');
            if (!element) {
              throw new Error('Screenshot element not found');
            }
            
            const offsetWidth = Math.max(element.scrollWidth || 0, element.offsetWidth || 0, 1150);
            const offsetHeight = element.offsetHeight || 500;
            let scale = 3.0;
            if (offsetHeight > 1800) scale = 2.0;
            else if (offsetHeight > 1200) scale = 2.5;

            const canvas = await html2canvas(element, {
              useCORS: true,
              scale: scale,
              backgroundColor: '#f8fafc',
              width: offsetWidth,
              height: offsetHeight,
              scrollX: 0,
              scrollY: 0,
              windowWidth: Math.max(document.documentElement.offsetWidth, offsetWidth + 100),
              windowHeight: document.documentElement.offsetHeight,
              logging: false,
              onclone: (clonedDoc) => {
                const clonedEl = clonedDoc.getElementById('telegram-screenshot-report');
                if (clonedEl) {
                  clonedEl.style.position = 'static';
                  clonedEl.style.width = 'max-content';
                  clonedEl.style.overflow = 'visible';
                }
                const style = clonedDoc.createElement('style');
                style.innerHTML = `
                  #telegram-screenshot-report * {
                    -webkit-font-smoothing: antialiased !important;
                    -moz-osx-font-smoothing: grayscale !important;
                    text-rendering: optimizeLegibility !important;
                  }
                `;
                clonedDoc.head.appendChild(style);
              }
            });
            
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob || blob.size < 1000 || canvas.width < 100 || canvas.height < 100) {
              throw new Error(`Invalid screenshot generated for ${unit}: Canvas=${canvas.width}x${canvas.height}`);
            }
            
            const result = await sendPhotoToTelegram(
              unit,
              blob,
              '',
              abortControllerRef.current.signal
            );
            
            if (!result || !result.success) {
              unitSuccess = false;
            }

            await new Promise(resolve => setTimeout(resolve, 350));
          }

          // Generate & send SINGLE 3-sheet Stockout Excel file (.xlsx) ONCE at the very end after all screenshot parts
          try {
            const m1Items = getUnitM1Items(unit);
            const m2Items = getUnitM2Items(unit);
            const m3Items = getUnitM3Items(unit);
            const excelBlob = generateStockoutExcelBlob(m1Items, m2Items, m3Items, unit);
            const filename = `STOCKOUT_${unit}_${new Date().toISOString().slice(0, 10)}.xls`;
            await sendDocumentToTelegram(unit, excelBlob, filename, '', abortControllerRef.current.signal);
          } catch (excelErr) {
            console.error('Error sending Stockout Excel file:', excelErr);
          }

          if (unitSuccess) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (unitError) {
          console.error(`Error sending screenshot for ${unit}:`, unitError);
          failCount++;
        }
        
        completedCount++;
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
      setSendResults({
        total: configured.length,
        success: successCount,
        failed: failCount
      });
      
      setSendProgress({
        current: configured.length,
        total: configured.length,
        unit: 'All completed!',
        status: failCount === 0 ? 'success' : 'failed'
      });
      
    } catch (error) {
      console.error('Error during send all screenshots:', error);
    } finally {
      setIsSending(false);
      setScreenshotUnit(null);
      setActiveM1Items([]);
      setActiveM2Items([]);
      setActiveM3Items([]);
      setScreenshotPartText("");
      setScreenshotTitle("CONFIRMED HAND OVER REPORT");
      if (!abortControllerRef.current?.signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 4000);
      }
    }
  };

  const sendSummaryImageScreenshotAll = async () => {
    const configured = getConfiguredUnits();
    if (configured.length === 0) {
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
    
    try {
      setSummaryImageMode(true);
      for (const unit of configured) {
        if (signal.aborted) {
          failCount++;
          completedCount++;
          continue;
        }
        
        setSendProgress({
          current: completedCount + 1,
          total: configured.length,
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
          
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (!blob || blob.size < 1000) {
            throw new Error('Failed to generate summary image');
          }
          
          const result = await sendPhotoToTelegram(unit, blob, '', signal);
          
          if (result && result.success) {
            successCount++;
            setSendProgress({
              current: completedCount + 1,
              total: configured.length,
              unit: unit,
              status: 'success'
            });
          } else {
            failCount++;
            setSendProgress({
              current: completedCount + 1,
              total: configured.length,
              unit: unit,
              status: 'failed',
              error: result?.error || 'Failed to send'
            });
          }
        } catch (unitErr) {
          console.error(`Error sending summary image for ${unit}:`, unitErr);
          failCount++;
          setSendProgress({
            current: completedCount + 1,
            total: configured.length,
            unit: unit,
            status: 'failed',
            error: unitErr.message
          });
        }
        
        completedCount++;
        if (completedCount < configured.length && !signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 600));
        }
      }
      
      setSendResults({
        total: configured.length,
        success: successCount,
        failed: failCount
      });
    } catch (error) {
      console.error('Error during send all summary images:', error);
    } finally {
      setIsSending(false);
      setScreenshotUnit(null);
      setSummaryImageMode(false);
      setIsSelectingForSummary(false);
      if (!signal.aborted) {
        setTimeout(() => setShowProgressModal(false), 3000);
      }
    }
  };

  // Send to single unit
  const sendReportToTelegram = async (unit) => {
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
      const data = getReportData();
      const result = await sendToTelegram(unit, data, customNote, abortControllerRef.current.signal);
      
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
                  hasError ? 'bg-red-500' : 'bg-gradient-to-r from-blue-500 to-green-500'
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
              <div className="flex items-center gap-2 text-green-600">
                <span>✅</span>
                <span>Sent to <strong>{progress.unit}</strong></span>
              </div>
            )}
            {progress.status === 'failed' && (
              <div className="flex items-center gap-2 text-red-600">
                <span>❌</span>
                <span>Failed to send to <strong>{progress.unit}</strong></span>
                {progress.error && <span className="text-xs text-gray-500">({progress.error})</span>}
              </div>
            )}
            {progress.status === 'error' && (
              <div className="flex items-center gap-2 text-red-600">
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
                <div className="bg-green-50 rounded-lg p-2">
                  <div className="text-green-500">Success</div>
                  <div className="text-xl font-bold text-green-600">{results.success}</div>
                </div>
                <div className="bg-red-50 rounded-lg p-2">
                  <div className="text-red-500">Failed</div>
                  <div className="text-xl font-bold text-red-600">{results.failed}</div>
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
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
              >
                🛑 Cancel Sending
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render component
  const renderComponent = () => {
    switch(selectedComponent) {
      case 'NO_CREATE_HAND_OVER':
        return <NO_CREATE_HAND_OVER />;
      case 'STOCKOUT_YET_CONFIRM':
        return <STOCKOUT_YET_CONFIRM />;
      case 'STOCK_OUT_NOTE_CONFIRMED':
        return <STOCK_OUT_NOTE_CONFIRMED />;
      default:
        const configured = getConfiguredUnits();
        const totalUnits = allUnits.length;
        const configuredCount = configured.length;
        
        return (
          <div className="w-full px-4 py-6 bg-gray-50 min-h-screen">
            {/* ─── HEADER ─── */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 mb-6 text-white shadow-sm">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-xl font-bold text-white tracking-tight">
                      របាយការណ៍ជូនដំណឹងអំពីការទទួលសម្ភារៈ ដែលមិនទាន់បានបញ្ជាក់ (Confirm) ការប្រគល់ក្នុងប្រព័ន្ធនៅឡើយ
                    </h1>
                    <span className="bg-slate-800 text-slate-300 text-[10px] px-2.5 py-0.5 rounded border border-slate-700 font-semibold flex items-center gap-1.5 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Active • {currentTime.toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-400 mt-1.5 text-xs sm:text-sm font-semibold uppercase tracking-wider">Confirmed Hand Over Overview</p>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 border-l-4 border-blue-500 hover:shadow-md transition-all duration-200">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Target ព្រឹក</div>
                <div className="text-2xl font-bold mt-1 text-blue-600 font-mono">{totals.targetMorning}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 border-l-4 border-indigo-500 hover:shadow-md transition-all duration-200">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Target ល្ងាច</div>
                <div className="text-2xl font-bold mt-1 text-indigo-600 font-mono">{totals.targetEvening}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 border-l-4 border-amber-500 hover:shadow-md transition-all duration-200">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Remain</div>
                <div className="text-2xl font-bold mt-1 text-amber-600 font-mono">{totals.remain}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 border-l-4 border-emerald-500 hover:shadow-md transition-all duration-200">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Result</div>
                <div className="text-2xl font-bold mt-1 text-emerald-600 font-mono">{totals.result}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 border-l-4 border-purple-500 hover:shadow-md transition-all duration-200">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ratio</div>
                <div className="text-2xl font-bold mt-1 text-purple-600 font-mono">{totals.ratio}%</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 border-l-4 border-cyan-500 hover:shadow-md transition-all duration-200">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">In System</div>
                <div className="text-2xl font-bold mt-1 text-cyan-600 font-mono">{totals.inSystem}</div>
              </div>
            </div>

            {/* ─── PROGRESS BAR ─── */}
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 mb-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Overall Progress</span>
                <span className="text-sm font-bold text-slate-800 font-mono">{totals.ratio}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-indigo-650 h-2 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min(100, parseFloat(totals.ratio))}%` }}
                ></div>
              </div>
            </div>

            {/* ─── KPI PERFORMANCE TABLE ─── */}
            <div className="bg-white rounded-xl border border-slate-200/85 p-5 shadow-sm mb-6 overflow-hidden">
              <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                Performance by Module
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Module/KPI Task</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Target ព្រឹក</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Target ល្ងាច</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Remain</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Result</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Ratio</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">In System</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {kpiData.map((item) => (
                      <tr 
                        key={item.id} 
                        className="hover:bg-gray-50 cursor-pointer transition-colors" 
                        onClick={() => onNavigate ? onNavigate(item.component) : setSelectedComponent(item.component)}
                      >
                        <td className="px-4 py-3.5 text-sm font-medium text-gray-900 flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full bg-gradient-to-r ${item.color}`}></span>
                          <span className="flex items-center gap-1.5">
                            <span>{item.icon}</span>
                            {item.task}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-right text-gray-600 font-medium">{item.targetMorning}</td>
                        <td className="px-4 py-3.5 text-sm text-right text-gray-600 font-medium">{item.targetEvening}</td>
                        <td className="px-4 py-3.5 text-sm text-right font-semibold text-amber-600">{item.remain}</td>
                        <td className="px-4 py-3.5 text-sm text-right font-semibold text-emerald-600">{item.result}</td>
                        <td className="px-4 py-3.5 text-sm text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-semibold text-gray-800">{item.ratio}</span>
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                              <div 
                                className="h-2 rounded-full bg-blue-500" 
                                style={{ width: `${Math.min(100, parseFloat(item.ratio))}%` }}
                              ></div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-right text-gray-500">{item.inSystem}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-bold border-t border-gray-200">
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-900">សរុប (TOTAL)</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">{totals.targetMorning}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">{totals.targetEvening}</td>
                      <td className="px-4 py-3 text-sm text-right text-amber-600">{totals.remain}</td>
                      <td className="px-4 py-3 text-sm text-right text-emerald-600">{totals.result}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">{totals.ratio}%</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500">{totals.inSystem}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ─── KPI CARDS GRID ─── */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {kpiData.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onNavigate ? onNavigate(item.component) : setSelectedComponent(item.component)}
                  className={`group ${item.bgColor} border ${item.borderColor} rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer hover:-translate-y-1`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-12 h-12 rounded-2xl bg-gradient-to-r ${item.color} flex items-center justify-center text-2xl text-white shadow-lg`}>
                      {item.icon}
                    </div>
                    <span className="text-3xl font-bold text-gray-800 group-hover:scale-110 transition-transform">
                      {item.ratio}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-1">{item.task}</h4>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                    <div>
                      <span className="text-gray-500">Target</span>
                      <span className="block font-bold text-gray-800">{item.target}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Result</span>
                      <span className="block font-bold text-emerald-600">{item.result}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Remain</span>
                      <span className="block font-bold text-amber-600">{item.remain}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">In System</span>
                      <span className="block font-bold text-blue-600">{item.inSystem}</span>
                    </div>
                  </div>
                  <div className="mt-3 w-full bg-gray-200 rounded-full h-1.5">
                    <div 
                      className={`h-1.5 rounded-full bg-gradient-to-r ${item.color}`}
                      style={{ width: `${Math.min(100, parseFloat(item.ratio))}%` }}
                    ></div>
                  </div>
                  <div className="mt-3 text-xs text-blue-600 font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                    <span>View Details</span>
                    <span>➔</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
    }
  };

  if (isEmbedded) {
    return (
      <div key={selectedComponent} className="w-full bg-gray-50 min-h-screen animate-fadeIn">
        {renderComponent()}
        {renderProgressModal()}
        {createPortal(renderScreenshotReport(), document.body)}
        {createPortal(renderSummaryReport(), document.body)}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar onSelect={setSelectedComponent} selected={selectedComponent} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar />
        <main key={selectedComponent} className="flex-1 overflow-y-auto bg-gray-50 animate-fadeIn">
          {renderComponent()}
          {renderProgressModal()}
        </main>
      </div>
      {createPortal(renderScreenshotReport(), document.body)}
      {createPortal(renderSummaryReport(), document.body)}
    </div>
  );
};

export default Dashboad_Stockout;