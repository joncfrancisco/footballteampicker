import { useEffect, useRef } from "react";

type Widget = {
  render: (node: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Widget;
  }
}
let script: Promise<Widget> | undefined;
function loadWidget(): Promise<Widget> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  script ??= new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    el.async = true;
    el.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Verification unavailable"));
    el.onerror = () => {
      script = undefined;
      el.remove();
      reject(new Error("Verification unavailable"));
    };
    document.head.append(el);
  });
  return script;
}

export const siteKey: string | undefined =
  import.meta.env.VITE_TURNSTILE_SITE_KEY ||
  (import.meta.env.DEV ? "1x00000000000000000000AA" : undefined);

/** New widget for each write/retry: Turnstile tokens are single-use. */
export function Turnstile({
  onToken,
  onError,
}: {
  onToken: (token: string) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onToken, onError });
  callbacks.current = { onToken, onError };
  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    let widget: string | undefined;
    let api: Widget | undefined;
    loadWidget()
      .then((w) => {
        if (cancelled || !container.current) return;
        api = w;
        widget = w.render(container.current, {
          sitekey: siteKey,
          callback: (token: string) => callbacks.current.onToken(token),
          "expired-callback": () => callbacks.current.onToken(""),
          "error-callback": () => callbacks.current.onError("Verification failed. Please retry."),
        });
      })
      .catch(() => {
        if (!cancelled) callbacks.current.onError("Verification could not load. Please retry.");
      });
    return () => {
      cancelled = true;
      if (widget !== undefined) api?.remove(widget);
    };
  }, []);
  return <div ref={container} aria-label="Human verification" />;
}
