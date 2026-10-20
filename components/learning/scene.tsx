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
const TABS = [{ id: "listen", title: "听", en: "LISTEN", icon: Headphones }, { id: "speak", title: "说", en: "SPEAK", icon: Mic }, { id: "read", title: "读", en: "READ", icon: BookOpen }, { id: "write", title: "写", en: "RECALL", icon: PenLine }];

function stats(passage: Passage) {
  const lines = parsePassage(passage.text).filter(line => line.kind === "text");
  return { lines: lines.length, words: lines.reduce((sum, line) => sum + line.tokens.filter(token => token.word).length, 0) };
}

export function PassageSidebar({ passages, selected, loading, onSelect, onAdd }: { passages: Passage[]; selected?: string; loading: boolean; onSelect: (id: string) => void; onAdd: () => void }) {
  const [search, setSearch] = useState("");
  const shown = passages.filter(passage => `${passage.title} ${passage.author}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <div className="sidebar-heading"><span>我的文本 <b>{passages.length}</b></span><span className="sidebar-drag-note">点击收放 · 拖动调宽</span></div>
    <label className="search-field"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索标题或作者" aria-label="搜索文本" /><kbd>⌕</kbd></label>
    <button className="add-word" onClick={onAdd}><Plus size={17} />添加新文本</button>
    <div className="sidebar-list"><div className="list-section-title">{passages.length ? "想读、想记的文字" : "从一段文字开始"}<span>{passages.length ? `${shown.length} TEXTS` : "LYRICS · ARTICLES"}</span></div>
      {loading ? <div className="sidebar-skeleton"><span /><span /><span /></div> : shown.length ? shown.map(passage => <div className={`word-group ${passage.id === selected ? "selected" : ""}`} key={passage.id}><button className="word-item" onClick={() => onSelect(passage.id)}><span className="word-select-dot" /><span><strong>{passage.title}</strong><small>{passage.author || "未注明来源"} · {stats(passage).lines} 行</small></span>{passage.id === selected && <ChevronRight size={15} />}</button></div>)
        : search ? <div className="sidebar-empty">没有找到“{search}”</div> : <p className="collection-note">一首想唱会的歌，<br />一段想读懂的文字。</p>}
    </div>
    <div className="sidebar-bottom"><div className="seed-icon"><Music2 size={22} /></div><p>在喜欢的文字里，<br /><strong>遇见新的单词。</strong></p><span className="sidebar-footer">词境 LEXI <span>·</span> LEARN IN CONTEXT</span></div>
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
      setFailed({ version: key, message: err instanceof Error ? err.message : "没有识别出词组，请重试。" });
    });
  }, [onPassage, onError]);
  useEffect(() => { if (passage && !passage.phrases && !started.current.has(version)) findPhrases(passage, version); }, [passage, version, findPhrases]);
  if (!passage) return <section className="lesson-card practice-card scene-empty"><div className="practice-empty"><span className="large-practice-icon"><Music2 size={32} strokeWidth={1.3} /></span><h3>放进一首你想唱会的歌。</h3><p>粘贴歌词或任何英文文本。读的时候，轻点生词，<br />按它所在的句子收进单词本；写的时候，随机挖空，<br />帮你把它记下来。</p><button className="primary-button" disabled={loading} onClick={onAdd}><Plus size={16} />添加第一段文本</button></div></section>;
  const { lines, words } = stats(passage);
  const gathered = senses.filter(sense => sense.materials.some(item => item.source === passage.title)).length;
  return <>
    <section className="word-header scene-header"><div><div className="eyebrow word-eyebrow"><span className="little-dash" />REAL WORDS, REAL CONTEXT</div><div className="word-title-row"><h1>{passage.title}</h1>{passage.author && <span className="word-pronunciation">{passage.author}</span>}</div><div className="word-meaning"><span className="pos-tag">{lines} 行 · {words} 词</span><span>{gathered ? `已从这里收集 ${gathered} 个词义` : "轻点单词，按这一句的意思收进单词本"}</span></div></div><button className="text-button scene-edit" onClick={onEdit}><PenLine size={14} />编辑文本</button></section>
    <div className="skills-tabs" role="tablist" aria-label="练习方式">{TABS.map(({ id, title, en, icon: Icon }) => { const soon = id === "listen" || id === "speak"; return <button key={id} role="tab" aria-selected={tab === id} disabled={soon} title={soon ? "暂未开放" : undefined} className={`skill-tab ${tab === id ? "active" : ""}`} onClick={() => { if (!soon) setTab(id as SceneTab); }}><Icon size={18} /><span>{title}</span><small>{en}</small>{soon && <em>即将开放</em>}</button>; })}<span className="tab-end"><span />先读懂，再记住</span></div>
    <div role="tabpanel">{tab === "read" ? <PassageReading key={passage.id} passage={passage} phraseError={failed?.version === version ? failed.message : undefined} onRetryPhrases={() => { setFailed(null); findPhrases(passage, version); }} onSense={onSense} onOpenSense={onOpenSense} onError={onError} notify={notify} /> : <PassageCloze key={`${passage.id}-${passage.updatedAt}`} passage={passage} />}</div>
  </>;
}

export function PassageEditor({ passage, close, onSaved, onDeleted, onError }: { passage?: Passage; close: () => void; onSaved: (p: Passage) => void; onDeleted: (id: string) => void; onError: (e: unknown) => void }) {
  const [title, setTitle] = useState(passage?.title || ""); const [author, setAuthor] = useState(passage?.author || ""); const [text, setText] = useState(passage?.text || "");
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [confirming, setConfirming] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy("save"); setError("");
    try { const result = await request<{ passage: Passage }>("passageSave", { ...(passage ? { passageId: passage.id } : {}), title: title.trim(), author: author.trim(), text }); onSaved(result.passage); }
    catch (err) { setError(err instanceof Error ? err.message : "没有保存成功，请重试。"); onError(err); } finally { setBusy(""); }
  }
  async function remove() {
    if (!passage) return;
    if (!confirming) { setConfirming(true); return; }
    setBusy("delete"); setError("");
    try { await request("passageDelete", { passageId: passage.id }); onDeleted(passage.id); }
    catch (err) { setError(err instanceof Error ? err.message : "没有删除成功，请重试。"); onError(err); } finally { setBusy(""); }
  }
  return <Modal title={passage ? "修改这段文本" : "放进一段想读的文字"} subtitle="歌词、台词、文章都可以。每行一句，空行分段。" close={close} wide><form onSubmit={event => void save(event)}>
    <label className="field-label" htmlFor="passage-title">标题</label><input id="passage-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：Man in the Mirror" maxLength={80} required disabled={!!busy} autoComplete="off" />
    <label className="field-label" htmlFor="passage-author">作者或来源<span>可选</span></label><input id="passage-author" value={author} onChange={event => setAuthor(event.target.value)} placeholder="例如：Michael Jackson" maxLength={80} disabled={!!busy} autoComplete="off" />
    <label className="field-label" htmlFor="passage-text">英文文本<span>{text.length} / 5000</span></label><textarea id="passage-text" className="passage-input" value={text} onChange={event => setText(event.target.value)} placeholder={"[Verse 1]\nPaste the lyrics here, one line per line…"} rows={12} maxLength={5000} required disabled={!!busy} spellCheck={false} />
    <p className="settings-help"><Info size={15} />单独一行的 [Chorus]、[Verse 1] 会作为段落标记。重复出现的歌词行，在填空练习里只挖一次。保存后，DeepSeek 会先标出其中的词组和固定搭配，阅读时点它们会整体查询。</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button className="primary-button full-width" type="submit" disabled={!!busy || !title.trim() || !text.trim()}>{busy === "save" ? <Loading label="保存中" /> : <>保存文本 <Check size={15} /></>}</button>
    {passage && <button type="button" className={`text-button passage-delete ${confirming ? "confirming" : ""}`} disabled={!!busy} onClick={() => void remove()}>{busy === "delete" ? <Loading label="删除中" /> : <><Trash2 size={14} />{confirming ? "再点一次，确认删除（已收进单词本的词会保留）" : "删除这段文本"}</>}</button>}
  </form></Modal>;
}
