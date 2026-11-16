/**
 * Lesson quiz logic (2026-11-16). Pure module with no imports, so node tests
 * can load it directly.
 *
 * Root cause of "every option is marked incorrect": the student endpoint
 * GET /quiz-questions/lesson/:lessonId intentionally never returns
 * `correct_option_index` (answers must not reach the device), and the app's
 * fallback, a legacy Supabase RPC `check_quiz_answer`, does not exist in the
 * current backend. So every selection was graded "wrong" and the score was 0.
 *
 * The backend grades quizzes server-side with
 *   POST /quiz-attempts/submit
 *   body:     { lesson_id: "<digits>", answers: { "<question uuid>": <option index 0-3> } }
 *   response: { score, total_questions, results: { [questionId]: { isCorrect, correctOptionIndex } } }
 * (one quiz attempt is recorded per call; unanswered questions count as wrong;
 * an index outside 0..3 or a question from another lesson is rejected).
 * The app now collects one answer per question and submits once at the end.
 */

export interface QuizQuestion {
  /** quiz_questions.id (uuid string) - the key the backend expects. */
  id: string;
  question: string;
  options: string[];
}

/** Selected option index per question id. */
export type QuizAnswers = Record<string, number>;

export interface QuizSubmitPayload {
  lesson_id: string;
  answers: QuizAnswers;
}

export interface QuizQuestionResult {
  isCorrect: boolean;
  correctOptionIndex: number | null;
}

export interface QuizResult {
  score: number;
  total: number;
  results: Record<string, QuizQuestionResult>;
}

/** The backend accepts option indexes 0..3 only. */
export const MAX_OPTION_INDEX = 3;

function parseOptions(raw: unknown): string[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.map((o) => (o == null ? "" : String(o))) : [];
}

/**
 * Maps GET /quiz-questions/lesson/:lessonId (plain array or { data: [...] }).
 * Questions without an id, text or at least two options are skipped. Any
 * correct-answer field is ignored on purpose: grading is server-side only.
 */
export function mapQuizQuestions(response: unknown): QuizQuestion[] {
  const r = response as any;
  const list = Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
  const out: QuizQuestion[] = [];
  for (const q of list) {
    const id = q?.id == null ? "" : String(q.id);
    const question = typeof q?.question_text === "string" ? q.question_text : "";
    const options = parseOptions(q?.options).slice(0, MAX_OPTION_INDEX + 1);
    if (!id || !question || options.length < 2) continue;
    out.push({ id, question, options });
  }
  return out;
}

/** Select (or change) the answer for one question. Other questions are untouched. */
export function selectAnswer(answers: QuizAnswers, question: QuizQuestion, optionIndex: number): QuizAnswers {
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= question.options.length) return answers;
  return { ...answers, [question.id]: optionIndex };
}

/** The selection shown for a question (null when not answered yet). */
export function selectedFor(answers: QuizAnswers, question: QuizQuestion | undefined): number | null {
  if (!question) return null;
  const v = answers[question.id];
  return Number.isInteger(v) ? v : null;
}

/**
 * Body for POST /quiz-attempts/submit. Only answered questions of this quiz
 * are sent (unanswered ones are graded wrong by the server, which also
 * rejects -1 or any index outside 0..3).
 */
export function buildSubmitPayload(lessonId: string | number, questions: QuizQuestion[], answers: QuizAnswers): QuizSubmitPayload {
  const ids = new Set(questions.map((q) => q.id));
  const out: QuizAnswers = {};
  for (const q of questions) {
    const v = answers[q.id];
    if (ids.has(q.id) && Number.isInteger(v) && v >= 0 && v <= MAX_OPTION_INDEX && v < q.options.length) out[q.id] = v;
  }
  return { lesson_id: String(lessonId).trim(), answers: out };
}

function toInt(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

/**
 * Reads the submit response (plain or { data: ... }). The server's verdict
 * is used as is; the score falls back to counting `isCorrect` only if the
 * numeric score is missing. Throws when the response is unusable, so the
 * screen can offer a retry instead of showing a wrong score.
 */
export function parseSubmitResult(response: unknown, questions: QuizQuestion[]): QuizResult {
  const r = (response as any)?.data && typeof (response as any).data === "object" && !Array.isArray((response as any).data)
    ? (response as any).data
    : response;
  const rawResults = r?.results && typeof r.results === "object" ? r.results : null;
  if (!rawResults) throw new Error("Quiz result is missing.");

  const results: Record<string, QuizQuestionResult> = {};
  for (const q of questions) {
    const item = rawResults[q.id];
    results[q.id] = {
      isCorrect: item?.isCorrect === true,
      correctOptionIndex: toInt(item?.correctOptionIndex),
    };
  }
  const counted = Object.values(results).filter((x) => x.isCorrect).length;
  const score = toInt(r?.score) ?? counted;
  const total = toInt(r?.total_questions) ?? questions.length;
  if (score < 0 || total <= 0 || score > total) throw new Error("Quiz result is inconsistent.");
  return { score, total, results };
}
