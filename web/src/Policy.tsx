import { useRef, useState } from "react";
import { siteKey, Turnstile } from "./Turnstile";
import { writeJson } from "./write";

export function About() {
  return (
    <section className="catalog policy">
      <h2>About Depth Chart</h2>
      <p>
        Pick a character list, build a football depth chart, and share your lineup by link or image.
        There are no accounts, ads, paywalls, or donations.
      </p>
      <h3>Content rules</h3>
      <p>
        Use portraits you have permission to share. No explicit sexual content, hateful content,
        harassment, personal images, or private information. Do not impersonate other people or
        upload content to target them.
      </p>
      <p>
        Fan art and third-party characters are common in character lists. We honor takedown requests
        within days. A list can be hidden while reports are reviewed; saved team links may also be
        removed when they contain prohibited content.
      </p>
      <h3>Report a problem</h3>
      <p>
        Use Report on any list or shared team and describe the problem. Reports are private.
        Repeated reports from the same network count once while a report is open.
      </p>
      <p>
        For urgent issues, copyright/DMCA requests, or an appeal,{" "}
        <a href="mailto:joncfrancisco@gmail.com?subject=Depth%20Chart%20takedown">
          contact the site owner
        </a>
        . Include the list or team link and enough detail to identify the content and your request.
      </p>
      <h3>League of Legends assets</h3>
      <p>
        Depth Chart was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by
        Riot Games. Riot Games does not endorse or sponsor this project.
      </p>
    </section>
  );
}

export function ReportPage() {
  const params = new URLSearchParams(location.search);
  const type = params.get("type");
  const id = params.get("id") ?? "";
  const valid = ["list", "team"].includes(type ?? "") && /^[A-Za-z0-9_-]{1,64}$/.test(id);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const consumed = useRef(false);
  async function submit(token: string) {
    if (!token || consumed.current) return;
    consumed.current = true;
    setPending(false);
    setBusy(true);
    try {
      await writeJson(
        "/api/reports",
        { targetType: type, targetId: id, reason: reason.trim() },
        token,
      );
      setSent(true);
    } catch {
      setError(
        "Your report could not be sent. Try again, or contact the site owner for urgent issues.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!valid)
    return (
      <section className="catalog">
        <h2>Choose something to report</h2>
        <p>Open a list or shared team, then use its Report link.</p>
        <a href="/browse">Browse lists</a>
      </section>
    );
  return (
    <section className="catalog policy">
      <h2>Report this {type}</h2>
      {sent ? (
        <p role="status">Thank you. Your report was received and will be reviewed.</p>
      ) : (
        <>
          <label>
            Describe the problem
            <textarea
              maxLength={500}
              value={reason}
              disabled={busy || pending}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p>
            Do not include private information. <a href="/about">Read the content rules</a>.
          </p>
          <button
            disabled={!reason.trim() || busy || pending}
            onClick={() => {
              setError("");
              if (!siteKey) {
                setError("Reporting is temporarily unavailable. Please contact the site owner.");
                return;
              }
              consumed.current = false;
              setPending(true);
            }}
          >
            {busy ? "Sending…" : "Send report"}
          </button>
          {pending && (
            <>
              <Turnstile
                onToken={submit}
                onError={(message) => {
                  setPending(false);
                  setError(message);
                }}
              />
              <button onClick={() => setPending(false)}>Cancel report</button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
      <p>
        <a href={`/${type === "list" ? "l" : "t"}/${id}`}>Return to the {type}</a> ·{" "}
        <a href="mailto:joncfrancisco@gmail.com?subject=Depth%20Chart%20report">
          Contact the site owner
        </a>
      </p>
    </section>
  );
}
