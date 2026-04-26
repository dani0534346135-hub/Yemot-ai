const express = require("express");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const conversations = {};

// הגדרת מהירות הקראה: 0 היא המהירות הרגילה, מספרים שליליים (כמו -1 או -2) זה לאט יותר
const SPEECH_SPEED = "-1"; 

function yemotSend(res, text) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  // הוספת הפרמטר tts_speed להאטת הקצב
  res.send(`tts_speed=${SPEECH_SPEED}&${text}`);
}

async function askGemini(phone, userText, topic) {
  if (!conversations[phone]) conversations[phone] = [];

  // הוראות ל-AI לכתוב בצורה קריאה עם הרבה סימני פיסוק להפסקות
  const systemText = "אתה עוזר חכם. ענה בעברית ברורה. השתמש בהרבה פסיקים ונקודות כדי שההקראה תהיה איטית וקריאה. ענה בקצרה (עד 2 משפטים).";
  
  conversations[phone].push({ role: "user", parts: [{ text: userText }] });

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
    if (data.error) return "שגיאה בחיבור";

    let reply = data.candidates[0].content.parts[0].text;
    conversations[phone].push({ role: "model", parts: [{ text: reply }] });

    // ניקוי תווים מוזרים שמשבשים את ההקראה
    return reply.replace(/[^\u0590-\u05FFa-zA-Z0-9\s,.]/g, " ").replace(/\s+/g, " ").trim();
  } catch (error) {
    return "תקלה זמנית";
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
    // ביטול אישור (no) כדי שירוץ מהר בתפריטים
    return yemotSend(res, `id_list_message=t-${answer}&read=t-לשאלה נוספת הקישו 1 לתפריט 9=ApiDTMF,1,1,1,Number,no,no,no&call_api=https://${host}/ivr&`);
  }

  const key = params.ApiDTMF || "";
  const topics = { "1": "general", "2": "recipes", "3": "health", "4": "torah" };
  
  if (topics[key]) {
    // כאן השארתי yes באישור ההקלדה כי זה טקסט חופשי וחשוב לוודא שלא טעית
    return yemotSend(res, `read=t-נא הקש שאלתך ובסיומה סולמית=user_query,,1,1,100,HebrewKeyboard,yes,no,,&call_api=https://${host}/ivr?topic=${topics[key]}&`);
  }

  if (key === "9" || !key) conversations[phone] = [];
  return yemotSend(res, `id_list_message=t-שלום&read=t-לכללית 1 מתכונים 2 בריאות 3 יהדות 4=ApiDTMF,1,1,1,Number,no,no,no&call_api=https://${host}/ivr&`);
});

app.listen(process.env.PORT || 3000);
