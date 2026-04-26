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

// פונקציה משופרת לשאילת Gemini
async function askGemini(phone, userText, topic) {
  if (!conversations[phone]) conversations[phone] = [];

  const systemPrompts = {
    general: "אתה עוזר אישי חכם. עונה בעברית בלבד, בקצרה עד 3 משפטים. בלי תווים מיוחדים.",
    recipes: "אתה שף מומחה. עונה על מתכונים בקצרה עד 3 משפטים.",
    health: "אתה יועץ בריאות. עונה בקצרה עד 3 משפטים. תמיד המלץ להתייעץ עם רופא.",
    torah: "אתה בקי בתורה ויהדות. עונה בקצרה עד 3 משפטים.",
  };

  const systemText = systemPrompts[topic] || systemPrompts.general;
  
  // הוספת השאלה הנוכחית להיסטוריה
  conversations[phone].push({ role: "user", parts: [{ text: userText }] });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemText }] },
          contents: conversations[phone].slice(-10), // שולח רק 10 הודעות אחרונות
        }),
      }
    );

    const data = await response.json();
    
    // בדיקה אם ה-API החזיר שגיאה
    if (data.error) {
      console.error("Gemini API Error:", JSON.stringify(data.error));
      throw new Error(data.error.message);
    }

    if (!data.candidates || !data.candidates[0].content) {
      console.error("Gemini Unexpected Response:", JSON.stringify(data));
      throw new Error("No content in response");
    }

    const reply = data.candidates[0].content.parts[0].text;
    
    // שמירת התשובה בזיכרון
    conversations[phone].push({ role: "model", parts: [{ text: reply }] });

    return reply.replace(/[*#_~`\-\.=&]/g, " ").replace(/\s+/g, " ").trim();
  } catch (error) {
    console.error("Error in askGemini:", error);
    throw error;
  }
}

app.all("/ivr", async (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || "unknown";
  const host = req.headers.host;
  
  const userText = params.user_query || "";
  const topic = params.topic || "";

  // אם הגיעה שאלה
  if (userText && userText.length > 1) {
    console.log(`[ASK] טלפון: ${phone} | נושא: ${topic} | שאלה: ${userText}`);
    try {
      const answer = await askGemini(phone, userText, topic);
      return yemotSend(res,
        `id_list_message=t-${answer}&` +
        `read=t-לשאלה נוספת הקישו 1 לתפריט ראשי הקישו 9=ApiDTMF,1,1,1,Number,no,yes,no&` +
        `call_api=https://${host}/ivr&`
      );
    } catch (err) {
      // כאן מודפסת השגיאה שגורמת ל"שגיאה בעיבוד"
      console.error(`[CRITICAL ERROR] ${err.message}`);
      return yemotSend(res, `id_list_message=t-סליחה אירעה שגיאה בעיבוד השאלה נסו שנית&call_api=https://${host}/ivr&`);
    }
  }

  const key = params.ApiDTMF || "";
  const topics = { "1": "general", "2": "recipes", "3": "health", "4": "torah" };
  
  if (topics[key]) {
    const topicName = { general: "שאלה כללית", recipes: "מתכונים", health: "בריאות", torah: "יהדות" }[topics[key]];
    return yemotSend(res, 
      `id_list_message=t-בחרת ${topicName}&` +
      `read=t-נא הקש את שאלתך ובסיומה סולמית=user_query,,1,1,100,HebrewKeyboard,yes,no,,&` +
      `call_api=https://${host}/ivr?topic=${topics[key]}&`
    );
  }

  // תפריט ראשי
  if (key === "9" || !key) conversations[phone] = [];
  return yemotSend(res, 
    `id_list_message=t-שלום ברוך הבא לעוזר החכם&` +
    `read=t-לשאלה כללית 1 למתכונים 2 לבריאות 3 ליהדות 4=ApiDTMF,1,1,1,Number,no,yes,no&` +
    `call_api=https://${host}/ivr&`
  );
});

app.listen(process.env.PORT || 3000);
