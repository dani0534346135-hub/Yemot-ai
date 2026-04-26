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

// פונקציה שבודקת איזה מודל הכי טוב זמין לך
async function getAvailableModel() {
  const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
  for (const model of models) {
    try {
      const check = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${GEMINI_API_KEY}`);
      if (check.ok) return model;
    } catch (e) {}
  }
  return "gemini-1.5-flash"; // ברירת מחדל
}

async function askGemini(phone, userText, topic) {
  if (!conversations[phone]) conversations[phone] = [];

  const systemPrompts = {
    general: "עוזר אישי. עברית בלבד. קצר (עד 3 משפטים). בלי סימנים מיוחדים.",
    recipes: "שף מומחה. מתכונים קצרים בעברית.",
    health: "יועץ בריאות. עברית. קצר. המלץ על רופא.",
    torah: "בקי בתורה. עברית. קצר.",
  };

  const systemText = systemPrompts[topic] || systemPrompts.general;
  conversations[phone].push({ role: "user", parts: [{ text: userText }] });

  const modelName = await getAvailableModel();
  console.log(`[MODEL CHECK] Using: ${modelName}`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents: conversations[phone].slice(-10),
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("Gemini Error:", data.error.message);
      throw new Error(data.error.message);
    }

    let reply = data.candidates[0].content.parts[0].text;
    conversations[phone].push({ role: "model", parts: [{ text: reply }] });

    return reply.replace(/[^\u0590-\u05FFa-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  } catch (error) {
    console.error("AskGemini Fail:", error.message);
    throw error;
  }
}

app.all("/ivr", async (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || "unknown";
  const host = req.headers.host;
  const userText = params.user_query || "";
  const topic = params.topic || "";

  if (userText && userText.length > 1) {
    try {
      const answer = await askGemini(phone, userText, topic);
      return yemotSend(res, `id_list_message=t-${answer}&read=t-לשאלה נוספת 1 לתפריט 9=ApiDTMF,1,1,1,Number,no,yes,no&call_api=https://${host}/ivr&`);
    } catch (err) {
      return yemotSend(res, `id_list_message=t-סליחה יש תקלה זמנית נסה שוב&call_api=https://${host}/ivr&`);
    }
  }

  const key = params.ApiDTMF || "";
  const topics = { "1": "general", "2": "recipes", "3": "health", "4": "torah" };
  
  if (topics[key]) {
    return yemotSend(res, `read=t-הקש שאלתך וסולמית=user_query,,1,1,100,HebrewKeyboard,yes,no,,&call_api=https://${host}/ivr?topic=${topics[key]}&`);
  }

  if (key === "9" || !key) conversations[phone] = [];
  return yemotSend(res, `read=t-כללית 1 מתכונים 2 בריאות 3 תורה 4=ApiDTMF,1,1,1,Number,no,yes,no&call_api=https://${host}/ivr&`);
});

app.listen(process.env.PORT || 3000);
