"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, Check, CheckCheck, ChevronRight, Info, Sprout } from "lucide-react";
import { type Feedback } from "./types";
import { request } from "./api";
import { Loading, TranslationHint } from "./shared";

export type ReviewExercise = { reviewId: string; scenario: string; sentence: string; stage: "blank" };

export type ReviewBlankResult = { correct: boolean; answer?: string; meaning?: string; feedback?: string; word?: string };

export type ReviewSentenceResult = { passed: boolean; feedback: Feedback; mastery: number };

export function Review({ count, onError, onSaved, onAdd }: { count: number; onError: (e: unknown) => void; onSaved: () => void; onAdd: () => void }) {
  const [exercise, setExercise] = useState<ReviewExercise | null>(null);
  const [answer, setAnswer] = useState(""); const [sentence, setSentence] = useState(""); const [busy, setBusy] = useState("");
  const [blankResult, setBlankResult] = useState<ReviewBlankResult | null>(null);
  const [result, setResult] = useState<ReviewSentenceResult | null>(null); const [completed, setCompleted] = useState(0);
  async function start() { setBusy("start"); try { setExercise(await request("reviewStart")); setAnswer(""); setSentence(""); setBlankResult(null); setResult(null); } catch (e) { onError(e); } finally { setBusy(""); } }
  async function blank(e: React.FormEvent) { e.preventDefault(); if (!exercise || !answer.trim() || busy || blankResult) return; setBusy("blank"); try { const res = await request<ReviewBlankResult>("reviewBlank", { reviewId: exercise.reviewId, answer }); setBlankResult(res); if (!res.correct) { setCompleted(n => n + 1); onSaved(); } } catch (err) { onError(err); } finally { setBusy(""); } }
  async function write(e: React.FormEvent) { e.preventDefault(); if (!exercise || !sentence.trim() || busy || result || !blankResult?.correct) return; setBusy("sentence"); try { const res = await request<ReviewSentenceResult>("reviewSentence", { reviewId: exercise.reviewId, answer: sentence }); setResult(res); setCompleted(n => n + 1); onSaved(); } catch (err) { onError(err); } finally { setBusy(""); } }
  const intro = count ? "Recall a word from context, then use it in a new sentence of your own. Words that need practice appear more often." : "Add a word and learn one meaning before starting your first review.";
  const ownInstruction = "Choose your own situation and write a new sentence using this word in the meaning you just reviewed. Show that you know when to use it. Minor grammar mistakes are OK; do not copy a lesson example.";
  return <div className="review-page" lang="en">
    <div className="review-title"><div className="eyebrow"><span className="little-dash" />COME BACK, GROW STRONGER</div><h1>Revisit. <em>Remember.</em></h1><p>Turn familiar words into your own expressions. <TranslationHint text="Turn familiar words into your own expressions." chinese="把学过的单词变成你自己的表达。" /></p></div>
    <div className="review-summary"><span><BookOpen size={17} /><b>{count}</b> meanings learned</span><span><CheckCheck size={17} /><b>{completed}</b> completed this round</span><span><Sprout size={17} />Better recall, less repetition</span></div>
    {!exercise ? <section className="lesson-card review-start">
      <div className="review-art"><span className="art-orbit" /><div className="art-card art-card-back">Aa</div><div className="art-card art-card-front"><Sprout size={32} strokeWidth={1.4} /><span>Make it stick.</span></div><span className="art-spark">✦</span></div>
      <span className="eyebrow">A LITTLE RECALL GOES A LONG WAY</span><h2>{count ? "Can you use it again?" : "Start with your first word."}</h2><p>{intro} <TranslationHint text={intro} chinese={count ? "先根据语境填词，再自主造一个新句子。需要巩固的词会更常出现。" : "先添加一个单词并学习一个词义，再开始复习。"} /></p>
      <button className="primary-button" onClick={() => count ? void start() : onAdd()} disabled={!!busy}>{busy ? <Loading label="Preparing review" /> : <>{count ? "Start review" : "Add a word"}<ArrowRight size={16} /></>}</button>
      <div className="review-rules"><span><span>01</span>Recall</span><ChevronRight size={15} /><span><span>02</span>Your own sentence</span><ChevronRight size={15} /><span><span>03</span>Reflect</span></div>
    </section> : <section className="lesson-card review-exercise">
      <div className="review-stepper"><span className={!blankResult ? "active" : "done"}><b>{blankResult?.correct ? <Check size={12} /> : "1"}</b>Recall the word</span><span className="step-line" /><span className={blankResult?.correct ? "active" : ""}><b>2</b>Your own sentence</span></div>
      {!blankResult?.correct ? <>
        <h2>Which word fits this context?</h2>
        <div className="scenario-box"><span className="eyebrow">CONTEXT</span><p>{exercise.scenario}</p><TranslationHint text={exercise.scenario} /></div>
        <p className="cloze-sentence">{exercise.sentence.split("____").map((part, index) => <span key={index}>{index > 0 && <span className="cloze-blank">?</span>}{part}</span>)}</p><TranslationHint text={exercise.sentence} />
        <form onSubmit={e => void blank(e)}><label className="field-label" htmlFor="review-blank">Fill in the missing word</label><div className="review-answer"><input id="review-blank" value={answer} onChange={e => setAnswer(e.target.value)} disabled={!!busy || !!blankResult} placeholder="The word is…" maxLength={100} required autoComplete="off" /><button className="primary-button" type="submit" disabled={!!busy || !answer.trim() || !!blankResult}>{busy === "blank" ? <Loading label="Checking" /> : <>Check answer <ArrowRight size={15} /></>}</button></div></form>
        {blankResult && <div className="review-failure" role="status"><h3>Another chance to remember.</h3><p>The word is <strong>{blankResult.answer}</strong>.</p><p>{blankResult.meaning} {blankResult.meaning && <TranslationHint text={blankResult.meaning} />}</p><p>{blankResult.feedback} {blankResult.feedback && <TranslationHint text={blankResult.feedback} />}</p></div>}
      </> : <>
        <div className="success-note"><CheckCheck size={16} />Correct! Now choose your own context.</div><h2>Make a new sentence with <em>{blankResult.word}</em>.</h2>
        <p className="practice-intro">{ownInstruction} <TranslationHint text={ownInstruction} chinese="请自己选择场景，使用刚复习的词义造一个全新的句子，展示你知道何时使用它。允许小的语法错误，但不要照抄例句。" /></p>
        <form onSubmit={e => void write(e)}><label className="field-label" htmlFor="review-sentence">Your original sentence<span>Meaning and context matter most</span></label><textarea id="review-sentence" value={sentence} onChange={e => setSentence(e.target.value)} disabled={!!busy || !!result} rows={4} placeholder="Choose your own situation…" required maxLength={1200} /><div className="form-footer"><span>{sentence.length} / 1200</span><button className="primary-button" type="submit" disabled={!!busy || !sentence.trim() || !!result}>{busy === "sentence" ? <Loading label="Reading your sentence" /> : <>Finish review <Check size={16} /></>}</button></div></form>
        {result && <><section className={`feedback-card ${result.feedback.appropriate ? "good" : "improve"}`} role="status"><div className="feedback-heading"><span><Sprout size={20} /></span><h3>{result.passed ? "A natural use of the word" : "Keep exploring its meaning"}</h3><b>{result.feedback.score}<small> / 100</small></b></div>{[{ label: "MEANING & YOUR CONTEXT", text: result.feedback.scenarioFeedback }, { label: "GRAMMAR", text: result.feedback.grammarFeedback }, { label: "A REFINED VERSION", text: result.feedback.improvedSentence }].map(part => <div className="feedback-part" key={part.label}><span className="eyebrow">{part.label}</span><p>{part.text} <TranslationHint text={part.text} /></p></div>)}</section><p className="review-outcome"><Sprout size={15} />{result.passed ? "This meaning will appear less often as your confidence grows." : "This meaning will return sooner for more practice."}</p></>}
      </>}
      {(result || (blankResult && !blankResult.correct)) && <button className="primary-button next-review" disabled={!!busy} onClick={() => void start()}>{busy === "start" ? <Loading label="Preparing" /> : <>Next word <ArrowRight size={15} /></>}</button>}
    </section>}
    <p className="review-bottom"><Info size={13} />Each meaning has its own review progress.</p>
  </div>;
}
