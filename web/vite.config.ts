/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// CloudFront's Free plan only allows managed response-header policies, so the CSP ships as a
// <meta>. Build only: the dev server injects an inline React Refresh script this would block.
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://footballteampicker-media-020949219706.s3.us-east-1.amazonaws.com",
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
        injectTo: "head-prepend",
      },
    ],
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  server: {
    port: 5173,
    // The local API serves both the write API and the published /m/* objects.
    proxy: {
      "/api": `http://localhost:${process.env.API_PORT ?? 8787}`,
      "/m": `http://localhost:${process.env.API_PORT ?? 8787}`,
    },
  },
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
