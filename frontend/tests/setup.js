if (!globalThis.window || !globalThis.window.localStorage || typeof globalThis.window.localStorage.clear !== 'function') {
  const memory = {};
  const storage = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    },
    setItem(key, value) {
      memory[key] = String(value);
    },
    removeItem(key) {
      delete memory[key];
    },
    clear() {
      Object.keys(memory).forEach((key) => delete memory[key]);
    },
    key(index) {
      return Object.keys(memory)[index] ?? null;
    },
    get length() {
      return Object.keys(memory).length;
    },
  };
  Object.defineProperty(globalThis.window, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}
