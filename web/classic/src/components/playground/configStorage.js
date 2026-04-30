/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import {
  STORAGE_KEYS,
  DEFAULT_CONFIG,
  DEFAULT_IMAGE_INPUTS,
  IMAGE_HISTORY_MAX_BATCHES,
  PLAYGROUND_MODES,
} from '../../constants/playground.constants';

const MESSAGES_STORAGE_KEY = 'playground_messages';
const IMAGE_DB_NAME = 'playground_image_store';
const IMAGE_DB_VERSION = 1;
const IMAGE_DB_STORE = 'images';
const IMAGE_DIRECTORY_HANDLE_KEY = '__image_directory_handle__';

export const isFileSystemStorageSupported = () =>
  typeof window !== 'undefined' &&
  typeof window.showDirectoryPicker === 'function';

const b64ToBlob = (b64Json, mimeType = 'image/png') => {
  const binary = atob(b64Json);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
};

const safeFilePart = (value) =>
  String(value || '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

const getBatchDate = (batch) => {
  const d = new Date(batch?.createdAt || Date.now());
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

const openImageDB = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_DB_STORE)) {
        db.createObjectStore(IMAGE_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const imageDBAction = async (mode, action) => {
  const db = await openImageDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_DB_STORE, mode);
      const store = tx.objectStore(IMAGE_DB_STORE);
      const request = action(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
};

const saveStoredImage = (key, b64Json) =>
  imageDBAction('readwrite', (store) => store.put(b64Json, key));

const loadStoredImage = (key) =>
  imageDBAction('readonly', (store) => store.get(key));

const clearStoredImages = () =>
  imageDBAction('readwrite', (store) => store.getAllKeys()).then((keys) => {
    const deletes = keys
      .filter((key) => key !== IMAGE_DIRECTORY_HANDLE_KEY)
      .map((key) => imageDBAction('readwrite', (store) => store.delete(key)));
    return Promise.allSettled(deletes);
  });

export const saveImageDirectoryHandle = (handle) =>
  imageDBAction('readwrite', (store) =>
    store.put(handle, IMAGE_DIRECTORY_HANDLE_KEY),
  );

export const loadImageDirectoryHandle = () =>
  imageDBAction('readonly', (store) => store.get(IMAGE_DIRECTORY_HANDLE_KEY));

export const clearImageDirectoryHandle = () =>
  imageDBAction('readwrite', (store) =>
    store.delete(IMAGE_DIRECTORY_HANDLE_KEY),
  );

export const requestImageDirectoryPermission = async (
  handle,
  mode = 'readwrite',
) => {
  if (!handle) return 'denied';
  if (typeof handle.queryPermission === 'function') {
    const current = await handle.queryPermission({ mode });
    if (current === 'granted') return current;
  }
  if (typeof handle.requestPermission !== 'function') return 'denied';
  return handle.requestPermission({ mode });
};

const sanitizeBatchForStorage = (batch) => {
  if (!batch || typeof batch !== 'object') return batch;

  const { rawResponse, ...rest } = batch;
  return {
    ...rest,
    status: batch.status === 'loading' ? 'error' : batch.status,
    error: batch.status === 'loading' ? '连接已断开' : batch.error,
    items: Array.isArray(batch.items)
      ? batch.items.map((item, index) => {
          if (!item || typeof item !== 'object') return item;
          const { b64_json, objectUrl, ...itemRest } = item;
          if (!b64_json) return itemRest;

          return {
            ...itemRest,
            b64StorageKey:
              item.b64StorageKey || `${batch.id || 'image'}-${index}`,
          };
        })
      : [],
  };
};

const persistImageB64Payloads = (batches) => {
  const writes = [];
  batches.forEach((batch) => {
    if (!batch || !Array.isArray(batch.items)) return;
    batch.items.forEach((item, index) => {
      if (!item?.b64_json) return;
      const key = item.b64StorageKey || `${batch.id || 'image'}-${index}`;
      writes.push(saveStoredImage(key, item.b64_json));
    });
  });
  Promise.allSettled(writes).catch(() => {});
};

const serializeImageHistory = (batches, extra = {}) =>
  JSON.stringify({
    batches: batches.map(sanitizeBatchForStorage),
    timestamp: new Date().toISOString(),
    ...extra,
  });

const getImageResultDirectory = async (directoryHandle, batch) => {
  const root = await directoryHandle.getDirectoryHandle('playground-images', {
    create: true,
  });
  const d = getBatchDate(batch);
  const dateDir = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = await root.getDirectoryHandle(dateDir, { create: true });
  const batchDirName = safeFilePart(batch?.id || Date.now());
  const batchDir = await day.getDirectoryHandle(batchDirName, { create: true });
  return {
    batchDir,
    localBatchDir: `playground-images/${dateDir}/${batchDirName}`,
  };
};

const writeTextFile = async (directoryHandle, fileName, content) => {
  const fileHandle = await directoryHandle.getFileHandle(fileName, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
};

const writeBlobFile = async (directoryHandle, fileName, blob) => {
  const fileHandle = await directoryHandle.getFileHandle(fileName, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
};

export const saveImageBatchToDirectory = async (batch, directoryHandle) => {
  if (!directoryHandle || batch?.status !== 'complete') return batch;
  const items = Array.isArray(batch.items) ? batch.items : [];
  if (!items.some((item) => item?.b64_json)) return batch;

  const permission = await requestImageDirectoryPermission(directoryHandle);
  if (permission !== 'granted') return batch;

  const { batchDir, localBatchDir } = await getImageResultDirectory(
    directoryHandle,
    batch,
  );

  const savedItems = await Promise.all(
    items.map(async (item, index) => {
      if (!item?.b64_json) return item;
      const fileName = `image-${index + 1}.png`;
      await writeBlobFile(batchDir, fileName, b64ToBlob(item.b64_json));
      const { b64_json, objectUrl, ...rest } = item;
      const nextObjectUrl = objectUrl || URL.createObjectURL(b64ToBlob(item.b64_json));
      return {
        ...rest,
        objectUrl: nextObjectUrl,
        localFileName: fileName,
        localBatchDir,
        savedToDirectory: true,
      };
    }),
  );

  const savedBatch = {
    ...batch,
    items: savedItems,
    savedToDirectory: true,
    localBatchDir,
  };

  await writeTextFile(
    batchDir,
    'metadata.json',
    JSON.stringify(sanitizeBatchForStorage(savedBatch), null, 2),
  );

  return savedBatch;
};

const getDirectoryByPath = async (directoryHandle, path) => {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean);
  let current = directoryHandle;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part);
  }
  return current;
};

export const hydrateFileSystemImageHistory = async (
  batches,
  directoryHandle,
) => {
  if (!directoryHandle) return batches;
  const permission = await requestImageDirectoryPermission(
    directoryHandle,
    'read',
  );
  if (permission !== 'granted') return batches;

  return Promise.all(
    (Array.isArray(batches) ? batches : []).map(async (batch) => {
      if (!batch || !Array.isArray(batch.items)) return batch;
      const items = await Promise.all(
        batch.items.map(async (item) => {
          if (
            !item?.savedToDirectory ||
            !item.localBatchDir ||
            !item.localFileName
          ) {
            return item;
          }
          try {
            const dir = await getDirectoryByPath(
              directoryHandle,
              item.localBatchDir,
            );
            const fileHandle = await dir.getFileHandle(item.localFileName);
            const file = await fileHandle.getFile();
            return { ...item, objectUrl: URL.createObjectURL(file) };
          } catch (_) {
            return item;
          }
        }),
      );
      return { ...batch, items };
    }),
  );
};

/**
 * 保存配置到 localStorage
 * @param {Object} config - 要保存的配置对象
 */
export const saveConfig = (config) => {
  try {
    const configToSave = {
      ...config,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(configToSave));
  } catch (error) {
    console.error('保存配置失败:', error);
  }
};

/**
 * 保存消息到 localStorage
 * @param {Array} messages - 要保存的消息数组
 */
export const saveMessages = (messages) => {
  try {
    const messagesToSave = {
      messages,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messagesToSave));
  } catch (error) {
    console.error('保存消息失败:', error);
  }
};

/**
 * 从 localStorage 加载配置
 * @returns {Object} 配置对象，如果不存在则返回默认配置
 */
export const loadConfig = () => {
  try {
    const savedConfig = localStorage.getItem(STORAGE_KEYS.CONFIG);
    if (savedConfig) {
      const parsedConfig = JSON.parse(savedConfig);
      const parsedMaxTokens = parseInt(parsedConfig?.inputs?.max_tokens, 10);

      const validModes = Object.values(PLAYGROUND_MODES);
      const mergedConfig = {
        inputs: {
          ...DEFAULT_CONFIG.inputs,
          ...parsedConfig.inputs,
          max_tokens: Number.isNaN(parsedMaxTokens)
            ? parsedConfig?.inputs?.max_tokens
            : parsedMaxTokens,
        },
        parameterEnabled: {
          ...DEFAULT_CONFIG.parameterEnabled,
          ...parsedConfig.parameterEnabled,
        },
        showDebugPanel:
          parsedConfig.showDebugPanel || DEFAULT_CONFIG.showDebugPanel,
        customRequestMode:
          parsedConfig.customRequestMode || DEFAULT_CONFIG.customRequestMode,
        customRequestBody:
          parsedConfig.customRequestBody || DEFAULT_CONFIG.customRequestBody,
        mode: validModes.includes(parsedConfig.mode)
          ? parsedConfig.mode
          : PLAYGROUND_MODES.CHAT,
        imageInputs: {
          ...DEFAULT_IMAGE_INPUTS,
          ...(parsedConfig.imageInputs || {}),
        },
      };

      return mergedConfig;
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }

  return {
    ...DEFAULT_CONFIG,
    mode: PLAYGROUND_MODES.CHAT,
    imageInputs: { ...DEFAULT_IMAGE_INPUTS },
  };
};

/**
 * 加载图片生成历史
 * @returns {Array} 图片批次数组，最新的在最前
 */
export const loadImageHistory = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.IMAGE_HISTORY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.batches)) {
        return parsed.batches.map((batch) => {
          if (!batch || typeof batch !== 'object') return batch;
          const hasItems = Array.isArray(batch.items) && batch.items.length > 0;
          const items = hasItems
            ? batch.items.map((item) =>
                item && typeof item === 'object'
                  ? { ...item, partial: false }
                  : item,
              )
            : batch.items;
          if (
            batch.status === 'loading' ||
            batch.status === 'generating' ||
            batch.status === 'queued'
          ) {
            return {
              ...batch,
              items,
              status: 'error',
              error: batch.error || '连接已断开',
            };
          }
          if (
            (batch.status === 'complete' || batch.status === 'success') &&
            !hasItems
          ) {
            return {
              ...batch,
              status: 'error',
              error: batch.error || '图片缓存已失效，请重新生成',
            };
          }
          return { ...batch, items };
        });
      }
    }
  } catch (error) {
    console.error('加载图片历史失败:', error);
  }
  return [];
};

/**
 * 保存图片生成历史（自动截断到 IMAGE_HISTORY_MAX_BATCHES）
 * @param {Array} batches
 */
export const saveImageHistory = (batches) => {
  try {
    const safe = Array.isArray(batches) ? batches : [];
    const trimmed = safe.slice(0, IMAGE_HISTORY_MAX_BATCHES);
    persistImageB64Payloads(trimmed);
    pruneStoredImages(trimmed);
    localStorage.setItem(
      STORAGE_KEYS.IMAGE_HISTORY,
      serializeImageHistory(trimmed),
    );
  } catch (error) {
    try {
      const trimmed = (Array.isArray(batches) ? batches : []).slice(0, 5);
      persistImageB64Payloads(trimmed);
      pruneStoredImages(trimmed);
      localStorage.setItem(
        STORAGE_KEYS.IMAGE_HISTORY,
        serializeImageHistory(trimmed, { truncatedDueToQuota: true }),
      );
    } catch (innerError) {
      console.error('保存图片历史失败:', innerError);
    }
  }
};

export const hydrateImageHistory = async (batches) => {
  const safe = Array.isArray(batches) ? batches : [];
  const hydrated = await Promise.all(
    safe.map(async (batch) => {
      if (!batch || !Array.isArray(batch.items)) return batch;

      const items = await Promise.all(
        batch.items.map(async (item) => {
          if (!item?.b64StorageKey || item.b64_json) return item;
          try {
            const b64_json = await loadStoredImage(item.b64StorageKey);
            return b64_json ? { ...item, b64_json } : item;
          } catch (_) {
            return item;
          }
        }),
      );

      return { ...batch, items };
    }),
  );

  return hydrated;
};

/**
 * 清空图片历史
 */
export const clearImageHistory = () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.IMAGE_HISTORY);
    clearStoredImages().catch(() => {});
  } catch (error) {
    console.error('清除图片历史失败:', error);
  }
};

export const pruneStoredImages = (batches) => {
  const keys = new Set();
  (Array.isArray(batches) ? batches : []).forEach((batch) => {
    if (!Array.isArray(batch?.items)) return;
    batch.items.forEach((item, index) => {
      const key =
        item?.b64StorageKey ||
        (item?.b64_json ? `${batch.id || 'image'}-${index}` : null);
      if (key) keys.add(key);
    });
  });

  openImageDB()
    .then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(IMAGE_DB_STORE, 'readwrite');
          const store = tx.objectStore(IMAGE_DB_STORE);
          const request = store.getAllKeys();
          request.onsuccess = () => {
            request.result.forEach((key) => {
              if (key === IMAGE_DIRECTORY_HANDLE_KEY) return;
              if (!keys.has(key)) store.delete(key);
            });
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        }),
    )
    .catch(() => {});
};

/**
 * 从 localStorage 加载消息
 * @returns {Array} 消息数组，如果不存在则返回 null
 */
export const loadMessages = () => {
  try {
    const savedMessages = localStorage.getItem(STORAGE_KEYS.MESSAGES);
    if (savedMessages) {
      const parsedMessages = JSON.parse(savedMessages);
      return parsedMessages.messages || null;
    }
  } catch (error) {
    console.error('加载消息失败:', error);
  }

  return null;
};

/**
 * 清除保存的配置
 */
export const clearConfig = () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.CONFIG);
    localStorage.removeItem(STORAGE_KEYS.MESSAGES); // 同时清除消息
  } catch (error) {
    console.error('清除配置失败:', error);
  }
};

/**
 * 清除保存的消息
 */
export const clearMessages = () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.MESSAGES);
  } catch (error) {
    console.error('清除消息失败:', error);
  }
};

/**
 * 检查是否有保存的配置
 * @returns {boolean} 是否存在保存的配置
 */
export const hasStoredConfig = () => {
  try {
    return localStorage.getItem(STORAGE_KEYS.CONFIG) !== null;
  } catch (error) {
    console.error('检查配置失败:', error);
    return false;
  }
};

/**
 * 获取配置的最后保存时间
 * @returns {string|null} 最后保存时间的 ISO 字符串
 */
export const getConfigTimestamp = () => {
  try {
    const savedConfig = localStorage.getItem(STORAGE_KEYS.CONFIG);
    if (savedConfig) {
      const parsedConfig = JSON.parse(savedConfig);
      return parsedConfig.timestamp || null;
    }
  } catch (error) {
    console.error('获取配置时间戳失败:', error);
  }
  return null;
};

/**
 * 导出配置为 JSON 文件（包含消息）
 * @param {Object} config - 要导出的配置
 * @param {Array} messages - 要导出的消息
 */
export const exportConfig = (config, messages = null) => {
  try {
    const configToExport = {
      ...config,
      messages: messages || loadMessages(), // 包含消息数据
      exportTime: new Date().toISOString(),
      version: '1.0',
    };

    const dataStr = JSON.stringify(configToExport, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `playground-config-${new Date().toISOString().split('T')[0]}.json`;
    link.click();

    URL.revokeObjectURL(link.href);
  } catch (error) {
    console.error('导出配置失败:', error);
  }
};

/**
 * 从文件导入配置（包含消息）
 * @param {File} file - 包含配置的 JSON 文件
 * @returns {Promise<Object>} 导入的配置对象
 */
export const importConfig = (file) => {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedConfig = JSON.parse(e.target.result);

          if (importedConfig.inputs && importedConfig.parameterEnabled) {
            // 如果导入的配置包含消息，也一起导入
            if (
              importedConfig.messages &&
              Array.isArray(importedConfig.messages)
            ) {
              saveMessages(importedConfig.messages);
            }

            resolve(importedConfig);
          } else {
            reject(new Error('配置文件格式无效'));
          }
        } catch (parseError) {
          reject(new Error('解析配置文件失败: ' + parseError.message));
        }
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    } catch (error) {
      reject(new Error('导入配置失败: ' + error.message));
    }
  });
};
