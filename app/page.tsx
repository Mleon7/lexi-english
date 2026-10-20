"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ArrowRight, AudioLines, BookOpen, Check, ChevronRight, CircleHelp, Headphones, Info, Leaf, Mic, MoveHorizontal, PenLine, Plus, Search, Settings2, ShieldCheck, Sparkles, Sprout, X, Repeat2 } from "lucide-react";
import Link from "next/link";
import { type Sense, type AppState, type Choice, type Tab } from "@/components/learning/types";
import { ApiError, request } from "@/components/learning/api";
import { Loading, Modal } from "@/components/learning/shared";
import { Read } from "@/components/learning/reading";
import { Writing } from "@/components/learning/writing";
import { Listening } from "@/components/learning/listening";
import { Review } from "@/components/learning/review";

const DEMO: Sense = { id: "preview", word: "resilient", phonetic: "/rɪˈzɪliənt/", pos: "adjective", meaning: "有韧性的；能迅速恢复的", definition: "Able to become strong, healthy, or happy again after something difficult happens.", learned: false, mastery: 0, reviewCount: 0, createdAt: 0, materials: [
  { id: "d1", kind: "description", text: "Able to become strong, healthy, or happy again after something difficult happens." },
  { id: "e1", kind: "example", text: "Like a tree that bends in the wind, a resilient person finds a way to keep growing." },
  { id: "e2", kind: "example", text: "The community proved remarkably resilient after the storm." },
  { id: "e3", kind: "example", text: "Small daily habits can help you become more resilient in the face of change." },
  { id: "s1", kind: "synonym", term: "strong", relationNote: "近义表达 · 强大的，坚强的", text: "She stayed strong even when things did not go as planned." },
  { id: "a1", kind: "antonym", term: "fragile", relationNote: "反义表达 · 脆弱的", text: "His confidence was fragile after a series of setbacks." },
] };

const TABS = [{ id: "listen", title: "听", en: "LISTEN", icon: Headphones }, { id: "speak", title: "说", en: "SPEAK", icon: Mic }, { id: "read", title: "读", en: "READ", icon: BookOpen }, { id: "write", title: "写", en: "WRITE", icon: PenLine }];
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
  const [state, setState] = useState<AppState | null>(null); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState("preview"); const [tab, setTab] = useState<Tab>("read"); const [view, setView] = useState<"learn" | "review">("learn"); const [sidebar, setSidebar] = useState<boolean | null>(null); const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH); const [search, setSearch] = useState(""); const [add, setAdd] = useState(false); const [settings, setSettings] = useState(false); const [error, setError] = useState<{ message: string; auth?: boolean } | null>(null); const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => setToast(message), []);
  const report = useCallback((err: unknown) => { setError({ message: err instanceof Error ? err.message : "连接暂时中断，请重试。", auth: err instanceof ApiError && err.code === "auth" }); }, []);
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
  const updateSense = (updated: Sense) => { setState((old) => old ? { ...old, senses: old.senses.some((s) => s.id === updated.id) ? old.senses.map((s) => s.id === updated.id ? updated : s) : [...old.senses, updated] } : old); };
  const addClose = useCallback(() => setAdd(false), []); const settingsClose = useCallback(() => setSettings(false), []);
  const requireWord = useCallback(() => { setAdd(true); notify("先添加一个想学的单词，开启你的学习。"); }, [notify]);
  const selectWord = (id: string) => { setSelected(id); setView("learn"); if (window.innerWidth <= 760) setSidebar(false); };
  const sideVisible = (sidebar ?? !isNarrow) && view === "learn";
  return <div className="app-shell">
    <header className="topbar"><Link href="/" className="brand" aria-label="词境首页"><span className="brand-icon"><BookOpen size={22} strokeWidth={1.7} /><span /></span><span>词境<span className="brand-en">Lexi</span></span></Link><nav className="main-nav" aria-label="主导航"><button className={view === "learn" ? "active" : ""} onClick={() => { setView("learn"); setSidebar(true); }}><BookOpen size={16} />学习空间</button><button className={view === "review" ? "active" : ""} onClick={() => setView("review")}><Repeat2 size={16} />温故知新{saved.length > 0 && <span className="nav-count">{saved.length}</span>}</button></nav><div className="topbar-end"><span className="topbar-note"><span className="status-dot" />每天一点，慢慢生长</span><button className="icon-button settings-button" onClick={() => setSettings(true)} aria-label="学习与模型设置"><Settings2 size={18} /></button><span className="avatar" aria-label="你的学习空间">{state?.user.displayName?.slice(0, 1).toUpperCase() || "L"}</span></div></header>
    <div className={`workspace ${sideVisible ? "" : "sidebar-collapsed"}`} style={{ "--sidebar-width": `${sideVisible ? sidebarWidth : 0}px` } as CSSProperties}>
      {view === "learn" && <SidebarDrag open={sideVisible} width={sidebarWidth} onChange={width => { setSidebar(width > 0); if (width > 0) setSidebarWidth(width); }} />}
      {sideVisible && <aside id="word-sidebar" className="word-sidebar"><div className="sidebar-heading"><span>我的单词本 <b>{saved.length}</b></span><span className="sidebar-drag-note">点击收放 · 拖动调宽</span></div><label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索你的单词" aria-label="搜索单词" /><kbd>⌕</kbd></label><button className="add-word" onClick={() => setAdd(true)}><Plus size={17} />添加新单词</button><div className="sidebar-list"><div className="list-section-title">{saved.length ? "正在积累" : "从一个单词开始"}<span>{saved.length ? `${words.length} WORDS` : "YOUR COLLECTION"}</span></div>{loading ? <div className="sidebar-skeleton"><span /><span /><span /></div> : words.length ? words.map((word) => { const group = saved.filter((s) => s.word === word); const active = sense.word === word; return <div className={`word-group ${active ? "selected" : ""}`} key={word}><button className="word-item" onClick={() => selectWord(group[0].id)}><span className="word-select-dot" /><span><strong>{word}</strong><small>{group.length} 个词义 · {group[0].pos}</small></span>{active && <ChevronRight size={15} />}</button>{active && group.map((s, index) => <button className={`sense-item ${sense.id === s.id ? "active" : ""}`} key={s.id} onClick={() => selectWord(s.id)}><span>{String(index + 1).padStart(2, "0")}</span><span>{s.meaning}</span></button>)}</div>; }) : search ? <div className="sidebar-empty">没有找到“{search}”<button className="text-button" onClick={() => setAdd(true)}>添加这个单词 <Plus size={13} /></button></div> : <><button className="word-group demo-word selected" onClick={() => { setView("learn"); setTab("read"); if (window.innerWidth <= 760) setSidebar(false); }}><div className="word-item"><span className="word-select-dot" /><span><strong>resilient</strong><small>看看一个单词可以怎样学</small></span></div><span className="preview-label">示例预览 · 未保存</span></button><p className="collection-note">遇见一个新词，<br />在这里为它留个位置。</p></>}</div><div className="sidebar-bottom"><div className="seed-icon"><Sprout size={22} /></div><p>让每一个单词，<br /><strong>都有自己的故事。</strong></p><span className="sidebar-footer">词境 LEXI <span>·</span> LEARN IN CONTEXT</span></div></aside>}
      <main className="main-content">
        <div className="page-breadcrumb"><div>{!sideVisible && view === "learn" && <span className="sidebar-drag-note">点击左侧手柄或向右拖动，展开单词栏</span>}<span>{view === "learn" ? "学习空间" : "温故知新"}</span><ChevronRight size={13} /><span className="breadcrumb-current">{view === "learn" ? "在语境中认识单词" : "把遇见，变成熟悉"}</span></div><span className="quiet-label"><span className="tiny-leaf">✦</span> A LITTLE EVERY DAY</span></div>
        {error && <div className="error-banner" role="alert"><CircleHelp size={18} /><span>{error.message}</span>{error.auth ? <a href="/signin-with-chatgpt?return_to=/" target="_top">登录并同步</a> : <button onClick={() => void refresh()}>重新连接</button>}<button className="icon-button" onClick={() => setError(null)} aria-label="关闭提示"><X size={15} /></button></div>}
        {loading ? <div className="content-skeleton" aria-label="正在读取学习记录"><div /><div /><div /></div> : view === "review" ? <Review count={saved.length} onError={report} onSaved={() => void refresh()} onAdd={() => setAdd(true)} /> : <>
          <section className="word-header"><div><div className="eyebrow word-eyebrow"><span className="little-dash" />{isDemo ? "A WORD TO BEGIN WITH" : "YOUR WORD, YOUR WORLD"}{isDemo && <span className="demo-tag">示例预览</span>}</div><div className="word-title-row"><h1>{sense.word}</h1><span className="word-pronunciation">{sense.phonetic}</span></div><div className="word-meaning"><span className="pos-tag">{sense.pos}</span><span>{sense.meaning}</span></div></div><div className="word-header-note"><div className="leaf-decoration"><Leaf size={38} strokeWidth={1} /><span /><Leaf size={24} strokeWidth={1} /></div><span>不只记住单词，<br />更懂得如何使用。</span></div></section>
          {saved.filter((s) => s.word === sense.word).length > 1 && <div className="meaning-switch" aria-label="选择学习的词义">{saved.filter((s) => s.word === sense.word).map((s, i) => <button className={s.id === sense.id ? "active" : ""} onClick={() => setSelected(s.id)} key={s.id}>词义 {i + 1}<span>{s.meaning}</span></button>)}</div>}
          <div className="skills-tabs" role="tablist" aria-label="学习能力">{TABS.map(({ id, title, en, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} disabled={id === "speak"} title={id === "speak" ? "口语练习即将开放" : undefined} className={`skill-tab ${tab === id ? "active" : ""}`} onClick={() => { if (id !== "speak") setTab(id as Tab); }}><Icon size={18} /><span>{title}</span><small>{en}</small>{id === "speak" && <em>即将开放</em>}</button>)}<span className="tab-end"><span />沉浸一下，收获更多</span></div>
          <div className="learning-layout"><div className="lesson-content" role="tabpanel" key={`${sense.id}-${tab}`}>
            {tab === "read" && <Read sense={sense} demo={isDemo} onUpdate={updateSense} onError={report} notify={notify} onRequireWord={requireWord} />}
            {tab === "write" && <Writing sense={sense} demo={isDemo} onError={report} onRequireWord={requireWord} />}
            {tab === "listen" && <Listening sense={sense} demo={isDemo} onError={report} onRequireWord={requireWord} />}
          </div><aside className="lesson-aside"><div className="aside-note"><span className="eyebrow">LEARN WITH INTENTION</span><h3>从理解，到会用。</h3><p>给自己一点时间，<br />让新单词慢慢变得熟悉。</p><div className="learning-path">{[{ id: "read", title: "读懂语境", text: "用描述和例句建立直觉", icon: BookOpen }, { id: "write", title: "试着表达", text: "把单词放进自己的句子", icon: PenLine }, { id: "listen", title: "听见不同", text: "在不同声音里辨认单词", icon: Headphones }].map(({ id, title, text, icon: Icon }, index) => <button key={id} className={`path-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id as Tab)}><span className="path-icon"><Icon size={16} /></span><span><strong>{title}<small>0{index + 1}</small></strong><em>{text}</em></span></button>)}</div></div><div className="hover-guide"><span className="guide-icon"><Info size={16} /></span><div><strong>留一点好奇，少一点依赖</strong><p>中文和场景提示会被轻轻藏起。需要时，悬停、聚焦或轻点 <Info size={12} /> 查看。</p></div></div>{!isDemo && <div className="mastery-card"><div><span>这个词义的熟悉度</span><b>{Math.round(Math.max(0, Math.min(100, sense.mastery)))}%</b></div><div className="progress-track"><span style={{ width: `${Math.max(0, Math.min(100, sense.mastery))}%` }} /></div><p>{sense.reviewCount ? `已完成 ${sense.reviewCount} 次复习，继续让记忆生根。` : "完成一次复习，看看记住了多少。"}</p><button className="text-button" onClick={() => setView("review")}>去复习 <ArrowRight size={13} /></button></div>}</aside></div>
          <footer className="lesson-footer"><span><Leaf size={13} />每理解一个语境，就多一种表达。</span><span>词境 · 让语言自然生长</span></footer>
        </>}
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    {add && <AddWord close={addClose} onError={report} onAdded={(newSense) => { updateSense(newSense); setSelected(newSense.id); setView("learn"); setTab("read"); setAdd(false); if (window.innerWidth <= 760) setSidebar(false); notify(`已把 ${newSense.word} 的这个词义加入单词本`); void refresh(); }} />}
    {settings && <SettingsModal close={settingsClose} state={state} onSaved={(value) => { setState((old) => old ? { ...old, settings: value } : old); notify("模型设置已保存"); }} onError={report} />}
  </div>;
}

function AddWord({ close, onAdded, onError }: { close: () => void; onAdded: (s: Sense) => void; onError: (err: unknown) => void }) {
  const [word, setWord] = useState(""); const [choices, setChoices] = useState<Choice[]>([]); const [selected, setSelected] = useState(""); const [busy, setBusy] = useState(""); const [localError, setLocalError] = useState("");
  async function lookup(e: React.FormEvent) { e.preventDefault(); if (!word.trim()) return; setBusy("lookup"); setLocalError(""); try { const result = await request<{ senses: Choice[] }>("lookup", { word: word.trim() }); setChoices(result.senses); setSelected(result.senses[0]?.id || ""); } catch (err) { setLocalError(err instanceof Error ? err.message : "查词失败，请重试"); onError(err); } finally { setBusy(""); } }
  async function select() { if (!selected) return; setBusy("select"); setLocalError(""); try { const result = await request<{ sense: Sense }>("select", { senseId: selected }); onAdded(result.sense); } catch (err) { setLocalError(err instanceof Error ? err.message : "生成失败，请重试"); onError(err); } finally { setBusy(""); } }
  return <Modal title="今天，想认识哪个单词？" subtitle="一个词可以有很多意思。我们每次专注理解其中一个。" close={close} wide><form onSubmit={(e) => void lookup(e)}><label className="field-label" htmlFor="new-word">你的英文单词</label><div className="lookup-input"><Search size={19} /><input id="new-word" autoComplete="off" placeholder="例如：resilient" value={word} maxLength={60} onChange={(e) => { setWord(e.target.value); setChoices([]); }} disabled={!!busy} required /><button className="primary-button" type="submit" disabled={!!busy || !word.trim()}>{busy === "lookup" ? <Loading label="查找中" /> : <>查看词义 <ArrowRight size={15} /></>}</button></div></form>{localError && <p className="inline-error" role="alert">{localError}</p>}{choices.length > 0 && <div className="sense-choices"><div className="field-label">选择这次想学习的意思 <span>之后还可以添加其他词义</span></div>{choices.map((choice) => <label className={`sense-choice ${selected === choice.id ? "active" : ""}`} key={choice.id}><input type="radio" name="sense" value={choice.id} checked={selected === choice.id} onChange={() => setSelected(choice.id)} disabled={!!busy} /><span><strong><span className="pos-tag">{choice.pos}</span>{choice.meaning}</strong><em>{choice.definition}</em></span><span className="radio-indicator">{selected === choice.id && <Check size={12} />}</span></label>)}<button className="primary-button full-width" disabled={!!busy || !selected} onClick={() => void select()}>{busy === "select" ? <Loading label="正在生成学习材料，稍等片刻…" /> : <><Sparkles size={16} />生成语境，开始学习</>}</button></div>}<p className="modal-footnote"><ShieldCheck size={13} />学习记录跟随你的账号保存，随时回来继续。</p></Modal>;
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
    role="separator" tabIndex={0} aria-label={open ? "点击收起单词栏，拖动调整宽度" : "点击或向右拖动展开单词栏"}
    aria-orientation="vertical" aria-valuemin={0} aria-valuemax={360} aria-valuenow={open ? width : 0} aria-controls="word-sidebar"
    title={open ? "点击收起 · 左右拖动调节宽度 · 向左拖到底收起" : "点击按默认宽度展开 · 向右拖动展开"}
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
  async function save(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(""); try { const result = await request<{ settings: AppState["settings"] }>("settings", { textModel: textModel.trim(), voiceModel: voiceModel.trim() }); onSaved(result.settings); close(); } catch (err) { setError(err instanceof Error ? err.message : "设置没有保存，请重试。"); onError(err); } finally { setBusy(false); } }
  return <Modal title="按照你的节奏学习" subtitle="模型可以调整，学过的单词和语境会为你保留。" close={close}><form onSubmit={(e) => void save(e)}><div className="provider-heading"><span className="provider-icon"><Sparkles size={17} /></span><div><strong>DeepSeek</strong><span>词义、语境与学习反馈</span></div><span className={`connection-label ${state?.services.text ? "connected" : ""}`}><i />{state?.services.text ? "已配置" : "待配置"}</span></div><label className="field-label" htmlFor="text-model">文本模型</label><input id="text-model" value={textModel} onChange={(e) => setTextModel(e.target.value)} required maxLength={100} disabled={busy} /><div className="provider-heading"><span className="provider-icon"><AudioLines size={18} /></span><div><strong>{localSpeech ? "Qwen3-TTS · 本地" : "MiniMax"}</strong><span>{localSpeech ? "使用本机生成听写语音" : "多种声音，真实聆听"}</span></div><span className={`connection-label ${state?.services.speech ? "connected" : ""}`}><i />{state?.services.speech ? "已配置" : "待配置"}</span></div><label className="field-label" htmlFor="voice-model">语音模型</label><input id="voice-model" readOnly={localSpeech} value={voiceModel} onChange={(e) => setVoiceModel(e.target.value)} required maxLength={100} disabled={busy} /><p className="settings-help"><ShieldCheck size={15} />{localSpeech ? "语音由本机 Qwen3-TTS 生成，无需语音 API 密钥。请保持本地语音服务运行；更换模型需重启语音服务并修改站点配置。" : "API 密钥仅保存在服务端。这里仅调整模型名称；服务提供商由站点配置管理。"}</p>{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary-button full-width" type="submit" disabled={busy || !textModel.trim() || !voiceModel.trim()}>{busy ? <Loading label="保存中" /> : <>保存设置 <Check size={15} /></>}</button></form></Modal>;
}
