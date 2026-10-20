"use client";

import { useRef, useState } from "react";
import { Check, CheckCheck, Eye, Lightbulb, PenLine, RefreshCw, Repeat2, RotateCcw } from "lucide-react";
import { buildCloze, clozeMatches, type Cloze, type ClozeLine } from "@/lib/cloze";
import { type Passage } from "./types";

const LEVELS = [{ id: "light", label: "轻", ratio: 0.15, note: "约 15% 的词" }, { id: "medium", label: "中", ratio: 0.3, note: "约 30% 的词" }, { id: "heavy", label: "重", ratio: 0.5, note: "约一半的词" }] as const;
type Level = (typeof LEVELS)[number]["id"];
type Status = "" | "correct" | "wrong" | "revealed";
const ratioOf = (level: Level) => LEVELS.find(item => item.id === level)!.ratio;

export function PassageCloze({ passage }: { passage: Passage }) {
  const [level, setLevel] = useState<Level>("medium");
  const [cloze, setCloze] = useState<Cloze>(() => buildCloze(passage.text, ratioOf("medium")));
  const [answers, setAnswers] = useState<string[]>([]); const [status, setStatus] = useState<Status[]>([]); const [hinted, setHinted] = useState<boolean[]>([]); const [checked, setChecked] = useState<boolean[]>([]);
  const lastFocused = useRef(0); const textRef = useRef<HTMLDivElement>(null);
  const total = cloze.blanks.length, correct = status.filter(item => item === "correct").length;
  const finished = total > 0 && status.filter(item => item === "correct" || item === "revealed").length === total;
  const open = (index: number, list = status) => list[index] !== "correct" && list[index] !== "revealed";
  const startOf = new Map(cloze.segments.map((segment, index) => [segment.lines[0], index]));

  function restart(next: Level = level) { setLevel(next); setCloze(buildCloze(passage.text, ratioOf(next))); setAnswers([]); setStatus([]); setHinted([]); setChecked([]); lastFocused.current = 0; }
  function focusBlank(index: number) { textRef.current?.querySelector<HTMLInputElement>(`input[data-blank="${index}"]`)?.focus(); }
  function nextOpen(from: number, list: Status[]) {
    for (let step = 1; step <= total; step++) { const index = (from + step) % total; if (open(index, list)) return index; }
    return -1;
  }
  function type(index: number, value: string) {
    const nextAnswers = [...answers]; nextAnswers[index] = value; setAnswers(nextAnswers);
    const nextStatus = [...status]; nextStatus[index] = clozeMatches(value, cloze.blanks[index].answer) ? "correct" : ""; setStatus(nextStatus);
    // A correct word moves straight on, so a verse can be typed in one go.
    if (nextStatus[index] === "correct") { const next = nextOpen(index, nextStatus); if (next >= 0) focusBlank(next); }
  }
  function hint() {
    const index = open(lastFocused.current) ? lastFocused.current : nextOpen(-1, status);
    if (index < 0) return;
    const answer = cloze.blanks[index].answer, typed = answers[index] || "";
    let known = 0;
    while (known < typed.length && known < answer.length && typed[known].toLowerCase() === answer[known].toLowerCase()) known++;
    const nextHinted = [...hinted]; nextHinted[index] = true; setHinted(nextHinted);
    type(index, answer.slice(0, known + 1));
    focusBlank(index);
  }
  function reveal() { setStatus(cloze.blanks.map((_, index) => status[index] === "correct" ? "correct" : "revealed")); }
  // Check one stanza without waiting for the whole text: misses are marked, then
  // focus goes to the first miss, or on to the next stanza when all are right.
  function check(segment: number) {
    const { blanks } = cloze.segments[segment];
    const nextStatus = [...status];
    for (const blank of blanks) if (open(blank)) nextStatus[blank] = clozeMatches(answers[blank] || "", cloze.blanks[blank].answer) ? "correct" : "wrong";
    setStatus(nextStatus);
    const nextChecked = [...checked]; nextChecked[segment] = true; setChecked(nextChecked);
    const last = blanks[blanks.length - 1], next = blanks.find(blank => nextStatus[blank] === "wrong") ?? cloze.blanks.findIndex((_, blank) => blank > last && open(blank, nextStatus));
    if (next >= 0) focusBlank(next);
  }
  function revealSegment(segment: number) {
    const nextStatus = [...status];
    for (const blank of cloze.segments[segment].blanks) if (open(blank)) nextStatus[blank] = "revealed";
    setStatus(nextStatus);
  }
  function retry(segment: number) {
    const { blanks } = cloze.segments[segment];
    const nextAnswers = [...answers], nextStatus = [...status], nextHinted = [...hinted];
    for (const blank of blanks) { nextAnswers[blank] = ""; nextStatus[blank] = ""; nextHinted[blank] = false; }
    setAnswers(nextAnswers); setStatus(nextStatus); setHinted(nextHinted);
    const nextChecked = [...checked]; nextChecked[segment] = false; setChecked(nextChecked);
    focusBlank(blanks[0]);
  }

  function renderLine(line: ClozeLine, index: number) {
    return <p className={`passage-line ${line.repeatOf !== undefined ? "is-repeat" : ""}`} key={index}>{line.tokens.map((token, position) => {
      const blank = line.slots[position];
      if (blank === undefined) return <span key={position}>{token.text}</span>;
      const state = status[blank] || "", value = answers[blank] || "";
      if (line.repeatOf !== undefined) return <button type="button" tabIndex={-1} key={position} className={`cloze-mirror ${state}`} onClick={() => focusBlank(blank)} title="重复的一行：在它第一次出现的位置填写">{state === "correct" || state === "revealed" ? token.text : value || " "}</button>;
      return <input key={position} data-blank={blank} className={`cloze-input ${state} ${hinted[blank] ? "hinted" : ""}`} style={{ width: `calc(${Math.max(2, token.text.length)}ch + 18px)` }}
        value={state === "revealed" ? cloze.blanks[blank].answer : value} readOnly={!open(blank)} maxLength={token.text.length + 12}
        onChange={event => type(blank, event.target.value)} onFocus={() => { lastFocused.current = blank; }}
        onKeyDown={event => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) check(cloze.blanks[blank].segment);
          else if (!open(blank)) { const next = nextOpen(blank, status); if (next >= 0) focusBlank(next); }
          else if (value.trim()) setStatus(list => { const copy = [...list]; copy[blank] = "wrong"; return copy; });
        }}
        aria-label={`第 ${blank + 1} 空，共 ${total} 空`} aria-invalid={state === "wrong"} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} />;
    })}{line.repeatOf !== undefined && <span className="repeat-mark" title="重复的歌词行，不再挖空"><Repeat2 size={12} /></span>}</p>;
  }
  function renderSegment(segment: number) {
    const { lines, blanks } = cloze.segments[segment];
    const right = blanks.filter(blank => status[blank] === "correct").length, missed = blanks.filter(blank => status[blank] === "wrong").length;
    const done = blanks.every(blank => !open(blank)), perfect = done && right === blanks.length;
    return <div className="cloze-segment" key={`segment-${segment}`}>
      {lines.map(index => renderLine(cloze.lines[index], index))}
      {blanks.length > 0 && <div className={`cloze-check ${perfect ? "is-perfect" : done ? "is-done" : checked[segment] ? "is-checked" : ""}`}>
        <span role="status">{perfect ? <><Check size={13} />这一段全对</> : checked[segment] || done ? `这一段填对 ${right} / ${blanks.length}${missed ? ` · ${missed} 处再想想` : ""}` : right ? `已填对 ${right} / ${blanks.length}` : `这一段 ${blanks.length} 空`}</span>
        <span className="cloze-check-actions">{!done && <button type="button" className="text-button" onClick={() => check(segment)} title="快捷键：Ctrl / ⌘ + Enter"><CheckCheck size={13} />检查这一段</button>}
        {!done && checked[segment] && <button type="button" className="text-button" onClick={() => revealSegment(segment)}><Eye size={13} />揭晓这一段</button>}
        {done && !perfect && <button type="button" className="text-button" onClick={() => retry(segment)}><RotateCcw size={13} />这一段再填一次</button>}</span>
      </div>}
    </div>;
  }

  return <section className="lesson-card practice-card cloze-card"><div className="section-top"><div className="section-label"><span className="section-icon"><PenLine size={17} /></span><h2>凭记忆，把它填回去</h2><span>FILL IT BACK</span></div><span className="item-count">{total} 处挖空</span></div>
    <p className="practice-intro">随机挖掉一些词，凭记忆填回去。填对会自动跳到下一空；写完一段就点下面的「检查这一段」（或按 Ctrl / ⌘ + Enter），不用等全部写完。重复出现的行不会再挖空，只会跟着第一次出现的位置一起显示 <Repeat2 size={12} />。</p>
    <div className="cloze-toolbar">
      <div className="cloze-levels" role="radiogroup" aria-label="挖空数量">{LEVELS.map(item => <button key={item.id} role="radio" aria-checked={level === item.id} className={level === item.id ? "active" : ""} title={item.note} onClick={() => restart(item.id)}>{item.label}<small>{item.note}</small></button>)}</div>
      <span className="cloze-progress"><b>{correct}</b> / {total} 已填对</span>
      <button className="text-button" onClick={() => restart()}><RefreshCw size={14} />换一批</button>
    </div>
    <div className="progress-track"><span style={{ width: `${total ? (100 * correct) / total : 0}%` }} /></div>
    <div className="passage-text cloze-text" ref={textRef}>
      {cloze.lines.map((line, index) => line.kind === "empty" ? <div className="passage-gap" key={index} /> : line.kind === "section" ? <div className="passage-section" key={index}>{line.text}</div> : startOf.has(index) ? renderSegment(startOf.get(index)!) : null)}
    </div>
    {finished ? <div className="dictation-result cloze-result" role="status"><span className="result-score">{correct}<small> / {total}</small></span><div><strong>{correct === total ? hinted.some(Boolean) ? "全部填出来了，提示也帮了点忙。" : "全部记住了！" : "琥珀色的是这次没想起来的词。"}</strong><p>{correct === total ? "合上屏幕哼一遍，或者调高难度再来一轮。" : "换一批再练，会挑选不同的词。"}</p></div><button className="primary-button" onClick={() => restart()}><RefreshCw size={15} />再练一轮</button></div>
      : total > 0 && <div className="cloze-actions"><button className="text-button" onClick={hint}><Lightbulb size={14} />提示一个字母</button><button className="text-button" onClick={reveal}><Eye size={14} />揭晓剩下的答案</button></div>}
  </section>;
}
