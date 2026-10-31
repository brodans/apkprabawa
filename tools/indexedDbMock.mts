/** Minimal IndexedDB mock for storage-focused Node tests. */
export function createIndexedDbMock(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) } as DOMStringList,
    createObjectStore(name: string) {
      stores.set(name, new Map());
      return {} as IDBObjectStore;
    },
    transaction(name: string) {
      const transaction = {
        oncomplete: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onabort: null as ((event: Event) => void) | null,
        objectStore() {
          const store = stores.get(name)!;
          return {
            get(key: IDBValidKey) {
              const request = {
                result: undefined as unknown,
                onsuccess: null as ((event: Event) => void) | null,
              };
              queueMicrotask(() => {
                request.result = store.get(String(key));
                request.onsuccess?.(new Event('success'));
                queueMicrotask(() => transaction.oncomplete?.(new Event('complete')));
              });
              return request as unknown as IDBRequest;
            },
            put(value: { akun: string }) {
              queueMicrotask(() => {
                store.set(value.akun, value);
                transaction.oncomplete?.(new Event('complete'));
              });
            },
            delete(key: IDBValidKey) {
              queueMicrotask(() => {
                store.delete(String(key));
                transaction.oncomplete?.(new Event('complete'));
              });
            },
          } as unknown as IDBObjectStore;
        },
      };
      return transaction as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;

  return {
    open() {
      const request = {
        result: database,
        onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
        onsuccess: null as ((event: Event) => void) | null,
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.(new Event('upgrade') as IDBVersionChangeEvent);
        request.onsuccess?.(new Event('success'));
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}