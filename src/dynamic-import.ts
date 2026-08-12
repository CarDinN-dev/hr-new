type DynamicImportRecovery = {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
};

const retryKeyPrefix = "medtech:dynamic-import-retry:";

function browserRecovery(): DynamicImportRecovery {
  return {
    storage: window.sessionStorage,
    reload: () => window.location.reload()
  };
}

export function importWithReleaseRetry<T>(moduleName: string, load: () => Promise<T>, recovery = browserRecovery()): Promise<T> {
  return load().catch(error => {
    const retryKey = `${retryKeyPrefix}${moduleName}:${error instanceof Error ? error.message : String(error)}`;

    try {
      if (recovery.storage.getItem(retryKey) !== null) return Promise.reject(error);
      recovery.storage.setItem(retryKey, "1");
      recovery.reload();
      // ponytail: one retry per failed release asset prevents reload loops without release state.
      return new Promise<T>(() => undefined);
    } catch {
      return Promise.reject(error);
    }
  });
}
