"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookmarkCheck, CheckCheck, Info, LoaderCircle, Sprout, X, Languages } from "lucide-react";
import { type Feedback } from "./types";
import { request } from "./api";

export function Loading({ label = "Preparing…" }: { label?: string }) { return <span className="inline-loading"><LoaderCircle size={16} className="spin" />{label}</span>; }

export function Highlight({ text, word }: { text: string; word: string }) {
  if (!word) return <>{text}</>;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return <>{text.split(new RegExp(`(${escaped})`, "gi")).map((part, i) => part.toLowerCase() === word.toLowerCase() ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>)}</>;
}

export function Tip({ label, children, icon = <Info size={14} />, onReveal }: { label: string; children: ReactNode; icon?: ReactNode; onReveal?: () => void }) {
  const [open, setOpen] = useState(false);
  return <span className={`tip-wrap ${open ? "tip-open" : ""}`} onMouseEnter={() => { setOpen(true); onReveal?.(); }} onMouseLeave={() => setOpen(false)} onFocus={() => { setOpen(true); onReveal?.(); }} onBlur={() => setOpen(false)}><button className="hint-icon" type="button" aria-label={label} aria-expanded={open} onClick={() => { setOpen(true); onReveal?.(); }}>{icon}</button>{open && <span className="tip" role="tooltip"><span className="eyebrow">{label}</span>{children}</span>}</span>;
}

export function Modal({ title, subtitle, children, close, wide = false }: { title: string; subtitle?: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; const old = document.body.style.overflow; document.body.style.overflow = "hidden"; ref.current?.querySelector<HTMLElement>("input, button, select, textarea")?.focus(); const listener = (event: KeyboardEvent) => { if (event.key === "Escape") close(); if (event.key === "Tab") { const list = ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]"); if (!list?.length) return; const first = list[0]; const last = list[list.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }; document.addEventListener("keydown", listener); return () => { document.body.style.overflow = old; document.removeEventListener("keydown", listener); previous?.focus(); }; }, [close]);
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}><button className="icon-button modal-close" onClick={close} aria-label="Close"><X size={20} /></button><div className="modal-title-icon"><Sprout size={24} /></div><h2>{title}</h2>{subtitle && <p className="muted modal-subtitle">{subtitle}</p>}{children}</div></div>;
}

export function Collected() { return <span className="collected-note"><BookmarkCheck size={12} />Saved to your examples</span>; }

export function FeedbackCard({ feedback, collected = false }: { feedback: Feedback; collected?: boolean }) { return <div className={`feedback-card ${feedback.appropriate ? "good" : "improve"}`} role="status"><div className="feedback-heading"><span>{feedback.appropriate ? <CheckCheck size={20} /> : <Sprout size={20} />}</span><h3>{feedback.appropriate ? "Well used" : "A little closer to the situation"}</h3><b>{feedback.score}<small> / 100</small></b></div><div className="feedback-part"><span className="eyebrow">Does it fit the situation?</span><p>{feedback.scenarioFeedback}</p></div><div className="feedback-part"><span className="eyebrow">Making it more natural</span><p>{feedback.grammarFeedback}</p></div>{feedback.improvedSentence && <div className="improved-sentence"><span>You could say</span><p>{feedback.improvedSentence}</p>{collected && <Collected />}</div>}</div>; }

export function TranslationHint({ text, chinese, label = "Translate" }: { text: string; chinese?: string; label?: string }) {
  return <TranslationContent key={text} text={text} chinese={chinese} label={label} />;
}

export const practiceTranslations = new Map<string, string>();

export function TranslationContent({ text, chinese, label }: { text: string; chinese?: string; label: string }) {
  const [translation, setTranslation] = useState(practiceTranslations.get(text) || "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function translate() {
    if (busy) return;
    setBusy(true); setFailed(false);
    try {
      const value = chinese || (await request<{ translation: string }>("translateText", { text })).translation;
      setTranslation(value);
      if (practiceTranslations.size >= 200) practiceTranslations.clear();
      practiceTranslations.set(text, value);
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  return <span className="practice-translation">{translation
    ? <Tip label="Chinese translation" icon={<Languages size={14} />}><span className="translation-content">{translation}</span></Tip>
    : <button type="button" className="material-action" disabled={busy} onClick={() => void translate()} title={failed ? "Translation failed. Click to retry." : "Prepare a Chinese translation, then hover over the icon to view it."}>{busy ? <LoaderCircle size={14} className="spin" /> : <Languages size={14} />}<span>{failed ? "Retry translation" : busy ? "Translating…" : label}</span></button>}
  </span>;
}
