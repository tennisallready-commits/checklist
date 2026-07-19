(function () {
    "use strict";

    const DB_NAME = "ChecklistDB";
    const DB_VERSION = 1;
    const STORES = [
        "offline_tasks",
        "offline_categories",
        "offline_completions",
        "offline_category_shares",
        "offline_completions_queue",
        "offline_task_updates_queue",
        "user_term_associations",
        "user_function_associations"
    ];
    const OBJECT_STORES = new Set([
        "offline_completions_queue",
        "offline_task_updates_queue",
        "user_term_associations",
        "user_function_associations"
    ]);
    const CLOUD_SYNC_QUEUE_KEYS = new Set([
        "offline_tasks",
        "offline_categories",
        "offline_completions_queue",
        "offline_task_updates_queue"
    ]);
    const EMERGENCY_SNAPSHOT_KEYS = new Map([
        ["offline_categories", "checklist_snapshot_categories"],
        ["offline_tasks", "checklist_snapshot_tasks"],
        ["offline_completions", "checklist_snapshot_completions"]
    ]);

    function defaultValue(key) {
        return OBJECT_STORES.has(key) ? {} : [];
    }

    function create({ onStorageChange = () => {}, onCloudQueueChange = () => {} } = {}) {
        const dbCache = Object.fromEntries(STORES.map(key => [key, defaultValue(key)]));
        const localPrefs = window.localStorage;

        // A cópia write-through permite montar a primeira tela sem aguardar a
        // abertura assíncrona do IndexedDB. A reconciliação acontece depois.
        STORES.forEach(key => {
            const shadowValue = localPrefs.getItem(key);
            let parsedValue = null;
            if (shadowValue !== null) {
                try { parsedValue = JSON.parse(shadowValue); }
                catch (_) { parsedValue = shadowValue; }
            }
            const snapshotKey = EMERGENCY_SNAPSHOT_KEYS.get(key);
            const snapshotValue = snapshotKey ? localPrefs.getItem(snapshotKey) : null;
            if ((!Array.isArray(parsedValue) || parsedValue.length === 0) && snapshotValue !== null) {
                try {
                    const parsedSnapshot = JSON.parse(snapshotValue);
                    if (Array.isArray(parsedSnapshot) && parsedSnapshot.length) parsedValue = parsedSnapshot;
                } catch (_) {}
            }
            if (parsedValue !== null) dbCache[key] = parsedValue;
        });

        const idb = {
            _db: null,

            init() {
                return new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        console.warn("[idb] Timeout de 800ms ao inicializar IndexedDB. Continuando com localStorage...");
                        resolve();
                    }, 800);
                    try {
                        const request = indexedDB.open(DB_NAME, DB_VERSION);
                        request.onblocked = () => {
                            console.warn("[idb] Conexão com IndexedDB bloqueada por outra aba.");
                            clearTimeout(timeout);
                            resolve();
                        };
                        request.onerror = () => {
                            clearTimeout(timeout);
                            reject(request.error);
                        };
                        request.onsuccess = () => {
                            clearTimeout(timeout);
                            this._db = request.result;
                            resolve();
                        };
                        request.onupgradeneeded = () => {
                            const database = request.result;
                            if (!database.objectStoreNames.contains("key_value")) {
                                database.createObjectStore("key_value", { keyPath: "key" });
                            }
                        };
                    } catch (error) {
                        clearTimeout(timeout);
                        reject(error);
                    }
                });
            },

            get(key) {
                return new Promise((resolve, reject) => {
                    if (!this._db) return resolve(null);
                    const transaction = this._db.transaction("key_value", "readonly");
                    const request = transaction.objectStore("key_value").get(key);
                    request.onsuccess = () => resolve(request.result ? request.result.value : null);
                    request.onerror = () => reject(request.error);
                });
            },

            put(key, value) {
                return new Promise((resolve, reject) => {
                    if (!this._db) return resolve();
                    const transaction = this._db.transaction("key_value", "readwrite");
                    const request = transaction.objectStore("key_value").put({ key, value });
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            },

            delete(key) {
                return new Promise((resolve, reject) => {
                    if (!this._db) return resolve();
                    const transaction = this._db.transaction("key_value", "readwrite");
                    const request = transaction.objectStore("key_value").delete(key);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            },

            async loadAllToCache() {
                for (const store of STORES) {
                    let value = await this.get(store);
                    const legacyValue = localPrefs.getItem(store);
                    const hasWriteThroughVersion = localPrefs.getItem(`${store}__shadow_version`) !== null;
                    if (hasWriteThroughVersion && legacyValue !== null) {
                        try { value = JSON.parse(legacyValue); } catch (_) { value = legacyValue; }
                        await this.put(store, value);
                    } else if (value === null) {
                        if (legacyValue !== null) {
                            try { value = JSON.parse(legacyValue); } catch (_) { value = legacyValue; }
                            await this.put(store, value);
                        } else {
                            value = defaultValue(store);
                        }
                    }
                    const snapshotKey = EMERGENCY_SNAPSHOT_KEYS.get(store);
                    const snapshotValue = snapshotKey ? localPrefs.getItem(snapshotKey) : null;
                    if (Array.isArray(value) && value.length === 0 && snapshotValue !== null) {
                        try {
                            const parsedSnapshot = JSON.parse(snapshotValue);
                            if (Array.isArray(parsedSnapshot) && parsedSnapshot.length) {
                                value = parsedSnapshot;
                                localPrefs.setItem(store, snapshotValue);
                                localPrefs.setItem(`${store}__shadow_version`, String(Date.now()));
                                await this.put(store, value);
                            }
                        } catch (_) {}
                    }
                    dbCache[store] = value;
                }
            }
        };

        const localStorage = {
            getItem(key) {
                if (Object.prototype.hasOwnProperty.call(dbCache, key)) return JSON.stringify(dbCache[key]);
                return localPrefs.getItem(key);
            },
            setItem(key, value) {
                if (!Object.prototype.hasOwnProperty.call(dbCache, key)) {
                    localPrefs.setItem(key, value);
                    return;
                }
                let parsed = value;
                try { parsed = JSON.parse(value); } catch (_) {}
                dbCache[key] = parsed;
                localPrefs.setItem(key, String(value));
                localPrefs.setItem(`${key}__shadow_version`, String(Date.now()));
                const snapshotKey = EMERGENCY_SNAPSHOT_KEYS.get(key);
                if (snapshotKey) localPrefs.setItem(snapshotKey, String(value));
                void idb.put(key, parsed);
                onStorageChange(key);
                if (CLOUD_SYNC_QUEUE_KEYS.has(key)) onCloudQueueChange(key);
            },
            removeItem(key) {
                if (!Object.prototype.hasOwnProperty.call(dbCache, key)) {
                    localPrefs.removeItem(key);
                    return;
                }
                dbCache[key] = defaultValue(key);
                localPrefs.removeItem(key);
                localPrefs.removeItem(`${key}__shadow_version`);
                void idb.delete(key);
                onStorageChange(key);
            }
        };

        return { dbCache, idb, localPrefs, localStorage };
    }

    window.ChecklistStorage = Object.freeze({ create });
})();
