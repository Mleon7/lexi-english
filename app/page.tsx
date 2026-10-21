"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ArrowRight, AudioLines, BookOpen, Check, ChevronRight, CircleHelp, Headphones, Info, Languages, Leaf, Mic, MoveHorizontal, Music2, PenLine, Plus, Search, Settings2, ShieldCheck, Sparkles, Sprout, X, Repeat2 } from "lucide-react";
import Link from "next/link";
import { type Sense, type AppState, type Choice, type Passage, type Tab } from "@/components/learning/types";
import { ApiError, request } from "@/components/learning/api";
import { Loading, Modal, Tip } from "@/components/learning/shared";
import { Read } from "@/components/learning/reading";
import { Writing } from "@/components/learning/writing";
import { Listening } from "@/components/learning/listening";
import { Review } from "@/components/learning/review";
import { PassageEditor, PassageSidebar, Scene, type LineOutcome } from "@/components/learning/scene";

const DEMO: Sense = { id: "preview", word: "resilient", phonetic: "/rɪˈzɪliənt/", pos: "adjective", meaning: "有韧性的；能迅速恢复的", definition: "Able to become strong, healthy, or happy again after something difficult happens.", learned: false, mastery: 0, reviewCount: 0, createdAt: 0, materials: [
  { id: "d1", kind: "description", text: "Able to become strong, healthy, or happy again after something difficult happens." },
  { id: "e1", kind: "example", text: "Like a tree that bends in the wind, a resilient person finds a way to keep growing." },
  { id: "e2", kind: "example", text: "The community proved remarkably resilient after the storm." },
  { id: "e3", kind: "example", text: "Small daily habits can help you become more resilient in the face of change." },
  { id: "s1", kind: "synonym", term: "strong", relationNote: "近义表达 · 强大的，坚强的", text: "She stayed strong even when things did not go as planned." },
  { id: "a1", kind: "antonym", term: "fragile", relationNote: "反义表达 · 脆弱的", text: "His confidence was fragile after a series of setbacks." },
] };

const TABS = [{ id: "listen", title: "Listen", icon: Headphones }, { id: "speak", title: "Speak", icon: Mic }, { id: "read", title: "Read", icon: BookOpen }, { id: "write", title: "Write", icon: PenLine }];
const DEFAULT_SIDEBAR_WIDTH = 245;
const SIDEBAR_DRAG_THRESHOLD = 5;

function subscribeToViewport(callback: () => void) {
  const query = window.matchMedia("(max-width: 760px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function narrowViewport() { return window.matchMedia("(max-width: 760px)").matches; }

function serverViewport() { return false; }

export default function Home() {
  const isNarrow = useSyncExternalStore(subscribeToViewport, narrowViewport, serverViewport);
  const [state, setState] = useState<AppState | null>(null); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState("preview"); const [tab, setTab] = useState<Tab>("read"); const [view, setView] = useState<"learn" | "scene" | "review">("learn"); const [passageId, setPassageId] = useState(""); const [editing, setEditing] = useState<Passage | "new" | null>(null); const [sidebar, setSidebar] = useState<boolean | null>(null); const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH); const [search, setSearch] = useState(""); const [add, setAdd] = useState(false); const [settings, setSettings] = useState(false); const [error, setError] = useState<{ message: string; auth?: boolean } | null>(null); const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => setToast(message), []);
  const report = useCallback((err: unknown) => { setError({ message: err instanceof Error ? err.message : "The connection dropped. Please try again.", auth: err instanceof ApiError && err.code === "auth" }); }, []);
  const refresh = useCallback(async () => { try { const value = await request<AppState>(); setState(value); setError(null); return value; } catch (err) { report(err); } finally { setLoading(false); } }, [report]);
  useEffect(() => {
    let active = true;
    void request<AppState>().then(value => {
      if (active) { setState(value); setError(null); }
    }).catch(err => { if (active) report(err); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [report]);
  useEffect(() => { if (toast) { const id = window.setTimeout(() => setToast(""), 4000); return () => window.clearTimeout(id); } }, [toast]);
  const saved = state?.senses.filter((sense) => sense.learned) || []; const sense = saved.find((item) => item.id === selected) || saved[0] || DEMO; const isDemo = sense.id === "preview"; const words = Array.from(new Set(saved.map((item) => item.word))).filter((word) => word.toLowerCase().includes(search.toLowerCase()));
  const passages = state?.passages || []; const passage = passages.find((item) => item.id === passageId) || passages[0];
  const updateSense = (updated: Sense) => { setState((old) => old ? { ...old, senses: old.senses.some((s) => s.id === updated.id) ? old.senses.map((s) => s.id === updated.id ? updated : s) : [...old.senses, updated] } : old); };
  const addClose = useCallback(() => setAdd(false), []); const editorClose = useCallback(() => setEditing(null), []); const settingsClose = useCallback(() => setSettings(false), []);
  const requireWord = useCallback(() => { setAdd(true); notify("Add a word you want to learn to get started."); }, [notify]);
  const selectWord = (id: string) => { setSelected(id); setView("learn"); if (window.innerWidth <= 760) setSidebar(false); };
  const sideVisible = (sidebar ?? !isNarrow) && view !== "review";
  const openSense = (id: string) => { setSelected(id); setView("learn"); setTab("read"); };
  const savePassage = (saved: Passage, outcome: LineOutcome) => { setState((old) => old ? { ...old, passages: old.passages.some((p) => p.id === saved.id) ? old.passages.map((p) => p.id === saved.id ? saved : p) : [saved, ...old.passages] } : old); setPassageId(saved.id); setEditing(null); const done = editing === "new" ? `Added “${saved.title}”` : "Text updated";
    notify(outcome.lines === "changed" ? `${done}, one sentence per line` : outcome.lines === "failed" ? `${done} as pasted; the lines could not be split (${outcome.linesError})` : editing === "new" ? `${done}. Tap a word to start reading` : done); };
  const updatePassage = useCallback((updated: Passage) => { setState((old) => old ? { ...old, passages: old.passages.map((p) => p.id === updated.id ? updated : p) } : old); }, []);
  const deletePassage = (id: string) => { setState((old) => old ? { ...old, passages: old.passages.filter((p) => p.id !== id) } : old); setEditing(null); notify("Text deleted. The words in your word book are still there"); };
  return <div className="app-shell">
    <header className="topbar"><Link href="/" className="brand" aria-label="Lexi home"><span className="brand-icon"><BookOpen size={22} strokeWidth={1.7} /><span /></span><span>Lexi<span className="brand-en">in context</span></span></Link><nav className="main-nav" aria-label="Main"><button className={view === "learn" ? "active" : ""} onClick={() => { setView("learn"); setSidebar(true); }}><BookOpen size={16} />Learn</button><button className={view === "scene" ? "active" : ""} onClick={() => { setView("scene"); setSidebar(true); }}><Music2 size={16} />Real Scenes</button><button className={view === "review" ? "active" : ""} onClick={() => setView("review")}><Repeat2 size={16} />Review{saved.length > 0 && <span className="nav-count">{saved.length}</span>}</button></nav><div className="topbar-end"><span className="topbar-note"><span className="status-dot" />Grow a little every day</span><button className="icon-button settings-button" onClick={() => setSettings(true)} aria-label="Study and model settings"><Settings2 size={18} /></button><span className="avatar" aria-label="Your account">{state?.user.displayName?.slice(0, 1).toUpperCase() || "L"}</span></div></header>
    <div className={`workspace ${sideVisible ? "" : "sidebar-collapsed"}`} style={{ "--sidebar-width": `${sideVisible ? sidebarWidth : 0}px` } as CSSProperties}>
      {view !== "review" && <SidebarDrag open={sideVisible} width={sidebarWidth} onChange={width => { setSidebar(width > 0); if (width > 0) setSidebarWidth(width); }} />}
      {sideVisible && view === "scene" && <aside id="word-sidebar" className="word-sidebar"><PassageSidebar passages={passages} selected={passage?.id} loading={loading} onAdd={() => setEditing("new")} onSelect={(id) => { setPassageId(id); if (window.innerWidth <= 760) setSidebar(false); }} /></aside>}
      {sideVisible && view === "learn" && <aside id="word-sidebar" className="word-sidebar"><div className="sidebar-heading"><span>My word book <b>{saved.length}</b></span><span className="sidebar-drag-note">Click to fold · drag to resize</span></div><label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your words" aria-label="Search words" /><kbd>⌕</kbd></label><button className="add-word" onClick={() => setAdd(true)}><Plus size={17} />Add a word</button><div className="sidebar-list"><div className="list-section-title">{saved.length ? "Collecting" : "Start with one word"}<span>{saved.length ? `${words.length} WORDS` : "YOUR COLLECTION"}</span></div>{loading ? <div className="sidebar-skeleton"><span /><span /><span /></div> : words.length ? words.map((word) => { const group = saved.filter((s) => s.word === word); const active = sense.word === word; return <div className={`word-group ${active ? "selected" : ""}`} key={word}><button className="word-item" onClick={() => selectWord(group[0].id)}><span className="word-select-dot" /><span><strong>{word}</strong><small>{group.length} {group.length === 1 ? "meaning" : "meanings"} · {group[0].pos}</small></span>{active && <ChevronRight size={15} />}</button>{active && group.map((s, index) => <button className={`sense-item ${sense.id === s.id ? "active" : ""}`} key={s.id} onClick={() => selectWord(s.id)}><span>{String(index + 1).padStart(2, "0")}</span><span>{s.meaning}</span></button>)}</div>; }) : search ? <div className="sidebar-empty">Nothing matches “{search}”<button className="text-button" onClick={() => setAdd(true)}>Add this word <Plus size={13} /></button></div> : <><button className="word-group demo-word selected" onClick={() => { setView("learn"); setTab("read"); if (window.innerWidth <= 760) setSidebar(false); }}><div className="word-item"><span className="word-select-dot" /><span><strong>resilient</strong><small>See how a word can be learned</small></span></div><span className="preview-label">Preview · not saved</span></button><p className="collection-note">When you meet a new word,<br />make room for it here.</p></>}</div><div className="sidebar-bottom"><div className="seed-icon"><Sprout size={22} /></div><p>Give every word<br /><strong>a story of its own.</strong></p><span className="sidebar-footer">LEXI <span>·</span> LEARN IN CONTEXT</span></div></aside>}
      <main className="main-content">
        <div className="page-breadcrumb"><div>{!sideVisible && view !== "review" && <span className="sidebar-drag-note">Click the handle on the left or drag it right to open the {view === "scene" ? "text list" : "word list"}</span>}<span>{view === "learn" ? "Learn" : view === "scene" ? "Real Scenes" : "Review"}</span><ChevronRight size={13} /><span className="breadcrumb-current">{view === "learn" ? "Meet words in context" : view === "scene" ? "Read and remember real texts" : "Make what you met your own"}</span></div><span className="quiet-label"><span className="tiny-leaf">✦</span> A LITTLE EVERY DAY</span></div>
        {error && <div className="error-banner" role="alert"><CircleHelp size={18} /><span>{error.message}</span>{error.auth ? <a href="/signin-with-chatgpt?return_to=/" target="_top">Sign in to sync</a> : <button onClick={() => void refresh()}>Reconnect</button>}<button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss"><X size={15} /></button></div>}
        {loading ? <div className="content-skeleton" aria-label="Loading your study records"><div /><div /><div /></div> : view === "review" ? <Review count={saved.length} onError={report} onSaved={() => void refresh()} onAdd={() => setAdd(true)} /> : view === "scene" ? <Scene passage={passage} senses={saved} loading={loading} onAdd={() => setEditing("new")} onEdit={() => passage && setEditing(passage)} onPassage={updatePassage} onSense={updateSense} onOpenSense={openSense} onError={report} notify={notify} /> : <>
          <section className="word-header"><div><div className="eyebrow word-eyebrow"><span className="little-dash" />{isDemo ? "A WORD TO BEGIN WITH" : "YOUR WORD, YOUR WORLD"}{isDemo && <span className="demo-tag">Preview</span>}</div><div className="word-title-row"><h1>{sense.word}</h1><span className="word-pronunciation">{sense.phonetic}</span></div><div className="word-meaning"><span className="pos-tag">{sense.pos}</span><span>{sense.meaning}</span></div></div><div className="word-header-note"><div className="leaf-decoration"><Leaf size={38} strokeWidth={1} /><span /><Leaf size={24} strokeWidth={1} /></div><span>Not just remembering words,<br />but knowing how to use them.</span></div></section>
          {saved.filter((s) => s.word === sense.word).length > 1 && <div className="meaning-switch" aria-label="Choose a meaning to study">{saved.filter((s) => s.word === sense.word).map((s, i) => <button className={s.id === sense.id ? "active" : ""} onClick={() => setSelected(s.id)} key={s.id}>Meaning {i + 1}<span>{s.meaning}</span></button>)}</div>}
          <div className="skills-tabs" role="tablist" aria-label="Skills">{TABS.map(({ id, title, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} disabled={id === "speak"} title={id === "speak" ? "Speaking practice is coming soon" : undefined} className={`skill-tab ${tab === id ? "active" : ""}`} onClick={() => { if (id !== "speak") setTab(id as Tab); }}><Icon size={18} /><span>{title}</span>{id === "speak" && <em>Soon</em>}</button>)}<span className="tab-end"><span />Stay a while, take more home</span></div>
          <div className="learning-layout"><div className="lesson-content" role="tabpanel" key={`${sense.id}-${tab}`}>
            {tab === "read" && <Read sense={sense} demo={isDemo} onUpdate={updateSense} onError={report} notify={notify} onRequireWord={requireWord} />}
            {tab === "write" && <Writing sense={sense} demo={isDemo} onUpdate={updateSense} onError={report} onRequireWord={requireWord} />}
            {tab === "listen" && <Listening sense={sense} demo={isDemo} onError={report} onRequireWord={requireWord} />}
          </div><aside className="lesson-aside"><div className="aside-note"><span className="eyebrow">LEARN WITH INTENTION</span><h3>From understanding to using.</h3><p>Give yourself a little time<br />and let a new word grow familiar.</p><div className="learning-path">{[{ id: "read", title: "Read the context", text: "Build a feel from definitions and examples", icon: BookOpen }, { id: "write", title: "Try it yourself", text: "Put the word in a sentence of your own", icon: PenLine }, { id: "listen", title: "Hear the difference", text: "Recognise the word in different voices", icon: Headphones }].map(({ id, title, text, icon: Icon }, index) => <button key={id} className={`path-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id as Tab)}><span className="path-icon"><Icon size={16} /></span><span><strong>{title}<small>0{index + 1}</small></strong><em>{text}</em></span></button>)}</div></div><div className="hover-guide"><span className="guide-icon"><Info size={16} /></span><div><strong>More curiosity, less dependence</strong><p>Chinese and scene hints stay tucked away. When you need one, hover over, focus, or tap <Info size={12} /> to see it.</p></div></div>{!isDemo && <div className="mastery-card"><div><span>Familiarity with this meaning</span><b>{Math.round(Math.max(0, Math.min(100, sense.mastery)))}%</b></div><div className="progress-track"><span style={{ width: `${Math.max(0, Math.min(100, sense.mastery))}%` }} /></div><p>{sense.reviewCount ? `${sense.reviewCount} ${sense.reviewCount === 1 ? "review" : "reviews"} done. Keep letting it take root.` : "Do a review and see how much stuck."}</p><button className="text-button" onClick={() => setView("review")}>Review <ArrowRight size={13} /></button></div>}</aside></div>
          <footer className="lesson-footer"><span><Leaf size={13} />Every context you understand is one more way to say it.</span><span>Lexi · let language grow naturally</span></footer>
        </>}
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    {add && <AddWord close={addClose} onError={report} onAdded={(newSense) => { updateSense(newSense); setSelected(newSense.id); setView("learn"); setTab("read"); setAdd(false); if (window.innerWidth <= 760) setSidebar(false); notify(`Added this meaning of ${newSense.word} to your word book`); void refresh(); }} />}
    {editing && <PassageEditor passage={editing === "new" ? undefined : editing} close={editorClose} onSaved={savePassage} onDeleted={deletePassage} onError={report} />}
    {settings && <SettingsModal close={settingsClose} state={state} onSaved={(value) => { setState((old) => old ? { ...old, settings: value } : old); notify("Model settings saved"); }} onError={report} />}
  </div>;
}

function AddWord({ close, onAdded, onError }: { close: () => void; onAdded: (s: Sense) => void; onError: (err: unknown) => void }) {
  const [word, setWord] = useState(""); const [choices, setChoices] = useState<Choice[]>([]); const [selected, setSelected] = useState(""); const [busy, setBusy] = useState(""); const [localError, setLocalError] = useState("");
  async function lookup(e: React.FormEvent) { e.preventDefault(); if (!word.trim()) return; setBusy("lookup"); setLocalError(""); try { const result = await request<{ senses: Choice[] }>("lookup", { word: word.trim() }); setChoices(result.senses); setSelected(result.senses[0]?.id || ""); } catch (err) { setLocalError(err instanceof Error ? err.message : "The word could not be looked up. Please try again."); onError(err); } finally { setBusy(""); } }
  async function select() { if (!selected) return; setBusy("select"); setLocalError(""); try { const result = await request<{ sense: Sense }>("select", { senseId: selected }); onAdded(result.sense); } catch (err) { setLocalError(err instanceof Error ? err.message : "The materials could not be generated. Please try again."); onError(err); } finally { setBusy(""); } }
  return <Modal title="Which word would you like to meet today?" subtitle="A word can have many meanings. We focus on one at a time." close={close} wide><form onSubmit={(e) => void lookup(e)}><label className="field-label" htmlFor="new-word">Your English word</label><div className="lookup-input"><Search size={19} /><input id="new-word" autoComplete="off" placeholder="e.g. resilient" value={word} maxLength={60} onChange={(e) => { setWord(e.target.value); setChoices([]); }} disabled={!!busy} required /><button className="primary-button" type="submit" disabled={!!busy || !word.trim()}>{busy === "lookup" ? <Loading label="Looking up" /> : <>See meanings <ArrowRight size={15} /></>}</button></div></form>{localError && <p className="inline-error" role="alert">{localError}</p>}{choices.length > 0 && <div className="sense-choices"><div className="field-label">Choose the meaning to study now <span>You can add other meanings later</span></div>{choices.map((choice) => <label className={`sense-choice ${selected === choice.id ? "active" : ""}`} key={choice.id}><input type="radio" name="sense" value={choice.id} checked={selected === choice.id} onChange={() => setSelected(choice.id)} disabled={!!busy} /><span><strong><span className="pos-tag">{choice.pos}</span>{choice.definition}<Tip label="Chinese meaning" icon={<Languages size={14} />}><span className="translation-content">{choice.meaning}</span></Tip></strong></span><span className="radio-indicator">{selected === choice.id && <Check size={12} />}</span></label>)}<button className="primary-button full-width" disabled={!!busy || !selected} onClick={() => void select()}>{busy === "select" ? <Loading label="Preparing study materials, just a moment…" /> : <><Sparkles size={16} />Create contexts and start</>}</button></div>}<p className="modal-footnote"><ShieldCheck size={13} />Your progress is saved to your account. Come back any time.</p></Modal>;
}

function SidebarDrag({ open, width, onChange }: { open: boolean; width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ x: number; y: number; width: number; pointerId: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const toggle = () => onChange(open ? 0 : DEFAULT_SIDEBAR_WIDTH);
  const cancelDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
  };
  return <div className={`sidebar-drag ${open ? "is-open" : "is-closed"} ${dragging ? "is-dragging" : ""}`}
    role="separator" tabIndex={0} aria-label={open ? "Click to fold the sidebar, drag to resize it" : "Click or drag right to open the sidebar"}
    aria-orientation="vertical" aria-valuemin={0} aria-valuemax={360} aria-valuenow={open ? width : 0} aria-controls="word-sidebar"
    title={open ? "Click to fold · drag sideways to resize · drag all the way left to fold" : "Click to open at the default width · drag right to open"}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, width: open ? width : 0, pointerId: event.pointerId, moved: false };
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.moved) {
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) <= SIDEBAR_DRAG_THRESHOLD) return;
        current.moved = true;
        setDragging(true);
      }
      const next = Math.max(0, Math.min(360, window.innerWidth - 40, current.width + event.clientX - current.x));
      onChange(next < (current.width ? 120 : 45) ? 0 : Math.max(200, next));
    }}
    onPointerUp={event => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      drag.current = null;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (!current.moved) toggle();
    }}
    onPointerCancel={cancelDrag}
    onLostPointerCapture={cancelDrag}
    // Pointer activation is handled on release, including taps without a click event.
    // Keep non-pointer activation available without toggling again after a drag.
    onClick={event => { if (event.detail === 0) toggle(); }}
    onKeyDown={event => {
      if (!["Enter", " ", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Enter" || event.key === " ") { if (!event.repeat) toggle(); }
      else if (event.key === "Home") onChange(0);
      else if (event.key === "End") onChange(300);
      else if (event.key === "ArrowRight") onChange(open ? Math.min(360, width + 20) : DEFAULT_SIDEBAR_WIDTH);
      else onChange(!open || width <= 200 ? 0 : width - 20);
    }}>
    <span className="sidebar-drag-grip" aria-hidden="true">{open ? <MoveHorizontal size={14} strokeWidth={1.7} /> : <ChevronRight size={15} strokeWidth={1.7} />}</span>
  </div>;
}

function SettingsModal({ close, state, onSaved, onError }: { close: () => void; state: AppState | null; onSaved: (v: AppState["settings"]) => void; onError: (e: unknown) => void }) {
  const localSpeech = state?.settings.speechProvider === "qwen3";
  const [textModel, setTextModel] = useState(state?.settings.textModel || "deepseek-flash"); const [voiceModel, setVoiceModel] = useState(state?.settings.voiceModel || "speech-2.8-turbo"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(""); try { const result = await request<{ settings: AppState["settings"] }>("settings", { textModel: textModel.trim(), voiceModel: voiceModel.trim() }); onSaved(result.settings); close(); } catch (err) { setError(err instanceof Error ? err.message : "The settings were not saved. Please try again."); onError(err); } finally { setBusy(false); } }
  return <Modal title="Learn at your own pace" subtitle="Models can change; the words and contexts you have learned stay with you." close={close}><form onSubmit={(e) => void save(e)}><div className="provider-heading"><span className="provider-icon"><Sparkles size={17} /></span><div><strong>DeepSeek</strong><span>Meanings, contexts, and feedback</span></div><span className={`connection-label ${state?.services.text ? "connected" : ""}`}><i />{state?.services.text ? "Configured" : "Not configured"}</span></div><label className="field-label" htmlFor="text-model">Text model</label><input id="text-model" value={textModel} onChange={(e) => setTextModel(e.target.value)} required maxLength={100} disabled={busy} /><div className="provider-heading"><span className="provider-icon"><AudioLines size={18} /></span><div><strong>{localSpeech ? "Qwen3-TTS · local" : "MiniMax"}</strong><span>{localSpeech ? "Dictation audio made on this computer" : "Many voices, real listening"}</span></div><span className={`connection-label ${state?.services.speech ? "connected" : ""}`}><i />{state?.services.speech ? "Configured" : "Not configured"}</span></div><label className="field-label" htmlFor="voice-model">Speech model</label><input id="voice-model" readOnly={localSpeech} value={voiceModel} onChange={(e) => setVoiceModel(e.target.value)} required maxLength={100} disabled={busy} /><p className="settings-help"><ShieldCheck size={15} />{localSpeech ? "Speech is made by Qwen3-TTS on this computer, so no speech API key is needed. Keep the local speech service running; changing the model means restarting it and editing the site configuration." : "API keys stay on the server. Only model names can be changed here; providers are managed in the site configuration."}</p>{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary-button full-width" type="submit" disabled={busy || !textModel.trim() || !voiceModel.trim()}>{busy ? <Loading label="Saving" /> : <>Save settings <Check size={15} /></>}</button></form></Modal>;
}
