// Hiring Desk API — runs as a Netlify Function and stores data in Netlify Blobs.
// Candidate routes need the candidate's own token; HR routes need the HR_PIN
// environment variable (set it in Netlify: Site configuration > Environment variables).
import { getStore } from "@netlify/blobs";

/* ---------- Answer keys (kept on the server so candidates cannot see them) ---------- */
// 30 questions, 1 mark each. a=0 b=1 c=2 d=3. Must match the QUIZ list in public/index.html.
const QUIZ_KEY = [0, 3, 1, 2, 2, 0, 3, 1, 3, 1, 2, 0, 3, 1, 0, 2, 3, 1, 2, 0, 3, 1, 2, 1, 0, 2, 3, 2, 1, 2];
const READ_KEY = [
  "A screen guard for Redmi Note 13",
  "Since yesterday (Thursday)",
  "Their phone screen is cracked",
];
const PASSAGE =
  "Dear customer, thank you for shopping with us. Your order for a tempered glass screen guard and a back cover has been packed and handed over to the courier today. You will receive a tracking number on WhatsApp within a few hours. Delivery usually takes three to five working days, but orders to small towns may take one or two days more. Please keep your phone switched on so the delivery partner can reach you. If you are not at home, you can ask a family member to collect the parcel. If the parcel looks damaged, take a photo before opening it and send it to us on WhatsApp. We will arrange a free replacement as soon as possible. For cash on delivery orders, please keep the exact amount ready. If you have any question about fitting the screen guard, watch the video link in the box or call our support team between 10 am and 7 pm. Have a great day.";
const PASSAGE_WORDS = PASSAGE.split(/\s+/);
const TYPING_MINUTES = 2;
const RUBRIC = { greet: 2, next: 3, english: 2, short: 2 };
const TASK_COUNT = 8;
const TASK_VALUES = [5, 3, 0];
const READ_VALUES = [2, 1, 0];
const POSTS = ["Listing", "Shipping", "Customer care", "Other office post"];

/* ---------- Scoring ---------- */
export function scoreQuiz(answers) {
  return QUIZ_KEY.reduce((n, a, i) => n + (answers[i] === a ? 1 : 0), 0);
}
export function scoreTyping(typed) {
  const t = PASSAGE_WORDS, n = t.length;
  const words = typed.trim() ? typed.trim().split(/\s+/) : [];
  let partial = null;
  if (words.length && !/\s$/.test(typed)) partial = words.pop();
  let i = 0, j = 0, correct = 0, wrong = 0;
  while (i < words.length) {
    const exp = t[j % n];
    if (words[i] === exp) { correct++; i++; j++; }
    else if (words[i] === t[(j + 1) % n]) { wrong++; correct++; i++; j += 2; }
    else if (i + 1 < words.length && words[i + 1] === exp) { wrong++; i++; }
    else { wrong++; i++; j++; }
  }
  if (partial !== null && partial === t[j % n]) correct++;
  const wpm = Math.round(correct / TYPING_MINUTES);
  let marks = wpm >= 35 ? 15 : wpm >= 30 ? 12 : wpm >= 25 ? 9 : wpm >= 20 ? 6 : wpm >= 15 ? 3 : 0;
  if (wrong > 5) marks = Math.max(0, marks - 3);
  return { correct, mistakes: wrong, wpm, marks };
}
export function totals(c) {
  const hr = c.hr || {};
  const p2arr = hr.p2 || [], rd = hr.read || [], rp = hr.reply || {};
  const p1 = c.part1 ? c.part1.score : 0;
  const p2 = p2arr.reduce((s, v) => s + (v || 0), 0);
  const p3 = c.part3 ? c.part3.marks : 0;
  const p4 = rd.reduce((s, v) => s + (v || 0), 0) + Object.keys(RUBRIC).reduce((s, k) => s + (rp[k] || 0), 0);
  const p2done = p2arr.length === TASK_COUNT && p2arr.every((v) => v !== null);
  const p4done = rd.length === 3 && rd.every((v) => v !== null) && Object.keys(RUBRIC).every((k) => rp[k] !== null && rp[k] !== undefined);
  const complete = !!(c.part1 && c.part3 && c.part4) && p2done && p4done;
  return { p1, p2, p3, p4, total: p1 + p2 + p3 + p4, complete };
}

/* ---------- Helpers ---------- */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (msg, status = 400) => json({ error: msg }, status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const str = (v, max) => String(v ?? "").slice(0, max).trim();
function rid(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
function makeCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = new Uint8Array(4);
  crypto.getRandomValues(r);
  return "HD-" + Array.from(r, (b) => a[b % a.length]).join("");
}
function publicView(c) {
  const { token, ...rest } = c;
  return rest;
}
function pick(v, allowed) {
  return allowed.includes(v) ? v : null;
}
async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}
function envPin() {
  try { if (globalThis.Netlify && Netlify.env) return Netlify.env.get("HR_PIN"); } catch {}
  return process.env.HR_PIN;
}

/* ---------- Handler ---------- */
export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;
  const store = getStore({ name: "hiring-desk", consistency: "strong" });
  const now = Date.now();

  try {
    /* Public: settings a candidate needs */
    if (parts[0] === "config" && method === "GET") {
      const s = (await store.get("settings", { type: "json" })) || {};
      return json({ taskEmail: s.taskEmail || "" });
    }

    /* Candidate: start the test */
    if (parts[0] === "candidates" && parts.length === 1 && method === "POST") {
      const b = await readBody(req);
      const name = str(b.name, 80), phone = str(b.phone, 20), email = str(b.email, 120), post = str(b.post, 40);
      if (!name || phone.replace(/\D/g, "").length < 10 || !POSTS.includes(post)) return fail("Please fill your name, a 10-digit phone number and the post.");
      const id = rid(8), token = rid(16);
      const c = { id, token, code: makeCode(), name, phone, email, post, status: "in_progress", createdAt: now };
      await store.setJSON("c/" + id, c);
      return json({ id, token, code: c.code });
    }

    /* Candidate: check own status / save a part */
    if (parts[0] === "candidates" && parts.length === 2 && (method === "GET" || method === "PATCH")) {
      const key = "c/" + parts[1];
      const c = await store.get(key, { type: "json" });
      if (!c) return fail("Test not found.", 404);
      if (req.headers.get("x-token") !== c.token) return fail("Not allowed.", 403);
      if (method === "GET") return json({ status: c.status, name: c.name, code: c.code });
      if (c.status !== "in_progress") return fail("This test is already submitted.", 409);
      const b = await readBody(req);
      if (b.part === "p1") {
        const answers = Array.from({ length: QUIZ_KEY.length }, (_, i) => pick((b.answers || [])[i], [0, 1, 2, 3]));
        c.part1 = { answers, score: scoreQuiz(answers), at: now, timedOut: !!b.timedOut };
      } else if (b.part === "p2") {
        const from = (c.part1 && c.part1.at) || c.createdAt;
        c.part2 = { at: now, minutes: Math.round(((now - from) / 60000) * 10) / 10, timedOut: !!b.timedOut };
      } else if (b.part === "p3") {
        const typed = str(b.typed, 4000);
        c.part3 = { typed, ...scoreTyping(typed), at: now };
      } else if (b.part === "p4") {
        c.part4 = { read: [0, 1, 2].map((i) => str((b.read || [])[i], 300)), reply: str(b.reply, 2000), at: now, timedOut: !!b.timedOut };
        c.status = "submitted";
        c.submittedAt = now;
      } else return fail("Unknown part.");
      await store.setJSON(key, c);
      return json({ ok: true });
    }

    /* HR area: everything below needs the PIN */
    if (parts[0] === "hr") {
      const pin = envPin();
      if (!pin) return fail("HR_PIN is not set. Add it in Netlify: Site configuration > Environment variables, then redeploy.", 503);
      if (req.headers.get("x-pin") !== pin) { await sleep(800); return fail("Wrong PIN.", 401); }

      if (parts[1] === "check") return json({ ok: true });

      if (parts[1] === "candidates" && parts.length === 2 && method === "GET") {
        const { blobs } = await store.list({ prefix: "c/" });
        const items = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
        items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return json({ candidates: items.map(publicView), key: { quiz: QUIZ_KEY, read: READ_KEY } });
      }

      if (parts[1] === "candidates" && parts.length === 3) {
        const key = "c/" + parts[2];
        const c = await store.get(key, { type: "json" });
        if (!c) return fail("Candidate not found.", 404);
        if (method === "DELETE") { await store.delete(key); return json({ ok: true }); }
        if (method === "PUT") {
          const b = await readBody(req);
          const h = b.hr || {};
          c.hr = {
            p2: Array.from({ length: TASK_COUNT }, (_, i) => pick((h.p2 || [])[i], TASK_VALUES)),
            read: [0, 1, 2].map((i) => pick((h.read || [])[i], READ_VALUES)),
            reply: Object.fromEntries(Object.entries(RUBRIC).map(([k, max]) => {
              const v = (h.reply || {})[k];
              return [k, Number.isInteger(v) && v >= 0 && v <= max ? v : null];
            })),
            decision: str(h.decision, 60),
            notes: str(h.notes, 3000),
          };
          const t = totals(c);
          c.total = t.total;
          c.scoreComplete = t.complete;
          c.scoredAt = now;
          if (t.complete && c.status === "submitted") c.status = "scored";
          await store.setJSON(key, c);
          return json({ candidate: publicView(c) });
        }
      }

      if (parts[1] === "settings" && method === "PUT") {
        const b = await readBody(req);
        const s = { taskEmail: str(b.taskEmail, 120) };
        await store.setJSON("settings", s);
        return json(s);
      }
    }

    return fail("Not found.", 404);
  } catch (e) {
    return fail("Server error: " + (e && e.message ? e.message : "unknown"), 500);
  }
};

export const config = { path: "/api/*" };
