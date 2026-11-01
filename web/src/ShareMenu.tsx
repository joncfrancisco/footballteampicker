import type { Team } from "@ftp/shared";
import { useEffect, useRef, useState } from "react";
import { draftKey } from "./draft";
import type { LoadedList } from "./lists";
import { siteKey, Turnstile } from "./Turnstile";
import { writeJson, WriteError } from "./write";

export function ShareLink({ url }: { url: string }) {
  const [status, setStatus] = useState("");
  return (
    <div className="share-link">
      <label>
        Share link <input readOnly value={url} onFocus={(e) => e.target.select()} />
      </label>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setStatus("Link copied");
          } catch {
            setStatus("Select the link above to copy it.");
          }
        }}
      >
        Copy link
      </button>
      {typeof navigator.share === "function" && (
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.share({ url });
            } catch (e) {
              if ((e as Error).name !== "AbortError") setStatus("Could not open the share sheet.");
            }
          }}
        >
          Share link
        </button>
      )}
      <span role="status">{status}</span>
    </div>
  );
}

type Task = { body: Team & { listVersion: number }; key: string; attempt: number };
export function ShareMenu({ team, list }: { team: Team; list: LoadedList }) {
  const [task, setTask] = useState<Task>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ key: string; id: string }>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const active = useRef(true);
  const consuming = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const body = { ...team, listVersion: list.version };
  const sharedKey = draftKey(list.id, team.sport).replace("ftp:draft:", "ftp:shared:");
  const key = JSON.stringify(body);
  function begin() {
    if (saved?.key === key) return;
    try {
      const previous = JSON.parse(localStorage.getItem(sharedKey) ?? "null") as typeof saved;
      if (previous?.key === key && /^[A-Za-z0-9]{10}$/.test(previous.id)) {
        setSaved(previous);
        return;
      }
    } catch {
      /* Sharing works without local storage. */
    }
    setError("");
    consuming.current = false;
    setTask({ body, key, attempt: 0 });
  }
  async function submit(token: string) {
    if (!token || !task || consuming.current) return;
    consuming.current = true;
    const current = task;
    setTask(undefined);
    setBusy(true);
    try {
      const result = await writeJson("/api/teams", current.body, token);
      if (!result.id || !/^[A-Za-z0-9]{10}$/.test(result.id))
        throw new Error("Invalid share response");
      if (!active.current) return;
      const next = { key: current.key, id: result.id };
      setSaved(next);
      try {
        localStorage.setItem(sharedKey, JSON.stringify(next));
      } catch {
        /* Link remains visible. */
      }
      setBusy(false);
    } catch (e) {
      if (!active.current) return;
      if (e instanceof WriteError && [429, 503].includes(e.status) && current.attempt < 3) {
        timer.current = setTimeout(
          () => {
            if (!active.current) return;
            setBusy(false);
            consuming.current = false;
            setTask({ ...current, attempt: current.attempt + 1 });
          },
          500 * 2 ** current.attempt + Math.random() * 400,
        );
      } else {
        setBusy(false);
        setError((e as Error).message);
      }
    }
  }
  return (
    <section aria-label="Share team" className="share-menu">
      <button type="button" disabled={busy || !!task} onClick={begin}>
        {busy ? "Saving team…" : "Share team"}
      </button>
      {task &&
        (siteKey ? (
          <>
            <p>Complete the verification to share your team.</p>
            <Turnstile
              key={task.attempt}
              onToken={submit}
              onError={(message) => {
                setTask(undefined);
                setError(message);
              }}
            />
          </>
        ) : (
          <p role="status">
            Sharing is paused, try again later. Your draft is saved in this browser; you can export
            an image.
          </p>
        ))}
      {task && (
        <button type="button" onClick={() => setTask(undefined)}>
          Cancel sharing
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {saved?.key === key && <ShareLink url={`${location.origin}/t/${saved.id}`} />}
    </section>
  );
}
