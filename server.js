const express = require("express");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// זיכרון שיחות לפי מספר טלפון
const conversations = {};

// פונקציה לשליחת תשובה בפורמט הנכון לימות המשיח
function yemotSend(res, text) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(text);
}

// פונקציה לשליחת שאלה ל-Gemini
async function askGemini(phone, userText, topic) {
  if (!conversations[phone]) {
    conversations[phone] = [];
  }

  const systemPrompts = {
    general: "אתה עוזר אישי חכם. עונה בעברית בלבד, בקצרה ובבהירות, עד 3 משפטים. אל תשתמש בסימנים כמו נקודה מקף כוכבית סולמית.",
    recipes: "אתה שף מומחה. עונה בעברית בלבד על שאלות בישול ומתכונים, בקצרה עד 3 משפטים. אל תשתמש בסימנים כמו נקודה מקף כוכבית סולמית.",
    health: "אתה יועץ בריאות. עונה בעברית בלבד על שאלות בריאות כלליות, בקצרה עד 3 משפטים. תמיד המלץ להתייעץ עם רופא. אל תשתמש בסימנים כמו נקודה מקף כוכבית סולמית.",
    torah: "אתה בקי בתורה ויהדות. עונה בעברית בלבד על שאלות יהדות והלכה, בקצרה עד 3 משפטים. אל תשתמש בסימנים כמו נקודה מקף כוכבית סולמית.",
  };

  const systemText = systemPrompts[topic] || systemPrompts.general;

  conversations[phone].push({
    role: "user",
    parts: [{ text: userText }],
  });

  if (conversations[phone].length > 10) {
    conversations[phone] = conversations[phone].slice(-10);
  }

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

  conversations[phone].push({
    role: "model",
    parts: [{ text: reply }],
  });

  return reply
    .replace(/[*#_~`\-\.=&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================
// תפריט ניתוב ראשי
// ============================
app.all("/ivr", (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || "unknown";
  const key = params.ApiDTMF || "";
  const host = req.headers.host;

  console.log(`[IVR LOG] כניסה מ: ${phone} | מקש: ${key}`);

  // ניתוב לפי לחיצה
  if (key === "1") return yemotSend(res, buildTopicMenu("general", host));
  if (key === "2") return yemotSend(res, buildTopicMenu("recipes", host));
  if (key === "3") return yemotSend(res, buildTopicMenu("health", host));
  if (key === "4") return yemotSend(res, buildTopicMenu("torah", host));
  
  // אם לא נלחץ מקש תקין או חזרה לתפריט ראשי (9)
  conversations[phone] = [];
  return yemotSend(res, buildMainMenu(host));
});

// ============================
// קבלת שאלה והחזרת תשובה מה-AI
// ============================
app.all("/ask", async (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || "unknown";
  const topic = params.topic || "general";
  const host = req.headers.host;
  
  // קבלת הטקסט מהמשתמש
  const userText = params.user_query || params.ApiDTMF || "";

  console.log(`[ASK LOG] נושא: ${topic} | טקסט שהתקבל: ${userText}`);

  // אם המשתמש לא הקיש כלום או לחץ על מקשי תפריט בטעות
  if (!userText || userText === "1" || userText === "9") {
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
    return yemotSend(res, `id_list_message=t-מצטער אירעה שגיאה בעיבוד השאלה&call_api=https://${host}/ivr&`);
  }
});

// ============================
// פונקציות עזר לבניית תפריטים
// ============================
function buildMainMenu(host) {
  return (
    `id_list_message=t-שלום ברוך הבא לעוזר החכם&` +
    `read=t-לשאלה כללית לחץ 1 למתכונים ובישול לחץ 2 לעצות בריאות לחץ 3 לשאלות תורה ויהדות לחץ 4=ApiDTMF,1,1,1,Number,no,yes,no&` +
    `call_api=https://${host}/ivr&`
  );
}

function buildTopicMenu(topic, host) {
  const names = {
    general: "שאלה כללית",
    recipes: "מתכונים",
    health: "בריאות",
    torah: "תורה ויהדות",
  };

  return (
    `id_list_message=t-בחרת ${names[topic]}&` +
    // חשוב: הטקסט "נא הקש את שאלתך" נמצא בתוך ה-read כדי שהמערכת תמתין לקלט
    `read=t-נא הקש את שאלתך ובסיומה הקש סולמית=user_query,,1,1,60,HebrewKeyboard,yes,no,,&` +
    `call_api=https://${host}/ask?topic=${topic}&`
  );
}

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send("השרת פועל ומחובר לימות המשיח! ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`השרת פועל על פורט ${PORT}`));
