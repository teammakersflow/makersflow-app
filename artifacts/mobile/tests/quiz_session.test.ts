// Lesson quiz: answers were all graded "incorrect" (2026-11-16).
// Root cause: GET /quiz-questions/lesson/:id intentionally omits
// correct_option_index, and the app's fallback (a legacy Supabase RPC
// check_quiz_answer) does not exist in the current backend. The app now
// submits all answers once to POST /quiz-attempts/submit and shows the
// server's grading.
//
// Runtime tests use the production module lib/quizSession.ts against a fake
// server that applies the backend's submit rules (quiz-attempts.service.ts:
// answers object of question uuid -> integer 0..3, ids must belong to the
// lesson, strict integer comparison with correct_option_index, unanswered =
// wrong, response { score, total_questions, results }).
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSubmitPayload,
  mapQuizQuestions,
  parseSubmitResult,
  selectAnswer,
  selectedFor,
  type QuizAnswers,
} from "../lib/quizSession.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*$/gm, "");

const Q1 = "6f1c2c1e-0b1a-4d3e-9a10-000000000001";
const Q2 = "6f1c2c1e-0b1a-4d3e-9a10-000000000002";
const Q3 = "6f1c2c1e-0b1a-4d3e-9a10-000000000003";

/** Rows as stored (the student GET never includes correct_option_index). */
const DB = [
  { id: Q1, lesson_id: 42n, question_text: "What does an LED emit?", options: ["Sound", "Light", "Heat only", "Nothing"], correct_option_index: 1, position: 0 },
  { id: Q2, lesson_id: 42n, question_text: "Unit of resistance?", options: '["Volt","Ampere","Ohm","Watt"]', correct_option_index: 2, position: 1 },
  { id: Q3, lesson_id: 42n, question_text: "Arduino Uno MCU?", options: ["ATmega328P", "ESP32", "STM32", "RP2040"], correct_option_index: 0, position: 2 },
];

/** GET /quiz-questions/lesson/42, as the backend selects it for students. */
const studentGet = () =>
  DB.map(({ id, lesson_id, question_text, options, position }) => ({ id, lesson_id: String(lesson_id), question_text, options, position, created_at: "2026-11-01T00:00:00Z" }));

/** POST /quiz-attempts/submit, following quiz-attempts.service.ts. */
function fakeSubmit(body: any) {
  const { lesson_id, answers } = body;
  if (typeof lesson_id !== "string" || !/^\d+$/.test(lesson_id)) throw Object.assign(new Error("Bad lesson_id"), { status: 400 });
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw Object.assign(new Error("Invalid answers"), { status: 400 });
  for (const [qid, idx] of Object.entries(answers)) {
    if (!qid || !Number.isInteger(idx) || (idx as number) < 0 || (idx as number) > 3) throw Object.assign(new Error("Invalid answer selection"), { status: 400 });
  }
  const qs = DB.filter((q) => String(q.lesson_id) === lesson_id);
  const valid = new Set(qs.map((q) => q.id));
  for (const qid of Object.keys(answers)) if (!valid.has(qid)) throw Object.assign(new Error("Not this lesson"), { status: 400 });
  let score = 0;
  const results: Record<string, { isCorrect: boolean; correctOptionIndex: number }> = {};
  for (const q of qs) {
    const sel = (answers as any)[q.id];
    const isCorrect = sel !== undefined && sel === q.correct_option_index;
    if (isCorrect) score++;
    results[q.id] = { isCorrect, correctOptionIndex: q.correct_option_index };
  }
  return { score, total_questions: qs.length, results };
}

/** The quiz screen's flow in miniature, using the production helpers. */
function quizRun(lessonId: string | number = 42) {
  const questions = mapQuizQuestions(studentGet());
  let answers: QuizAnswers = {};
  let index = 0;
  const submitted: any[] = [];
  return {
    questions,
    get index() { return index; },
    get answers() { return answers; },
    get selected() { return selectedFor(answers, questions[index]); },
    tap(option: number) { answers = selectAnswer(answers, questions[index], option); },
    next() { if (selectedFor(answers, questions[index]) !== null && index < questions.length - 1) index++; },
    finish() {
      const body = buildSubmitPayload(lessonId, questions, answers);
      submitted.push(body);
      return parseSubmitResult(fakeSubmit(JSON.parse(JSON.stringify(body))), questions);
    },
    submitted,
  };
}

describe("loading questions", () => {
  test("maps the student API (array or { data }) and never relies on a correct-answer field", () => {
    const qs = mapQuizQuestions(studentGet());
    assert.equal(qs.length, 3);
    assert.deepEqual(qs.map((q) => q.id), [Q1, Q2, Q3], "uuid string ids, server order kept");
    assert.deepEqual(qs[1].options, ["Volt", "Ampere", "Ohm", "Watt"], "JSON-string options parsed");
    assert.deepEqual(mapQuizQuestions({ data: studentGet() }).map((q) => q.id), [Q1, Q2, Q3]);
    assert.ok(qs.every((q) => !("correctIndex" in q) && !("correct_option_index" in q)));
  });

  test("bad rows are skipped instead of breaking the quiz", () => {
    const qs = mapQuizQuestions([
      { id: "a", question_text: "ok", options: ["x", "y"] },
      { id: "", question_text: "no id", options: ["x", "y"] },
      { id: "b", question_text: "", options: ["x", "y"] },
      { id: "c", question_text: "one option", options: ["x"] },
      { id: "d", question_text: "broken json", options: "[not json" },
      { id: "e", question_text: "five options", options: ["1", "2", "3", "4", "5"] },
    ]);
    assert.deepEqual(qs.map((q) => q.id), ["a", "e"]);
    assert.equal(qs[1].options.length, 4, "the backend accepts indexes 0..3 only");
    assert.deepEqual(mapQuizQuestions(null), []);
    assert.deepEqual(mapQuizQuestions({ message: "x" }), []);
  });
});

describe("grading (server-side)", () => {
  test("selecting the correct option is graded correct", () => {
    const run = quizRun();
    run.tap(1); run.next(); run.tap(2); run.next(); run.tap(0);
    const r = run.finish();
    assert.equal(r.score, 3);
    assert.equal(r.total, 3);
    for (const id of [Q1, Q2, Q3]) assert.equal(r.results[id].isCorrect, true);
  });

  test("selecting an incorrect option is graded incorrect, with the right answer from the server", () => {
    const run = quizRun();
    run.tap(0); run.next(); run.tap(2); run.next(); run.tap(3);
    const r = run.finish();
    assert.equal(r.score, 1);
    assert.deepEqual(
      [Q1, Q2, Q3].map((id) => r.results[id]),
      [
        { isCorrect: false, correctOptionIndex: 1 },
        { isCorrect: true, correctOptionIndex: 2 },
        { isCorrect: false, correctOptionIndex: 0 },
      ],
    );
  });

  test("not every option is correct: exactly one option per question scores", () => {
    for (let q = 0; q < 3; q++) {
      let correct = 0;
      for (let opt = 0; opt < 4; opt++) {
        const run = quizRun();
        for (let i = 0; i < 3; i++) { run.tap(i === q ? opt : 3); run.next(); }
        if (run.finish().results[[Q1, Q2, Q3][q]].isCorrect) correct++;
      }
      assert.equal(correct, 1, `question ${q + 1}`);
    }
  });

  test("submit payload matches the backend contract exactly", () => {
    const run = quizRun(42); // lesson id as a number from the route
    run.tap(1); run.next(); run.tap(2); run.next(); run.tap(0);
    run.finish();
    assert.deepEqual(run.submitted[0], { lesson_id: "42", answers: { [Q1]: 1, [Q2]: 2, [Q3]: 0 } });
    assert.equal(typeof run.submitted[0].lesson_id, "string");
    assert.ok(Object.values(run.submitted[0].answers).every((v) => Number.isInteger(v)), "integer indexes, not labels");
    assert.deepEqual(buildSubmitPayload("42", run.questions, { [Q1]: 1 }).lesson_id, "42", "string lesson id too");
  });

  test("ids and numbers in the response are read whether they are numbers or numeric strings", () => {
    const qs = mapQuizQuestions(studentGet());
    const r = parseSubmitResult(
      { data: { score: "2", total_questions: "3", results: { [Q1]: { isCorrect: true, correctOptionIndex: "1" }, [Q2]: { isCorrect: true, correctOptionIndex: 2 }, [Q3]: { isCorrect: false, correctOptionIndex: 0 } } } },
      qs,
    );
    assert.deepEqual([r.score, r.total], [2, 3]);
    assert.equal(r.results[Q1].correctOptionIndex, 1);
    // isCorrect must be a real boolean true; "true"/1 are not treated as correct
    const strict = parseSubmitResult({ score: 0, total_questions: 3, results: { [Q1]: { isCorrect: "true" }, [Q2]: { isCorrect: 1 } } }, qs);
    assert.equal(strict.results[Q1].isCorrect, false);
    assert.equal(strict.results[Q2].isCorrect, false);
  });

  test("an unusable or inconsistent response is an error (retry), never a made-up score", () => {
    const qs = mapQuizQuestions(studentGet());
    assert.throws(() => parseSubmitResult({ score: 3 }, qs));
    assert.throws(() => parseSubmitResult(null, qs));
    assert.throws(() => parseSubmitResult({ score: 5, total_questions: 3, results: {} }, qs));
    // score missing: counted from the server's per-question verdicts
    const counted = parseSubmitResult({ results: { [Q1]: { isCorrect: true }, [Q2]: { isCorrect: false } } }, qs);
    assert.deepEqual([counted.score, counted.total], [1, 3]);
  });
});

describe("selection and navigation", () => {
  test("changing the selection before moving on sends only the last choice", () => {
    const run = quizRun();
    run.tap(0); run.tap(3); run.tap(1);
    assert.equal(run.selected, 1);
    run.next(); run.tap(2); run.next(); run.tap(0);
    assert.equal(run.finish().score, 3);
    assert.equal(run.submitted[0].answers[Q1], 1);
  });

  test("the next question starts without a selection; earlier answers are kept per question", () => {
    const run = quizRun();
    run.tap(1);
    run.next();
    assert.equal(run.index, 1);
    assert.equal(run.selected, null, "no carry-over to question 2");
    run.tap(3);
    assert.equal(run.answers[Q1], 1, "question 1 unchanged");
    assert.equal(run.answers[Q2], 3);
  });

  test("Next does nothing until an option is chosen", () => {
    const run = quizRun();
    run.next();
    assert.equal(run.index, 0);
  });

  test("questions are independent: an answer index only applies to its own question", () => {
    const qs = mapQuizQuestions(studentGet());
    let a: QuizAnswers = {};
    a = selectAnswer(a, qs[0], 1);
    a = selectAnswer(a, qs[2], 1);
    assert.deepEqual(a, { [Q1]: 1, [Q3]: 1 });
    assert.equal(selectedFor(a, qs[1]), null);
  });

  test("invalid taps are ignored (out of range, non-integer)", () => {
    const qs = mapQuizQuestions(studentGet());
    const a = selectAnswer({}, qs[0], 1);
    assert.equal(selectAnswer(a, qs[0], 4), a);
    assert.equal(selectAnswer(a, qs[0], -1), a);
    assert.equal(selectAnswer(a, qs[0], 1.5), a);
  });
});

describe("completion", () => {
  test("time running out submits only the answered questions; unanswered count as wrong (no -1 sent)", () => {
    const run = quizRun();
    run.tap(1); run.next(); // Q2 and Q3 never answered
    const r = run.finish();
    assert.deepEqual(run.submitted[0].answers, { [Q1]: 1 });
    assert.deepEqual([r.score, r.total], [1, 3]);
    assert.equal(r.results[Q3].isCorrect, false);
  });

  test("answers outside the quiz are never sent (the server would reject the whole submit)", () => {
    const qs = mapQuizQuestions(studentGet());
    const body = buildSubmitPayload(42, qs, { [Q1]: 1, "other-lesson-question": 2, [Q2]: 7 as any });
    assert.deepEqual(body.answers, { [Q1]: 1 });
    assert.doesNotThrow(() => fakeSubmit(body));
  });

  test("result screen receives the server's score and total", () => {
    const run = quizRun();
    run.tap(1); run.next(); run.tap(0); run.next(); run.tap(0);
    const r = run.finish();
    assert.deepEqual([r.score, r.total], [2, 3]);
    const pct = Math.round((r.score / r.total) * 100); // as app/quiz/result.tsx computes it
    assert.equal(pct, 67);
  });
});

describe("quiz screen wiring (source)", () => {
  const src = strip(read("app/quiz/[id].tsx"));

  test("no legacy Supabase RPC and no client-side answer key", () => {
    assert.doesNotMatch(src, /check_quiz_answer/);
    assert.doesNotMatch(src, /supabase/);
    assert.doesNotMatch(src, /correct_option_index|correctIndex/);
  });

  test("questions come from the student API; grading from POST /quiz-attempts/submit", () => {
    assert.match(src, /apiRequest<any>\(`\/quiz-questions\/lesson\/\$\{lessonId\}`\)/);
    assert.match(src, /const mapped = mapQuizQuestions\(res\);/);
    assert.match(src, /const payload = buildSubmitPayload\(lessonId, qs, answersRef\.current\);/);
    assert.match(src, /apiRequest<any>\("\/quiz-attempts\/submit", \{\s*method: "POST",\s*body: JSON\.stringify\(payload\),\s*\}\);/);
    assert.match(src, /const result = parseSubmitResult\(res, qs\);/);
    assert.match(src, /score: result\.score\.toString\(\),\s*total: result\.total\.toString\(\),/);
  });

  test("one submit at a time; a failed submit offers a retry instead of a score", () => {
    assert.match(src, /if \(finishedRef\.current \|\| submittingRef\.current\) return;/);
    assert.match(src, /"Couldn't submit quiz"/);
    assert.match(src, /\{ text: "Try again", onPress: \(\) => \{ void finishQuiz\(\); \} \}/);
    assert.match(src, /setTimeout\(\(\) => \{ void finishQuiz\(\); \}, 0\);/, "timer expiry submits too");
  });

  test("selection: one answer per question id, changeable, shown on the chosen option only", () => {
    assert.match(src, /const selectedOption = selectedFor\(answers, question\);/);
    assert.match(src, /setAnswers\(\(prev\) => selectAnswer\(prev, question, idx\)\);/);
    assert.match(src, /disabled=\{isSubmitting\}/);
    assert.match(src, /if \(idx === selectedOption\) \{\s*return \{ bg: colors\.accent, border: colors\.primary, text: colors\.foreground \};/);
  });

  test("result screen is unchanged and reads score/total params", () => {
    const res = strip(read("app/quiz/result.tsx"));
    assert.match(res, /const \{ quizId, score, total, title \} = useLocalSearchParams/);
    assert.match(res, /const pct = Math\.round\(\(scoreNum \/ totalNum\) \* 100\);/);
  });
});
