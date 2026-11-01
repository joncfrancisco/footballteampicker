import type { Team } from "@ftp/shared";
import { useState } from "react";
import type { LoadedList } from "../lists";
import { exportFilename, layoutsFor, renderTeam, type Layout } from "./render";

const canCopy = typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't encode PNG"))), "image/png"),
  );
}

/** Pick a layout, then download, copy or share it as a PNG. Entirely client-side. */
export function ExportMenu({ list, team }: { list: LoadedList; team: Team }) {
  const [chosen, setLayout] = useState<Layout>("field");
  const layout = layoutsFor(team).some((l) => l.id === chosen) ? chosen : "field";
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const png = async () => {
    const { canvas } = await renderTeam(team, list, layout);
    const blob = await toBlob(canvas);
    return { blob, name: exportFilename(team.title, layout) };
  };
  const run = (action: () => Promise<string | void>) => async () => {
    setBusy(true);
    setStatus("");
    try {
      setStatus((await action()) ?? "");
    } catch (e) {
      // A cancelled share sheet isn't an error worth showing.
      if ((e as Error).name !== "AbortError") setStatus(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const download = run(async () => {
    const { blob, name } = await png();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const copy = run(async () => {
    // Pass the promise straight in: Safari needs the clipboard call inside the click.
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png().then((p) => p.blob) }),
    ]);
    return "Copied";
  });
  const share = run(async () => {
    const { blob, name } = await png();
    await navigator.share({
      files: [new File([blob], name, { type: "image/png" })],
      title: team.title,
    });
  });
  const canShare =
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [new File([], "x.png", { type: "image/png" })] });

  return (
    <div className="export" role="group" aria-label="Export image">
      <label>
        Export{" "}
        <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
          {layoutsFor(team).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={download}>
        Download PNG
      </button>
      {canCopy && (
        <button type="button" disabled={busy} onClick={copy}>
          Copy image
        </button>
      )}
      {canShare && (
        <button type="button" disabled={busy} onClick={share}>
          Share
        </button>
      )}
      <span className="export-status" role="status">
        {status}
      </span>
    </div>
  );
}
