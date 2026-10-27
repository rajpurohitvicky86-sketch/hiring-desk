// Hiring Desk server: saves candidates, marks the quiz and typing, checks the HR PIN.
import { getStore } from "@netlify/blobs";
import { timingSafeEqual, createHash, randomUUID } from "node:crypto";

// Correct answer index for each question in QUIZ (public/index.html), in the same order.
const QUIZ_KEY = [1, 2, 0, 3, 1, 2, 0, 1, 3, 2];

// The passage candidates must type (must match TYPING_TEXT in public/index.html).
const TYPING_TEXT =
  "Please check the order list before you send it to the customer. Every item should have the right price, the right size and the right quantity. If something is missing, call the store and ask the manager to confirm the stock.";

const TEST_MINUTES = 15;

const json = (data, status = 200) => Response.json(data, { status });

const candidatesStore = () => getStore({ name: "candidates", consistency: "strong" });
const settingsStore = () => getStore({ name: "settings", consistency: "strong" });

function pinOk(req) {
  const expected = process.env.HR_PIN || "";
  const given = req.headers.get("x-hr-pin") || "";
  if (!expected) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

function markQuiz(answers) {
  const list = Array.isArray(answers) ? answers : [];
  let correct = 0;
  QUIZ_KEY.forEach((key, i) => {
    if (Number(list[i]) === key) correct++;
  });
  return { correct, total: QUIZ_KEY.length };
}

function markTyping(typed, seconds) {
  const text = String(typed || "");
  const secs = Math.max(1, Number(seconds) || 1);
  const target = TYPING_TEXT.split(/\s+/);
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  let correctWords = 0;
  words.forEach((w, i) => {
    if (w === target[i]) correctWords++;
  });
  const accuracy = words.length ? Math.round((correctWords / words.length) * 100) : 0;
  const wpm = Math.round((text.length / 5) / (secs / 60));
  const netWpm = Math.round(wpm * (accuracy / 100));
  const completion = Math.min(100, Math.round((words.length / target.length) * 100));
  return { wpm, accuracy, netWpm, completion, seconds: Math.round(secs) };
}

const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  try {
    // ---------- Candidate side ----------
    if (parts[0] === "settings" && method === "GET") {
      const s = (await settingsStore().get("main", { type: "json" })) || {};
      return json({ excelEmail: s.excelEmail || "", testMinutes: TEST_MINUTES });
    }

    if (parts[0] === "submit" && method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return json({ error: "Invalid request." }, 400);
      const name = clean(body.name, 100);
      const phone = clean(body.phone, 40);
      if (!name || !phone) return json({ error: "Name and phone are required." }, 400);

      const quiz = markQuiz(body.answers);
      const typing = markTyping(body.typed, body.typingSeconds);
      const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
      const record = {
        id,
        name,
        phone,
        email: clean(body.email, 120),
        position: clean(body.position, 100),
        answers: Array.isArray(body.answers) ? body.answers.slice(0, QUIZ_KEY.length) : [],
        quiz,
        typed: clean(body.typed, 3000),
        typing,
        excelSent: Boolean(body.excelSent),
        timeUsedSeconds: Math.max(0, Math.round(Number(body.timeUsedSeconds) || 0)),
        timedOut: Boolean(body.timedOut),
        submittedAt: new Date().toISOString(),
        hr: { excelScore: null, notes: "", decision: "" },
      };
      await candidatesStore().setJSON(id, record);
      return json({ ok: true, id });
    }

    // ---------- HR side ----------
    if (parts[0] === "hr") {
      if (!process.env.HR_PIN) {
        return json({ error: "HR PIN is not set up yet. Add HR_PIN in Netlify environment variables and redeploy." }, 503);
      }
      if (!pinOk(req)) return json({ error: "Wrong PIN." }, 401);

      const store = candidatesStore();

      if (parts[1] === "login" && method === "POST") return json({ ok: true });

      if (parts[1] === "settings" && method === "PUT") {
        const body = await req.json().catch(() => ({}));
        const current = (await settingsStore().get("main", { type: "json" })) || {};
        const next = { ...current, excelEmail: clean(body.excelEmail, 120) };
        await settingsStore().setJSON("main", next);
        return json({ ok: true, ...next });
      }

      if (parts[1] === "candidates" && !parts[2] && method === "GET") {
        const { blobs } = await store.list();
        const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
        const list = items.filter(Boolean).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
        return json({ candidates: list, quizKey: QUIZ_KEY });
      }

      if (parts[1] === "candidates" && parts[2]) {
        const id = parts[2];
        const existing = await store.get(id, { type: "json" });
        if (!existing) return json({ error: "Candidate not found." }, 404);

        if (method === "PATCH") {
          const body = await req.json().catch(() => ({}));
          let excelScore = body.excelScore;
          excelScore = excelScore === "" || excelScore == null ? null : Math.max(0, Math.min(10, Number(excelScore) || 0));
          existing.hr = {
            excelScore,
            notes: clean(body.notes, 2000),
            decision: ["", "hire", "maybe", "reject"].includes(body.decision) ? body.decision : "",
            scoredAt: new Date().toISOString(),
          };
          await store.setJSON(id, existing);
          return json({ ok: true, candidate: existing });
        }

        if (method === "DELETE") {
          await store.delete(id);
          return json({ ok: true });
        }
      }
    }

    return json({ error: "Not found." }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Server error. Please try again." }, 500);
  }
};

export const config = { path: "/api/*" };
