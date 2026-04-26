const express = require("express");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const conversations = {};

function yemotSend(res, text) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(text);
}

async function askGemini(phone, userText, topic) {
  if (!conversations[phone]) conversations[phone] = [];

  const systemPrompts = {
    general: "אתה עוזר אישי חכם. עונה בעברית בלבד, בקצרה ובבהירות, עד 3 משפטים. אל תשתמש בסימנים מיוחדים.",
    recipes: "אתה שף מומחה. עונה בעברית בלבד על שאלות בישול ומתכונים, בקצרה עד 3 משפטים.",
    health: "אתה יועץ בריאות. עונה בעברית בלבד על שאלות בריאות, בקצרה עד 3 משפטים. תמיד המלץ להתייעץ עם רופא.",
    torah: "אתה בקי בתורה ויהדות. עונה בעברית בלבד על שאלות יהדות והלכה, בקצרה עד 3 משפטים.",
  };

  const systemText = systemPrompts[topic] || systemPrompts.general;

  conversations[phone].push({ role: "user", parts: [{ text: userText }] });

  if (conversations[phone].length > 10) conversations[phone] = conversations[phone].slice(-10);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents: conversations[phone],
      }),
    }
  );

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const reply = data.candidates[0].content.parts[0].text;
  conversations[phone].push({ role: "model", parts: [{ text: reply }] });

  return reply.replace(/[*#_~`\-\.=&]/g, " ").replace(/\s+/g, " ").trim();
}

// ============================
// תפריט ראשי
// ============================
app.all("/ivr", (req, res) => {
  const body = { ...req.query, ...req.body };
  const phone = body.ApiPhone || "unknown";
  const key = body.ApiDTMF || "";
  const host = req.headers.host;

  console.log(`[IVR] טלפון: ${phone} | מקש: ${key}`);

  // אם המשתמש לוחץ 9 או נכנס לראשונה
  if (!key || key === "9") {
    conversations[phone] = [];
    return yemotSend(res, buildMainMenu(host));
  }

  // ניתוב לפי בחירה
  const topics = { "1": "general", "2": "recipes", "3": "health", "4": "torah" };
  if (topics[key]) {
    return yemotSend(res, buildTopicMenu(topics[key], host));
  }

  return yemotSend(res, buildMainMenu(host));
});

// ============================
// קבלת שאלה מהמשתמש
// ============================
app.all("/ask", async (req, res) => {
  const body = { ...req.query, ...req.body };
  const phone = body.ApiPhone || "unknown";
  const userText = body.user_query || ""; // השתמשנו בפרמטר הייעודי שלנו
  const topic = req.query.topic || "general";
  const host = req.headers.host;

  console.log(`[ASK] נושא: ${topic} | טקסט שהוקלד: ${userText}`);

  if (!userText) {
    return yemotSend(res, buildTopicMenu(topic, host));
  }

  try {
    const answer = await askGemini(phone, userText, topic);
    console.log(`[AI Answer]: ${answer}`);

    return yemotSend(res,
      `id_list_message=t-${answer}&` +
      `read=t-לשאלה נוספת הקישו 1 לתפריט ראשי הקישו 9=ApiDTMF,1,1,1,Number,no,yes,no&` +
      `call_api=https://${host}/ivr&`
    );
  } catch (err) {
    console.error("שגיאה:", err.message);
    return yemotSend(res, `id_list_message=t-אירעה שגיאה בשרת&call_api=https://${host}/ivr&`);
  }
});

function buildMainMenu(host) {
  return (
    `id_list_message=t-שלום ברוך הבא לעוזר החכם&` +
    `read=t-לשאלה כללית הקש 1 למתכונים 2 לבריאות 3 ליהדות 4=ApiDTMF,1,1,1,Number,no,yes,no&` +
    `call_api=https://${host}/ivr&`
  );
}

function buildTopicMenu(topic, host) {
  const names = { general: "שאלה כללית", recipes: "מתכונים", health: "בריאות", torah: "יהדות" };
  return (
    `id_list_message=t-בחרת ${names[topic]}&` +
    `read=t-נא הקש את שאלתך ובסיומה הקש סולמית=user_query,,1,1,50,HebrewKeyboard,yes,no,,&` +
    `call_api=https://${host}/ask?topic=${topic}&`
  );
}

app.listen(process.env.PORT || 3000);
