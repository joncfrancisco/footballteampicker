import { useEffect, useState } from "react";

type Health = "checking" | "ok" | "down";

export function App() {
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => setHealth(r.ok ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);

  return (
    <main>
      <h1>Depth Chart</h1>
      <p>Build a football team from any roster of characters.</p>
      <p className="health" data-state={health}>
        API: {health}
      </p>
    </main>
  );
}
