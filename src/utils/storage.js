// src/utils/storage.js

// Keys for localStorage
export const STORAGE_KEYS = {
  // STOCKOUT YET CONFIRM
  STOCKOUT_DATA: 'kpi_stockout_data',
  STOCKOUT_COMPLETION: 'kpi_stockout_completionHistory',
  STOCKOUT_TARGETS: 'kpi_stockout_targets',
  STOCKOUT_TARGET_HISTORY: 'kpi_stockout_targetHistory',
  
  // NO CREATE HAND OVER
  NOCREATE_DATA: 'kpi_nocreate_data',
  NOCREATE_COMPLETION: 'kpi_nocreate_completionHistory',
  NOCREATE_TARGETS: 'kpi_nocreate_targets',
  NOCREATE_TARGET_HISTORY: 'kpi_nocreate_targetHistory',
  NOCREATE_CONFIRMED: 'kpi_nocreate_confirmedStatus',
  
  // STOCK OUT NOTE - NOT CONFIRMED
  NOTCONFIRMED_DATA: 'kpi_notconfirmed_data',
  NOTCONFIRMED_COMPLETION: 'kpi_notconfirmed_completionHistory',
  NOTCONFIRMED_TARGETS: 'kpi_notconfirmed_targets',
  NOTCONFIRMED_TARGET_HISTORY: 'kpi_notconfirmed_targetHistory',
  NOTCONFIRMED_CONFIRMED: 'kpi_notconfirmed_confirmedStatus',
};

// Helper functions
export const getData = (key) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    console.error(`Error reading ${key}:`, e);
    return null;
  }
};

export const setData = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Error saving ${key}:`, e);
  }
};

export const getAllKpiData = () => {
  return {
    stockout: {
      data: getData(STORAGE_KEYS.STOCKOUT_DATA) || [],
      completion: getData(STORAGE_KEYS.STOCKOUT_COMPLETION) || [],
      targets: getData(STORAGE_KEYS.STOCKOUT_TARGETS) || {},
    },
    nocreate: {
      data: getData(STORAGE_KEYS.NOCREATE_DATA) || [],
      completion: getData(STORAGE_KEYS.NOCREATE_COMPLETION) || [],
      targets: getData(STORAGE_KEYS.NOCREATE_TARGETS) || {},
      confirmed: getData(STORAGE_KEYS.NOCREATE_CONFIRMED) || {},
    },
    notconfirmed: {
      data: getData(STORAGE_KEYS.NOTCONFIRMED_DATA) || [],
      completion: getData(STORAGE_KEYS.NOTCONFIRMED_COMPLETION) || [],
      targets: getData(STORAGE_KEYS.NOTCONFIRMED_TARGETS) || {},
      confirmed: getData(STORAGE_KEYS.NOTCONFIRMED_CONFIRMED) || {},
    }
  };
};
