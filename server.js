const express = require("express");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

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

  const systemText = "אתה עוזר חכם. ענה בעברית, קצר מאוד (עד 2 משפטים). ללא סימנים מיוחדים.";
  conversations[phone].push({ role: "user", parts: [{ text: userText }] });

  // עדכון המודל לפי מה שמופיע אצלך ב-AI Studio
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents: conversations[phone].slice(-4), 
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("Gemini Error:", data.error.message);
      return `שגיאת מערכת: ${data.error.message}`;
    }

    let reply = data.candidates[0].content.parts[0].text;
    conversations[phone].push({ role: "model", parts: [{ text: reply }] });

    return reply.replace(/[^\u0590-\u05FFa-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  } catch (error) {
    return "תקלה זמנית בשרת";
  }
}

app.all("/ivr", async (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || "unknown";
  const host = req.headers.host;
  const userText = params.user_query || "";
  const topic = params.topic || "general";

  if (userText && userText.length > 1) {
    const answer = await askGemini(phone, userText, topic);
    return yemotSend(res, `id_list_message=t-${answer}&read=t-לשאלה נוספת 1 לתפריט 9=ApiDTMF,1,1,1,Number,no,yes,no&call_api=https://${host}/ivr&`);
  }

  const key = params.ApiDTMF || "";
  const topics = { "1": "general", "2": "recipes", "3": "health", "4": "torah" };
  
  if (topics[key]) {
    return yemotSend(res, `read=t-נא הקש שאלתך וסולמית=user_query,,1,1,100,HebrewKeyboard,yes,no,,&call_api=https://${host}/ivr?topic=${topics[key]}&`);
  }

  if (key === "9" || !key) conversations[phone] = [];
  return yemotSend(res, `id_list_message=t-שלום ברוכים הבאים&read=t-לכללית 1 מתכונים 2 בריאות 3 יהדות 4=ApiDTMF,1,1,1,Number,no,yes,no&call_api=https://${host}/ivr&`);
});

app.listen(process.env.PORT || 3000);
