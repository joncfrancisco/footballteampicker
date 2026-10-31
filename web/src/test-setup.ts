import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom has no layout: report a fixed-width element and a narrow (phone-ish) viewport.
globalThis.ResizeObserver = class {
  constructor(private cb: ResizeObserverCallback) {}
  observe() {
    this.cb([{ contentRect: { width: 1000 } } as ResizeObserverEntry], this);
  }
  unobserve() {}
  disconnect() {}
};

window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;
