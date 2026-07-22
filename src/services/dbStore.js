// dbStore.js - Service for PostgreSQL-backed Key-Value storage with automatic migration

const getBackendBaseUrl = () => {
  const host = window.location.hostname || 'localhost';
  const isLocal = host === 'localhost' || 
                  host === '127.0.0.1' || 
                  host.startsWith('192.168.') || 
                  host.startsWith('10.') || 
                  host.startsWith('172.') || 
                  host.endsWith('.local');
  if (isLocal) {
    return `http://${host}:8000/api/store`;
  }
  return 'https://gis-kpi-backend.onrender.com/api/store';
};

/**
 * Retrieve a JSON value from the database store.
 * If not found in the DB, it checks localStorage (automatic migration) and saves it to the DB.
 * If not found anywhere, it returns the fallback.
 */
export const loadFromDb = async (key, fallback = null) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${getBackendBaseUrl()}/${key}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    // If key is not found (404), it has been deleted on the server. Clear local cache.
    if (response.status === 404) {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
      return fallback;
    }

    if (response.ok) {
      const data = await response.json();
      if (data && data.status === 'cleared') {
        try {
          localStorage.removeItem(key);
        } catch (e) {}
        return fallback;
      }
      if (data && data.value !== undefined && data.value !== null) {
        const valStr = typeof data.value === 'string' ? data.value : JSON.stringify(data.value);
        try {
          localStorage.setItem(key, valStr);
        } catch (e) {
          console.warn(`LocalStorage quota error caching "${key}":`, e);
        }
        try {
          return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        } catch (parseErr) {
          return data.value;
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.warn(`Backend store fetch failed for "${key}", using local fallback:`, error.message);
    }
  }

  // Fallback to local storage (read-only offline cache, NEVER re-upload automatically)
  try {
    const localSaved = localStorage.getItem(key);
    if (localSaved !== null) {
      try {
        return JSON.parse(localSaved);
      } catch (e) {
        return localSaved;
      }
    }
  } catch (e) {
    console.error(`Error reading localStorage for "${key}":`, e);
  }

  return fallback;
};

/**
 * Save a value (object or array) to the database store.
 * Serializes the value to JSON and caches it locally in localStorage.
 */
export const saveToDb = async (key, value) => {
  const jsonString = JSON.stringify(value);
  
  // Cache to localStorage immediately
  try {
    localStorage.setItem(key, jsonString);
  } catch (e) {
    console.error(`Error updating localStorage cache for "${key}":`, e);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(getBackendBaseUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: key,
        value: jsonString
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      return data; // Return full DB object (key, value, status, result, updated_at, version)
    } else {
      console.error(`Failed to save key "${key}" to DB: ${response.status}`);
      return null;
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(`Network error saving key "${key}" to DB:`, error);
    }
    return null;
  }
};

/**
 * Transition a store value's status to 'completed'.
 */
export const completeStore = async (key) => {
  try {
    const response = await fetch(`${getBackendBaseUrl()}/${key}/complete`, {
      method: 'POST'
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error(`Error completing store for key "${key}":`, error);
  }
  return null;
};

export const clearStore = async (key) => {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.error(`Error clearing localStorage cache for "${key}":`, e);
  }
  try {
    const response = await fetch(`${getBackendBaseUrl()}/${key}`, {
      method: 'DELETE'
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error(`Error deleting store key "${key}" from DB:`, error);
  }
  return null;
};

/**
 * Check if a store value is in 'draft' status.
 */
export const isStoreDraft = async (key) => {
  try {
    const response = await fetch(`${getBackendBaseUrl()}/${key}`);
    if (response.ok) {
      const data = await response.json();
      return data && data.status === 'draft';
    }
  } catch (error) {
    console.error(`Error checking draft status for key "${key}":`, error);
  }
  return false;
};
