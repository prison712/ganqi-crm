import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.has(String(key)) ? values.get(String(key)) : null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => values.delete(String(key)),
    setItem: (key, value) => values.set(String(key), String(value))
  };
}

const localStorageMock = memoryStorage();
const sessionStorageMock = memoryStorage();
Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageMock });
Object.defineProperty(window, 'sessionStorage', { configurable: true, value: sessionStorageMock });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: sessionStorageMock });

afterEach(() => cleanup());

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; }
  })
});

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const nativeGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = element => nativeGetComputedStyle(element);
