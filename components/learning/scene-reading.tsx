"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpen, CheckCheck, Info, LoaderCircle, Plus, Quote, Search, X } from "lucide-react";
import { parsePassage, phraseSpans, type PassageLine } from "@/lib/cloze";
import { type Passage, type Sense, type Notify } from "./types";
import { ApiError, request } from "./api";
import { Highlight, Loading } from "./shared";

type Pick = { line: number; selection: string };
type Lookup = Pick & { status: "loading" | "ready" | "error"; sense?: Sense; collected?: boolean; error?: string };

const MAX_WORDS = 6;
const edges = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function PassageReading({ passage, phraseError, onRetryPhrases, onSense, onOpenSense, onError, notify }: { passage: Passage; phraseError?: string; onRetryPhrases: () => void; onSense: (s: Sense) => void; onOpenSense: (id: string) => void; onError: (e: unknown) => void; notify: Notify }) {
  const lines = useMemo(() => parsePassage(passage.text), [passage.text]);
  const spans = useMemo(() => lines.map(line => line.kind === "text" && passage.phrases ? phraseSpans(line, passage.phrases.filter(item => item.line === line.text)) : []), [lines, passage.phrases]);
  const [lookup, setLookup] = useState<Lookup | null>(null); const [pending, setPending] = useState<Pick | null>(null); const [adding, setAdding] = useState(false);
  const version = useRef(0); const textRef = useRef<HTMLDivElement>(null); const current = useRef<Lookup | null>(null);
  useEffect(() => { current.current = lookup; }, [lookup]);

  // Dragging across several words (or a long-press on touch screens) offers a phrase lookup.
  useEffect(() => {
    let timer = 0;
    function capture() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const lineOf = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-line]");
      const start = lineOf(selection.anchorNode), end = lineOf(selection.focusNode);
      if (!start || start !== end || !textRef.current?.contains(start)) return;
      const text = selection.toString().replace(/\s+/g, " ").replace(edges, "");
      const line = Number(start.dataset.line), active = current.current;
      if (!/[a-z]/i.test(text) || (active?.line === line && active.selection.toLowerCase() === text.toLowerCase())) return;
      setPending({ line, selection: text });
    }
    const listener = () => { window.clearTimeout(timer); timer = window.setTimeout(capture, 180); };
    document.addEventListener("selectionchange", listener);
    return () => { window.clearTimeout(timer); document.removeEventListener("selectionchange", listener); };
  }, []);

  async function look({ line, selection }: Pick) {
    const active = current.current;
    if (active && active.status !== "error" && active.line === line && active.selection === selection) return;
    const id = ++version.current;
    setPending(null); setLookup({ line, selection, status: "loading" });
    try {
      const result = await request<{ sense: Sense; collected: boolean }>("passageLookup", { passageId: passage.id, line: lines[line].text, selection });
      if (id === version.current) setLookup({ line, selection, status: "ready", sense: result.sense, collected: result.collected });
    } catch (err) {
      if (err instanceof ApiError && err.code === "auth") onError(err);
      if (id === version.current) setLookup({ line, selection, status: "error", error: err instanceof Error ? err.message : "没有查到这个词，请重试。" });
    }
  }
  async function add() {
    const target = lookup;
    if (!target?.sense || adding) return;
    const id = version.current, learned = target.sense.learned;
    setAdding(true);
    try {
      const result = await request<{ sense: Sense; collected: boolean }>("passageAdd", { passageId: passage.id, line: lines[target.line].text, senseId: target.sense.id });
      onSense(result.sense);
      notify(learned ? `已把这一句收进 ${result.sense.word} 的例句` : `已把 ${result.sense.word} 加入单词本，原句也一起收录了`);
      if (id === version.current) setLookup({ ...target, sense: result.sense, collected: result.collected });
    } catch (err) { onError(err); } finally { setAdding(false); }
  }
  function wordAt(element: Element | null): Pick | null {
    const word = element?.closest<HTMLElement>("[data-word]"), line = word?.closest<HTMLElement>("[data-line]");
    return word && line ? { line: Number(line.dataset.line), selection: word.dataset.word || "" } : null;
  }
  function keys(event: React.KeyboardEvent) {
    const words = Array.from(textRef.current?.querySelectorAll<HTMLElement>("[data-word]") || []);
    const index = words.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const hit = wordAt(words[index]); if (hit) void look(hit); return; }
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step) { event.preventDefault(); words[Math.max(0, Math.min(words.length - 1, index + step))].focus(); }
  }

  const picked = new Set(lookup?.selection.toLowerCase().split(" "));
  // A multi-word lookup can be split, in case only one of its words was meant.
  const parts = lookup ? [...new Set(parsePassage(lookup.selection)[0]?.tokens.filter(token => token.word).map(token => token.text))] : [];
  const phraseCount = spans.reduce((sum, list) => sum + list.length, 0);
  const tooLong = !!pending && pending.selection.split(" ").length > MAX_WORDS;
  const sense = lookup?.status === "ready" ? lookup.sense : undefined;
  // One tab stop for the whole text; arrow keys move between words.
  const firstLine = lines.findIndex(line => line.tokens.some(token => token.word)), firstToken = lines[firstLine]?.tokens.findIndex(token => token.word);
  // A marked expression is one tap target; its words light up alone when one of them was looked up.
  function words(line: PassageLine, index: number) {
    const active = lookup?.line === index, nodes: React.ReactNode[] = [];
    const focus = (position: number) => index === firstLine && position === firstToken ? 0 : -1;
    for (let position = 0; position < line.tokens.length; position++) {
      const token = line.tokens[position], span = spans[index].find(item => item.start === position);
      if (span) {
        const whole = active && lookup.selection.toLowerCase() === span.text.toLowerCase();
        nodes.push(<span key={position} className={`passage-word passage-phrase ${whole ? "is-picked" : ""}`} data-word={span.text} title={`词组：${span.phrase}`} role="button" tabIndex={focus(position)}>{line.tokens.slice(position, span.end + 1).map((part, n) => <span key={n} className={!whole && active && part.word && picked.has(part.text.toLowerCase()) ? "is-picked" : undefined}>{part.text}</span>)}</span>);
        position = span.end;
      } else if (!token.word) nodes.push(<span key={position}>{token.text}</span>);
      else nodes.push(<span key={position} className={`passage-word ${active && picked.has(token.text.toLowerCase()) ? "is-picked" : ""}`} data-word={token.text} role="button" tabIndex={focus(position)}>{token.text}</span>);
    }
    return nodes;
  }
  return <div className="scene-layout">
    <section className="lesson-card practice-card passage-card"><div className="section-top"><div className="section-label"><span className="section-icon"><BookOpen size={17} /></span><h2>在原文里读懂它</h2><span>READ IN CONTEXT</span></div>{passage.phrases ? <span className="item-count">{phraseCount ? `${phraseCount} 处词组 · 轻点整体查询` : "轻点单词 · 拖选短语"}</span> : phraseError ? <span className="item-count">轻点单词 · 拖选短语</span> : <span className="item-count phrase-status"><LoaderCircle size={11} className="spin" />正在标出词组…</span>}</div>
      <p className="practice-intro">遇到想弄懂的词，轻点它；虚线标出的是词组和固定搭配，点其中任一个词就会整体查询。想查别的短语，就拖选几个词。词义按它所在的这一句来判断，加入单词本时，这句原文会成为它的例句。</p>
      {phraseError && <p className="inline-error phrase-error" role="alert">词组没有标出来：{phraseError}<button className="text-button" onClick={onRetryPhrases}>重新识别</button></p>}
      <div className="passage-text" ref={textRef} onKeyDown={keys} onClick={event => { if (window.getSelection()?.isCollapsed === false) return; const hit = wordAt(event.target as Element); if (hit) void look(hit); }}>
        {lines.map((line, index) => line.kind === "empty" ? <div className="passage-gap" key={index} /> : line.kind === "section" ? <div className="passage-section" key={index}>{line.text}</div> :
          <p className={`passage-line ${lookup?.line === index ? "is-active" : ""}`} data-line={index} key={index}>{words(line, index)}</p>)}
      </div>
    </section>
    <aside className={`scene-lookup ${lookup || pending ? "is-active" : ""}`} aria-live="polite">
      <div className="lesson-card lookup-card">
        {pending && <div className="lookup-pending"><div className="lookup-top"><span className="eyebrow">SELECTED</span><button className="icon-button" onClick={() => setPending(null)} aria-label="取消选择"><X size={15} /></button></div><p>“{pending.selection}”</p>{tooLong ? <span className="inline-error">一次最多查询 {MAX_WORDS} 个词，请缩短选择。</span> : <button className="primary-button full-width" onClick={() => void look(pending)}><Search size={15} />按这一句查询</button>}</div>}
        {lookup ? <div className="lookup-result">
          <div className="lookup-top"><span className="eyebrow">IN THIS LINE</span><button className="icon-button" onClick={() => { version.current++; setLookup(null); }} aria-label="关闭词义"><X size={15} /></button></div>
          {lookup.status === "loading" && <div className="lookup-loading"><Loading label={`正在结合上下文理解「${lookup.selection}」…`} /></div>}
          {lookup.status === "error" && <><p className="inline-error" role="alert">{lookup.error}</p><button className="text-button" onClick={() => void look({ line: lookup.line, selection: lookup.selection })}>重新查询 <ArrowRight size={13} /></button></>}
          {sense && <>
            <div className="lookup-word"><h3>{sense.word}</h3>{sense.phonetic && <span className="word-pronunciation">{sense.phonetic}</span>}</div>
            {lookup.selection.toLowerCase() !== sense.word && <p className="lookup-origin">原文：<em>{lookup.selection}</em></p>}
            <div className="word-meaning"><span className="pos-tag">{sense.pos}</span><span>{sense.meaning}</span></div>
            <p className="lookup-definition">{sense.definition}</p>
            <blockquote className="lookup-line"><Quote size={12} /><span><Highlight text={lines[lookup.line].text} word={lookup.selection} /></span></blockquote>
            <div className="lookup-actions">
              {!sense.learned ? <button className="primary-button full-width" disabled={adding} onClick={() => void add()}>{adding ? <Loading label="正在生成学习材料…" /> : <><Plus size={15} />加入单词本</>}</button>
                : lookup.collected ? <span className="success-note"><CheckCheck size={15} />已在单词本，并收录了这一句</span>
                : <><span className="lookup-known">这个词义已在单词本中。</span><button className="text-button" disabled={adding} onClick={() => void add()}>{adding ? <Loading label="收录中" /> : <><Quote size={13} />把这一句收进例句</>}</button></>}
              {sense.learned && <button className="text-button" onClick={() => onOpenSense(sense.id)}>去学习这个词义 <ArrowRight size={13} /></button>}
            </div>
          </>}
          {lookup.status !== "loading" && parts.length > 1 && <div className="lookup-split"><span>拆开单独查</span>{parts.map(part => <button key={part} className="lookup-chip" onClick={() => void look({ line: lookup.line, selection: part })}>{part}</button>)}</div>}
        </div> : !pending && <div className="lookup-idle"><span className="eyebrow">READ IN CONTEXT</span><h3>同一个词，<br />在不同句子里不一样。</h3><p>轻点任意单词，按它所在的这一句给出词义；虚线标出的词组会整体查询，拖选几个词可以查询其他短语。</p><p className="lookup-tip"><Info size={13} />已经学过的词义会被认出来，不会重复加入。</p></div>}
      </div>
    </aside>
  </div>;
}
