# Lexi API contract

All routes require ChatGPT user identity. JSON errors `{error:string,code:string}`. Never send keys from browser. POST `/api/action` JSON `{action,...}`. GET `/api/state` returns `{senses:Sense[],settings:{textModel,voiceModel},services:{text:boolean,speech:boolean},user:{displayName}}`.

`Sense = {id,word,phonetic,pos,meaning,definition,learned,mastery,reviewCount,createdAt,materials:Material[]}`.
`Material = {id,kind:'description'|'example'|'synonym'|'antonym',text,term?,relationNote?,translation?,scene?:{title,description,emoji,background,foreground}}`.

Actions and results:
- `lookup {word}` -> `{senses: [{id,word,phonetic,pos,meaning,definition}]}`. Lookup choices have server-persisted ids; select one.
- `select {senseId}` -> `{sense}`; material generation if needed, mark learned.
- `augment {senseId,kind}` -> `{sense}`; kind one of four Material kinds.
- `translate {senseId,materialId}` -> `{sense}`; add Chinese translation to material, UI must conceal until hover/focus.
- `illustrate {senseId,materialId}` -> `{sense}`; add truthful text-model scene illustration data (not generated photo), UI conceals until hover/focus.
- `writingScenario {senseId}` -> `{exerciseId,scenario}` (Chinese scenario).
- `writingSubmit {exerciseId,answer}` -> `{feedback:{appropriate:boolean,score:number,scenarioFeedback:string,grammarFeedback:string,improvedSentence:string}}`.
- `listeningStart {senseId,materialId}` -> `{sessionId,voices:[{id,label}],submitted:false}`. Starts a fresh attempt while retaining all available voices previously saved for this user's material and text, including added voices. The response has NO original sentence. At least 3 distinct English voices selected on server.
- `listeningMore {sessionId}` -> `{voices:[{id,label}]}` (full list).
- `listeningAudio {sessionId,voiceId}` -> `{url}`. URL points to authenticated `/api/audio?id=...`. Cache in R2. Voice ids selected server-side.
- `listeningSubmit {sessionId,answer}` -> `{score:number,submitted:true}`. Nonempty attempt required; original is only retrieved afterward.
- `listeningHint {sessionId}` -> `{text,translation?}`; rejects before attempt with 403. UI shows returned answer only on hover/focus after submission.
- `reviewStart {}` -> `{reviewId,scenario,sentence,stage:'blank'}`. Answer and identity of target sense deliberately omitted.
- `reviewBlank {reviewId,answer}` -> `{correct:false,answer,meaning,feedback}` on failure; or `{correct:true,scenario,word,meaning,stage:'sentence'}` on success. Success gives a NEW scenario to write an original sentence.
- `reviewSentence {reviewId,answer}` -> `{passed:boolean,feedback:{appropriate,score,scenarioFeedback,grammarFeedback,improvedSentence},mastery:number}`. Scenario appropriateness matters more than grammar; copied materials rejected.
- `settings {textModel,voiceModel}` -> `{settings}`. Only model IDs, no secrets.

Refresh GET state after changed data if necessary. Demo data is frontend-only and must remain explicitly labelled; failed backend calls must show the service error.
