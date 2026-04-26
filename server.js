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
    general: "אתה עוזר אישי חכם. עונה בעברית בלבד, בקצרה עד 3 משפטים. בלי תווים מיוחדים.",
    recipes: "אתה שף מומחה. עונה על מתכונים בקצרה עד 3 משפטים.",
    health: "אתה יועץ בריאות. עונה בקצרה עד 3 משפטים. תמיד המלץ להתייעץ עם רופא.",
    torah: "אתה בקי בתורה ויהדות. עונה בקצרה עד 3 משפטים.",
  };

  const systemText = systemPrompts[topic] || systemPrompts.general;
  conversations[phone].push({ role: "user", parts: [{ text: userText }] });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents: conversations[phone].slice(-10),
      }),
    }
  );

  const data = await response.json();
  const reply = data.candidates[0].content.parts[0].text;
  conversations[phone].push({ role: "model", parts: [{ text: reply }] });

  return reply.replace(/[*#_~`\-\.=&]/g, " ").replace(/\s+/g, " ").trim();
}

// תפריט ניתוב ראשי
app.all("/ivr", (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || "unknown";
  const key = params.ApiDTMF || "";
  const host = req.headers.host;

  console.log(`[IVR LOG] טלפון: ${phone} | מקש: ${key}`);

  if (key === "1") return yemotSend(res, buildTopicMenu("general", host));
  if (key === "2") return yemotSend(res, buildTopicMenu("recipes", host));
  if (key === "3") return yemotSend(res, buildTopicMenu("health", host));
  if (key === "4") return yemotSend(res, buildTopicMenu("torah", host));
  
  conversations[phone] = [];
  return yemotSend(res, buildMainMenu(host));
});

// קבלת שאלה והחזרת תשובה
app.all("/ask", async (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || "unknown";
  const topic = params.topic || "general";
  const host = req.headers.host;
  
  // תופס את השאלה מכל פרמטר אפשרי שימות המשיח שולחים
  const userText = params.user_query || params.ApiDTMF || "";

  console.log(`[ASK LOG] נושא: ${topic} | טקסט: ${userText}`);

  if (!userText || userText === "1" || userText === "9") {
      return yemotSend(res, buildTopicMenu(topic, host));
  }

  try {
    const answer = await askGemini(phone, userText, topic);
    return yemotSend(res,
      `id_list_message=t-${answer}&` +
      `read=t-לשאלה נוספת הקישו 1 לתפריט ראשי הקישו 9=ApiDTMF,1,1,1,Number,no,yes,no&` +
      `call_api=https://${host}/ivr&`
    );
  } catch (err) {
    return yemotSend(res, `id_list_message=t-שגיאה בחיבור לבינה המלאכותית&call_api=https://${host}/ivr&`);
  }
});

function buildMainMenu(host) {
  return (
    `id_list_message=t-שלום ברוך הבא לעוזר החכם&` +
    `read=t-לשאלה כללית 1 למתכונים 2 לבריאות 3 ליהדות 4=ApiDTMF,1,1,1,Number,no,yes,no&` +
    `call_api=https://${host}/ivr&`
  );
}

function buildTopicMenu(topic, host) {
  return (
    `id_list_message=t-נא הקש את שאלתך ובסיומה סולמית&` +
    `read=user_query,,1,1,50,HebrewKeyboard,yes,no,,&` +
    `call_api=https://${host}/ask?topic=${topic}&`
  );
}

app.listen(process.env.PORT || 3000);
