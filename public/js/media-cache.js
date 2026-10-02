/**
 * DragonMediaCache
 * High-performance IndexedDB Blob cache for video & audio.
 * Downloads entire media files into local device storage and serves them via blob: URLs.
 * During show playback, 0 network requests are made for media: only WebSocket sync packets!
 */
class DragonMediaCache {
  constructor(dbName = 'DragonEyesMediaCache_v1') {
    this.dbName = dbName;
    this.dbVersion = 1;
    this.db = null;
    this.activeBlobUrls = new Map();
  }

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) {
        console.warn('[MediaCache] IndexedDB not available, using in-memory mode');
        return resolve(null);
      }
      try {
        const req = indexedDB.open(this.dbName, this.dbVersion);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('blobs')) {
            db.createObjectStore('blobs', { keyPath: 'key' });
          }
        };
        req.onsuccess = (e) => {
          this.db = e.target.result;
          resolve(this.db);
        };
        req.onerror = () => {
          console.warn('[MediaCache] IndexedDB open error, using in-memory mode');
          resolve(null);
        };
      } catch (err) {
        console.warn('[MediaCache] IndexedDB exception:', err);
        resolve(null);
      }
    });
  }

  async getStored(key) {
    const db = await this.init();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('blobs', 'readonly');
        const store = tx.objectStore('blobs');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async putStored(key, blob, version = '') {
    const db = await this.init();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('blobs', 'readwrite');
        const store = tx.objectStore('blobs');
        const req = store.put({ key, blob, version, timestamp: Date.now() });
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Load media into local Blob URL.
   * If already cached and version matches, returns instantly from IndexedDB.
   * Otherwise downloads completely, stores in IndexedDB, and returns Blob URL.
   */
  async load(url, key, version = '', onProgress = () => {}) {
    // 1. Check local cache
    try {
      const cached = await this.getStored(key);
      if (cached && cached.blob && cached.blob.size > 1000) {
        if (!version || cached.version === String(version)) {
          console.log(`[MediaCache] ✅ Cache HIT for ${key} (${(cached.blob.size / (1024 * 1024)).toFixed(1)} Mo en local)`);
          onProgress(100);
          return this._createBlobUrl(key, cached.blob);
        }
      }
    } catch (e) {
      console.warn('[MediaCache] Read error:', e);
    }

    // 2. Download from network
    console.log(`[MediaCache] ⏳ Téléchargement et mise en cache de ${key} depuis ${url}...`);
    onProgress(5);

    const blob = await this._downloadBlobWithProgress(url, onProgress);

    // 3. Save to IndexedDB
    await this.putStored(key, blob, String(version));
    console.log(`[MediaCache] 💾 Sauvegardé en cache local : ${key} (${(blob.size / (1024 * 1024)).toFixed(1)} Mo)`);
    onProgress(100);

    return this._createBlobUrl(key, blob);
  }

  _createBlobUrl(key, blob) {
    if (this.activeBlobUrls.has(key)) {
      try {
        URL.revokeObjectURL(this.activeBlobUrls.get(key));
      } catch (e) {}
    }
    const blobUrl = URL.createObjectURL(blob);
    this.activeBlobUrls.set(key, blobUrl);
    return blobUrl;
  }

  _downloadBlobWithProgress(url, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';

      xhr.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          const percent = Math.min(99, Math.round((e.loaded / e.total) * 100));
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          reject(new Error(`Erreur HTTP ${xhr.status} sur ${url}`));
        }
      };

      xhr.onerror = () => reject(new Error(`Erreur réseau sur ${url}`));
      xhr.send();
    });
  }
}

window.DragonMediaCache = DragonMediaCache;
