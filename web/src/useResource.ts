import { useEffect, useState } from "react";

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ value?: T; error?: Error }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({});
    load(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ value });
      },
      (error: Error) => {
        if (!controller.signal.aborted) setState({ error });
      },
    );
    return () => controller.abort();
  }, [load, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
