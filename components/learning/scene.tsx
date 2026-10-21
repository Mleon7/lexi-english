"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Check, ChevronRight, Headphones, Info, Mic, Music2, PenLine, Plus, Search, Trash2 } from "lucide-react";
import { parsePassage } from "@/lib/cloze";
import { type Passage, type Sense, type Notify } from "./types";
import { ApiError, request } from "./api";
import { Loading, Modal } from "./shared";
import { PassageReading } from "./scene-reading";
import { PassageCloze } from "./scene-cloze";

type SceneTab = "read" | "write";
const TABS = [{ id: "listen", title: "Listen", icon: Headphones }, { id: "speak", title: "Speak", icon: Mic }, { id: "read", title: "Read", icon: BookOpen }, { id: "write", title: "Recall", icon: PenLine }];

function stats(passage: Passage) {
  const lines = parsePassage(passage.text).filter(line => line.kind === "text");
  return { lines: lines.length, words: lines.reduce((sum, line) => sum + line.tokens.filter(token => token.word).length, 0) };
}

export function PassageSidebar({ passages, selected, loading, onSelect, onAdd }: { passages: Passage[]; selected?: string; loading: boolean; onSelect: (id: string) => void; onAdd: () => void }) {
  const [search, setSearch] = useState("");
  const shown = passages.filter(passage => `${passage.title} ${passage.author}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <div className="sidebar-heading"><span>My texts <b>{passages.length}</b></span><span className="sidebar-drag-note">Click to fold · drag to resize</span></div>
    <label className="search-field"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search title or artist" aria-label="Search texts" /><kbd>⌕</kbd></label>
    <button className="add-word" onClick={onAdd}><Plus size={17} />Add a text</button>
    <div className="sidebar-list"><div className="list-section-title">{passages.length ? "Words worth knowing" : "Start with a text"}<span>{passages.length ? `${shown.length} TEXTS` : "LYRICS · ARTICLES"}</span></div>
      {loading ? <div className="sidebar-skeleton"><span /><span /><span /></div> : shown.length ? shown.map(passage => <div className={`word-group ${passage.id === selected ? "selected" : ""}`} key={passage.id}><button className="word-item" onClick={() => onSelect(passage.id)}><span className="word-select-dot" /><span><strong>{passage.title}</strong><small>{passage.author || "No source"} · {stats(passage).lines} lines</small></span>{passage.id === selected && <ChevronRight size={15} />}</button></div>)
        : search ? <div className="sidebar-empty">Nothing matches “{search}”</div> : <p className="collection-note">A song you want to sing,<br />a text you want to understand.</p>}
    </div>
    <div className="sidebar-bottom"><div className="seed-icon"><Music2 size={22} /></div><p>In the words you love,<br /><strong>meet new ones.</strong></p><span className="sidebar-footer">LEXI <span>·</span> LEARN IN CONTEXT</span></div>
  </>;
}

export function Scene({ passage, senses, loading, onAdd, onEdit, onPassage, onSense, onOpenSense, onError, notify }: { passage?: Passage; senses: Sense[]; loading: boolean; onAdd: () => void; onEdit: () => void; onPassage: (p: Passage) => void; onSense: (s: Sense) => void; onOpenSense: (id: string) => void; onError: (e: unknown) => void; notify: Notify }) {
  const [tab, setTab] = useState<SceneTab>("read"); const [failed, setFailed] = useState<{ version: string; message: string } | null>(null);
  const started = useRef(new Set<string>());
  const version = passage ? `${passage.id}:${passage.updatedAt}` : "";
  // DeepSeek marks the fixed expressions once per version of a text: right after
  // it is saved, or the first time a text saved before this existed is opened.
  const findPhrases = useCallback((target: Passage, key: string) => {
    started.current.add(key);
    request<{ passage: Passage }>("passagePhrases", { passageId: target.id }).then(result => onPassage(result.passage), (err: unknown) => {
      if (err instanceof ApiError && err.code === "auth") onError(err);
      setFailed({ version: key, message: err instanceof Error ? err.message : "Phrases could not be marked. Please try again." });
    });
  }, [onPassage, onError]);
  useEffect(() => { if (passage && !passage.phrases && !started.current.has(version)) findPhrases(passage, version); }, [passage, version, findPhrases]);
  if (!passage) return <section className="lesson-card practice-card scene-empty"><div className="practice-empty"><span className="large-practice-icon"><Music2 size={32} strokeWidth={1.3} /></span><h3>Bring in a song you want to sing.</h3><p>Paste lyrics or any English text. While reading, tap a new word<br />to save it with the meaning it has in its line; while recalling,<br />fill in random blanks to make it stick.</p><button className="primary-button" disabled={loading} onClick={onAdd}><Plus size={16} />Add your first text</button></div></section>;
  const { lines, words } = stats(passage);
  const gathered = senses.filter(sense => sense.materials.some(item => item.source === passage.title)).length;
  return <>
    <section className="word-header scene-header"><div><div className="eyebrow word-eyebrow"><span className="little-dash" />REAL WORDS, REAL CONTEXT</div><div className="word-title-row"><h1>{passage.title}</h1>{passage.author && <span className="word-pronunciation">{passage.author}</span>}</div><div className="word-meaning"><span className="pos-tag">{lines} lines · {words} words</span><span>{gathered ? `${gathered} ${gathered === 1 ? "meaning" : "meanings"} collected from here` : "Tap a word to save the meaning it has in its line"}</span></div></div><button className="text-button scene-edit" onClick={onEdit}><PenLine size={14} />Edit text</button></section>
    <div className="skills-tabs" role="tablist" aria-label="Practice">{TABS.map(({ id, title, icon: Icon }) => { const soon = id === "listen" || id === "speak"; return <button key={id} role="tab" aria-selected={tab === id} disabled={soon} title={soon ? "Not open yet" : undefined} className={`skill-tab ${tab === id ? "active" : ""}`} onClick={() => { if (!soon) setTab(id as SceneTab); }}><Icon size={18} /><span>{title}</span>{soon && <em>Soon</em>}</button>; })}<span className="tab-end"><span />Understand first, then remember</span></div>
    <div role="tabpanel">{tab === "read" ? <PassageReading key={passage.id} passage={passage} phraseError={failed?.version === version ? failed.message : undefined} onRetryPhrases={() => { setFailed(null); findPhrases(passage, version); }} onSense={onSense} onOpenSense={onOpenSense} onError={onError} notify={notify} /> : <PassageCloze key={`${passage.id}-${passage.updatedAt}`} passage={passage} />}</div>
  </>;
}

export type LineOutcome = { lines?: "changed" | "unchanged" | "failed"; linesError?: string };

export function PassageEditor({ passage, close, onSaved, onDeleted, onError }: { passage?: Passage; close: () => void; onSaved: (p: Passage, outcome: LineOutcome) => void; onDeleted: (id: string) => void; onError: (e: unknown) => void }) {
  const [title, setTitle] = useState(passage?.title || ""); const [author, setAuthor] = useState(passage?.author || ""); const [text, setText] = useState(passage?.text || "");
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [confirming, setConfirming] = useState(false);
  // Pasted text is put one sentence per line by default; edits are usually deliberate line breaks.
  const [split, setSplit] = useState(!passage);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy("save"); setError("");
    try { const { passage: saved, ...outcome } = await request<{ passage: Passage } & LineOutcome>("passageSave", { ...(passage ? { passageId: passage.id } : {}), title: title.trim(), author: author.trim(), text, splitLines: split }); onSaved(saved, outcome); }
    catch (err) { setError(err instanceof Error ? err.message : "The text was not saved. Please try again."); onError(err); } finally { setBusy(""); }
  }
  async function remove() {
    if (!passage) return;
    if (!confirming) { setConfirming(true); return; }
    setBusy("delete"); setError("");
    try { await request("passageDelete", { passageId: passage.id }); onDeleted(passage.id); }
    catch (err) { setError(err instanceof Error ? err.message : "The text was not deleted. Please try again."); onError(err); } finally { setBusy(""); }
  }
  return <Modal title={passage ? "Edit this text" : "Bring in a text you want to read"} subtitle="Lyrics, scripts, articles: anything works. One sentence per line, an empty line between stanzas." close={close} wide><form onSubmit={event => void save(event)}>
    <label className="field-label" htmlFor="passage-title">Title</label><input id="passage-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Man in the Mirror" maxLength={80} required disabled={!!busy} autoComplete="off" />
    <label className="field-label" htmlFor="passage-author">Artist or source<span>Optional</span></label><input id="passage-author" value={author} onChange={event => setAuthor(event.target.value)} placeholder="e.g. Michael Jackson" maxLength={80} disabled={!!busy} autoComplete="off" />
    <label className="field-label" htmlFor="passage-text">English text<span>{text.length} / 5000</span></label><textarea id="passage-text" className="passage-input" value={text} onChange={event => setText(event.target.value)} placeholder={"[Verse 1]\nPaste the lyrics here, one line per line…"} rows={12} maxLength={5000} required disabled={!!busy} spellCheck={false} />
    <label className="split-option"><input type="checkbox" checked={split} onChange={event => setSplit(event.target.checked)} disabled={!!busy} /><span><strong>One sentence per line</strong><small>DeepSeek joins a sentence broken over several lines and splits a line that holds several sentences. Only line breaks move; every word stays as pasted.</small></span></label>
    <p className="settings-help"><Info size={15} />A line such as [Chorus] or [Verse 1] on its own marks a section. A repeated lyric line is blanked only once in recall practice. After saving, DeepSeek marks the phrases and collocations, and tapping one looks up the whole expression.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button className="primary-button full-width" type="submit" disabled={!!busy || !title.trim() || !text.trim()}>{busy === "save" ? <Loading label={split ? "Putting one sentence per line…" : "Saving"} /> : <>Save text <Check size={15} /></>}</button>
    {passage && <button type="button" className={`text-button passage-delete ${confirming ? "confirming" : ""}`} disabled={!!busy} onClick={() => void remove()}>{busy === "delete" ? <Loading label="Deleting" /> : <><Trash2 size={14} />{confirming ? "Click again to delete (words in your word book stay)" : "Delete this text"}</>}</button>}
  </form></Modal>;
}
