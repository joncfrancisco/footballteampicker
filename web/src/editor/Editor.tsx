import { ListInput, type ListInput as ListBody } from "@ftp/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadList, SEED_LISTS, type LoadedList } from "../lists";
import { editToken, rememberList } from "../ownership";
import { ShareLink } from "../ShareMenu";
import { siteKey, Turnstile } from "../Turnstile";
import { useResource } from "../useResource";
import { writeJson, WriteError } from "../write";
import {
  buildAtlas,
  drawPortrait,
  emptyCrop,
  filePortrait,
  namedCharacter,
  slicePortraits,
  type EditorCharacter,
} from "./atlas";

export function EditorPage({ id, remix }: { id?: string; remix?: string }) {
  // Fragments are never sent to the server. Remove them after saving the token locally.
  const [token] = useState(() => {
    const fragment = new URLSearchParams(location.hash.slice(1)).get("token");
    if (id && fragment) {
      rememberList(id, fragment);
      history.replaceState(null, "", location.pathname + location.search);
    }
    return id ? (fragment ?? editToken(id)) : undefined;
  });
  const load = useCallback(
    async (signal: AbortSignal) => {
      const source = id ?? remix;
      const list = source ? await loadList(source, signal) : undefined;
      return { list, characters: list ? await slicePortraits(list) : [] };
    },
    [id, remix],
  );
  const { value, error, retry } = useResource(load);
  if (id && !token)
    return (
      <section className="catalog">
        <h2>Open your edit link</h2>
        <p>
          Use the full edit link you saved, including its token after the #. Edit links cannot be
          recovered.
        </p>
        <a href={`/l/${id}`}>View this list</a>
      </section>
    );
  if (error)
    return (
      <p role="alert">
        Could not load the list and its portraits. <button onClick={retry}>Retry</button>
      </p>
    );
  if (!value) return <p role="status">Loading editor…</p>;
  return <Editor initial={value.list} characters={value.characters} id={id} token={token} />;
}

type Saved = { id: string; version: number; token: string };
function Editor({
  initial,
  characters: initialCharacters,
  id,
  token,
}: {
  initial?: LoadedList;
  characters: EditorCharacter[];
  id?: string;
  token?: string;
}) {
  const [characters, setCharacters] = useState(initialCharacters);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [ip, setIp] = useState(initial?.ip ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [visibility, setVisibility] = useState<"public" | "unlisted">(
    initial?.visibility ?? "unlisted",
  );
  const [names, setNames] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [cropping, setCropping] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState<Saved | undefined>(
    id && token ? { id, version: initial!.version, token } : undefined,
  );
  const seedId =
    initial && (SEED_LISTS.some((s) => s.id === initial.id) ? initial.id : initial.seedId);
  const max = seedId
    ? Math.max(150, SEED_LISTS.find((s) => s.id === seedId)?.characters.length ?? 150)
    : 150;
  const [atlas, setAtlas] = useState<ListBody["atlas"] | undefined>(
    () =>
      initial && {
        ...initial.atlas,
        key:
          initial.version === 0
            ? `m/seeds/${initial.id}/${initial.atlas.src}`
            : initial.atlas.src.slice(1),
      },
  );
  const [dirty, setDirty] = useState(!initial);
  const verification = useRef<{ resolve: (token: string) => void; reject: (error: Error) => void }>(
    undefined,
  );
  const [challenge, setChallenge] = useState(0);
  const [verifying, setVerifying] = useState(false);
  useEffect(() => () => verification.current?.reject(new Error("Save cancelled")), []);

  const shown = characters.filter(
    (c) =>
      (!query || c.name.toLowerCase().includes(query.toLowerCase())) &&
      (!tag || c.tags.includes(tag)),
  );
  const twoWay = characters.filter((c) => c.twoWay).length;
  const allTags = [...new Set(characters.flatMap((c) => c.tags))].sort();
  const change = (next: EditorCharacter, imageChange = false) => {
    setCharacters((items) => items.map((c) => (c.id === next.id ? next : c)));
    if (imageChange || !next.portrait) setDirty(true);
  };
  function bulk(twoWay: boolean, filtered: boolean) {
    const ids = new Set((filtered ? shown : characters).map((c) => c.id));
    setCharacters((items) => items.map((c) => (ids.has(c.id) ? { ...c, twoWay } : c)));
  }
  function addNames() {
    const add = names
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (characters.length + add.length > max) {
      setError(`This list can have at most ${max} characters.`);
      return;
    }
    setCharacters([
      ...characters,
      ...add.map((name, i) => namedCharacter(name, characters.length + i)),
    ]);
    setNames("");
    setDirty(true);
    setError("");
  }
  async function addImages(files: FileList | File[]) {
    if (characters.length + files.length > max) {
      setError(`This list can have at most ${max} characters.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const add: EditorCharacter[] = [];
      for (const file of Array.from(files))
        add.push({
          ...namedCharacter(
            file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
            characters.length + add.length,
          ),
          portrait: await filePortrait(file),
        });
      setCharacters([...characters, ...add]);
      setDirty(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function human(): Promise<string> {
    setChallenge((n) => n + 1);
    setVerifying(true);
    return new Promise((resolve, reject) => {
      verification.current = { resolve, reject };
    });
  }
  function verified(token: string) {
    if (!token) return;
    const pending = verification.current;
    verification.current = undefined;
    setVerifying(false);
    pending?.resolve(token);
  }
  function verificationFailed(message: string) {
    const pending = verification.current;
    verification.current = undefined;
    setVerifying(false);
    pending?.reject(new Error(message));
  }
  async function save() {
    setError("");
    setStatus("");
    if (!siteKey) {
      setError("Saving is paused, try again later. Keep this page open to preserve your work.");
      return;
    }
    const body = {
      title,
      ip,
      description,
      tags: splitTags(tags),
      visibility,
      ...(seedId ? { seedId } : {}),
      ...(saved ? { baseVersion: saved.version } : {}),
      atlas: dirty
        ? { key: "tmp/preview", tile: 128, columns: 16, count: characters.length }
        : atlas,
      characters: characters.map(({ portrait: _p, crop: _c, ...c }, i) => ({
        ...c,
        atlasIndex: dirty ? i : c.atlasIndex,
      })),
    };
    const parsed = ListInput.safeParse(body);
    if (!parsed.success) {
      setError(
        "Check the list details: use 11–150 characters (seed remixes may keep their original roster), a title and game, and non-empty names under 40 characters. Use up to 10 tags per character and 20 list tags.",
      );
      return;
    }
    setBusy(true);
    try {
      const input = parsed.data;
      if (dirty) {
        setStatus("Building portrait atlas…");
        const blob = await buildAtlas(characters);
        setStatus("Verify to upload portraits.");
        const grant = await writeJson("/api/uploads", { contentType: blob.type }, await human());
        if (!grant.url || !grant.fields || !grant.key || !grant.uploadToken)
          throw new Error("Could not start the upload.");
        const uploadUrl = new URL(grant.url, location.origin);
        const allowed =
          uploadUrl.origin === location.origin ||
          (uploadUrl.protocol === "https:" &&
            uploadUrl.hostname ===
              "footballteampicker-media-020949219706.s3.us-east-1.amazonaws.com");
        if (!allowed) throw new Error("Invalid upload destination.");
        const form = new FormData();
        Object.entries(grant.fields).forEach(([key, value]) => form.append(key, value));
        form.append("file", blob, blob.type === "image/webp" ? "atlas.webp" : "atlas.jpg");
        setStatus("Uploading portrait atlas…");
        const result = await fetch(uploadUrl, { method: "POST", body: form });
        if (!result.ok) throw new Error("Portrait upload failed. Please try saving again.");
        input.atlas.key = grant.key;
        input.uploadToken = grant.uploadToken;
      }
      setStatus("Verify to save your list.");
      const result = await writeJson(
        saved ? `/api/lists/${saved.id}` : "/api/lists",
        input,
        await human(),
        saved ? { method: "PUT", editToken: saved.token } : {},
      );
      const edit = result.editToken ?? saved?.token;
      if (!result.id || !result.version || !result.atlas || !edit)
        throw new Error("The save response was incomplete. Keep this page open.");
      rememberList(result.id, edit);
      setSaved({ id: result.id, token: edit, version: result.version });
      setAtlas(result.atlas);
      setDirty(false);
      setCharacters((items) =>
        items.map((c, i) => ({ ...c, atlasIndex: dirty ? i : c.atlasIndex })),
      );
      history.replaceState(null, "", `/l/${result.id}/edit`);
      setStatus("List saved. Changes can take up to a minute to appear to other visitors.");
    } catch (e) {
      setError(
        e instanceof WriteError && [429, 503].includes(e.status)
          ? "Saving is paused, try again later. Keep this page open to preserve your work."
          : e instanceof WriteError && e.status === 409
            ? "This list has a newer version. Copy your changes before reloading."
            : (e as Error).message,
      );
      setStatus("");
    } finally {
      setBusy(false);
    }
  }
  const crop = characters.find((c) => c.id === cropping);
  return (
    <section className="list-editor">
      <h2>
        {saved
          ? "Edit character list"
          : initial
            ? "Remix character list"
            : "Create a character list"}
      </h2>
      <p>
        Two-way players can fill one offense and one defense spot. Everyone else plays once per
        team.
      </p>
      {initial?.disclaimer && <p className="card-disclaimer">{initial.disclaimer}</p>}
      <fieldset disabled={busy}>
        <div className="editor-meta">
          <label>
            List title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              required
            />
          </label>
          <label>
            Game / IP
            <input value={ip} onChange={(e) => setIp(e.target.value)} maxLength={80} required />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </label>
          <label>
            List tags (comma separated)
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label>
            Visibility
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as typeof visibility)}
            >
              <option value="unlisted">Unlisted — only people with the link</option>
              <option value="public">Public — show in browse</option>
            </select>
          </label>
        </div>
        <div
          className="image-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void addImages(e.dataTransfer.files);
          }}
        >
          <label>
            Add portrait images (or drop files here)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              multiple
              onChange={(e) => {
                if (e.target.files) void addImages(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <label>
          Paste character names, one per line
          <textarea value={names} onChange={(e) => setNames(e.target.value)} />
        </label>
        <button type="button" onClick={addNames}>
          Add names
        </button>
        <p>
          {twoWay} of {characters.length} are two-way · {characters.length} / {max} characters
        </p>
        {characters.length + twoWay < 22 && (
          <p className="notice">
            This roster may not fill all 22 offense and defense spots. Add more characters or enable
            two-way players.
          </p>
        )}
        <div className="actions">
          <label>
            Filter characters
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label>
            Filter by tag
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => bulk(true, false)}>
            All two-way on
          </button>
          <button type="button" onClick={() => bulk(false, false)}>
            All two-way off
          </button>
          <button type="button" onClick={() => bulk(true, true)}>
            Filtered two-way on
          </button>
          <button type="button" onClick={() => bulk(false, true)}>
            Filtered two-way off
          </button>
        </div>
        <div className="editor-characters">
          {shown.map((c) => (
            <article key={c.id} className="editor-character" aria-label={`Character ${c.name}`}>
              <Portrait character={c} />
              <label>
                Name
                <input
                  aria-label={`Name for ${c.name}`}
                  value={c.name}
                  maxLength={40}
                  onChange={(e) => change({ ...c, name: e.target.value })}
                />
              </label>
              <label>
                Subtitle
                <input
                  value={c.subtitle ?? ""}
                  maxLength={60}
                  onChange={(e) => change({ ...c, subtitle: e.target.value })}
                />
              </label>
              <label>
                Tags
                <input
                  value={c.tags.join(", ")}
                  onChange={(e) =>
                    change({ ...c, tags: e.target.value.split(",").map((s) => s.trim()) })
                  }
                  onBlur={() => change({ ...c, tags: c.tags.filter(Boolean) })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={c.twoWay}
                  onChange={(e) => change({ ...c, twoWay: e.target.checked })}
                />
                2W
              </label>
              <label className="portrait-upload">
                Change image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      change({ ...c, portrait: await filePortrait(file), crop: emptyCrop() }, true);
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                />
              </label>
              <button type="button" disabled={!c.portrait} onClick={() => setCropping(c.id)}>
                Crop
              </button>
              <button
                type="button"
                onClick={() => {
                  setCharacters((items) => items.filter((item) => item.id !== c.id));
                  setDirty(true);
                }}
              >
                Remove
              </button>
            </article>
          ))}
        </div>
      </fieldset>
      <button type="button" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save list"}
      </button>
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      {verifying && (
        <>
          <Turnstile key={challenge} onToken={verified} onError={verificationFailed} />
          <button onClick={() => verificationFailed("Save cancelled. Your work is still here.")}>
            Cancel save
          </button>
        </>
      )}
      {saved && (
        <section>
          <h3>Keep your edit link</h3>
          <p>This link lets anyone edit your list. It cannot be recovered if you lose it.</p>
          <label>
            Edit link
            <input
              readOnly
              value={`${location.origin}/l/${saved.id}/edit#token=${saved.token}`}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${location.origin}/l/${saved.id}/edit#token=${saved.token}`,
                );
                setStatus("Edit link copied.");
              } catch {
                setStatus("Select the edit link above to copy it.");
              }
            }}
          >
            Copy edit link
          </button>
          <ShareLink url={`${location.origin}/l/${saved.id}`} />
          <a href={`/l/${saved.id}`}>View saved list</a>
        </section>
      )}
      {crop && (
        <Crop
          character={crop}
          onChange={(c) => change(c, true)}
          onClose={() => setCropping(undefined)}
        />
      )}
    </section>
  );
}

const splitTags = (text: string) =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
function Portrait({ character }: { character: EditorCharacter }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawPortrait(ref.current, character);
  }, [character]);
  return (
    <canvas
      ref={ref}
      width={128}
      height={128}
      className="editor-portrait"
      aria-label={`Portrait of ${character.name}`}
    />
  );
}
function Crop({
  character,
  onChange,
  onClose,
}: {
  character: EditorCharacter;
  onChange: (c: EditorCharacter) => void;
  onClose: () => void;
}) {
  const drag = useRef<{ x: number; y: number }>(undefined);
  const adjust = (key: keyof EditorCharacter["crop"], value: number) =>
    onChange({ ...character, crop: { ...character.crop, [key]: value } });
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Crop ${character.name}`}
      className="crop-dialog"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <h3>Crop {character.name}</h3>
      <div
        className="crop-preview"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const previous = drag.current;
          drag.current = { x: e.clientX, y: e.clientY };
          onChange({
            ...character,
            crop: {
              ...character.crop,
              x: clamp(character.crop.x + (e.clientX - previous.x) / 80),
              y: clamp(character.crop.y + (e.clientY - previous.y) / 80),
            },
          });
        }}
      >
        <Portrait character={character} />
      </div>
      <p>Drag to position the portrait, or use the controls.</p>
      <label>
        Zoom
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={character.crop.zoom}
          onChange={(e) => adjust("zoom", Number(e.target.value))}
        />
      </label>
      <label>
        Horizontal position
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={character.crop.x}
          onChange={(e) => adjust("x", Number(e.target.value))}
        />
      </label>
      <label>
        Vertical position
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={character.crop.y}
          onChange={(e) => adjust("y", Number(e.target.value))}
        />
      </label>
      <button onClick={onClose}>Done cropping</button>
    </div>
  );
}
const clamp = (n: number) => Math.min(1, Math.max(-1, n));
