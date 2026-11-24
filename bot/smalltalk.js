// Greetings, thanks, "who are you", "what can you do": answered in code (instant, free, works even if Kompass is down).
// Only matches when the WHOLE message is small talk, so "hi, close the poll" still goes to the agent.
const { nowInOffice } = require("./dates");

const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "";
const clean = (t) => String(t || "").toLowerCase().replace(/<at>[^<]*<\/at>/g, " ").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
const BOTNAME = "(?:\\s+(?:there|bot|snack overflow|snackoverflow|team|all|everyone|buddy|friend))?";

const RULES = [
  { id: "greet", re: new RegExp(`^(?:hi+|hello+|hey+|heya|hiya|yo|hola|namaste|sup|howdy|good (?:morning|afternoon|evening|day)|gm|ge)${BOTNAME}$`) },
  { id: "howare", re: new RegExp(`^(?:how are you|how r u|how are you doing|hows it going|how's it going|whats up|what's up|wassup)${BOTNAME}$`) },
  { id: "thanks", re: new RegExp(`^(?:thanks|thank you|thank u|thx|ty|tysm|thanks a lot|thanks so much|cool|great|awesome|nice|perfect|super|good job|well done|ok thanks|okay thanks|got it|ok|okay|k)${BOTNAME}$`) },
  { id: "bye", re: new RegExp(`^(?:bye|goodbye|good night|gn|see you|see ya|cya|later|take care)${BOTNAME}$`) },
  { id: "who", re: /^(?:who are you|what are you|who is this|what is this|what's your name|whats your name|your name|introduce yourself|are you a bot|are you real|are you ai)$/ },
  { id: "can", re: /^(?:what can you do|what do you do|what can i ask|what can i ask you|what all can you do|how can you help|how can you help me|how do you work|how to use you|how to use this|capabilities|features|what are your features|options|menu of commands|show me what you can do|help me|i need help|can you help me|can you help|any help)$/ },
];

function daypart() {
  const h = Number(nowInOffice().time.slice(0, 2));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Returns the reply text, or null if this isn't small talk. isHr decides which examples are shown.
function reply(text, name, isHr, examplesFor) {
  const raw = String(text || "").replace(/<at>[^<]*<\/at>/g, "").trim();
  if (raw && raw.length <= 20 && /^[\p{Extended_Pictographic}\u200d\ufe0f\s]+$/u.test(raw)) return "😊"; // emoji-only message
  const t = clean(text);
  if (!t || t.length > 60) return null;
  const rule = RULES.find((r) => r.re.test(t));
  if (!rule) return null;
  const who = firstName(name);
  const tryThese = () => `Try one of these:\n${examplesFor(isHr, 4).map((e) => `- ${e}`).join("\n")}\n\nSay *what can you do?* for the full list.`;
  switch (rule.id) {
    case "greet": return `${/^good (morning|afternoon|evening)/.test(t) ? t.replace(/^good (\w+).*/, (_, p) => `Good ${p}`) : /^(gm|ge)$/.test(t) ? daypart() : pick(["Hi", "Hello", "Hey"])}${who ? ` ${who}` : ""}! 👋 I'm Snack Overflow, your office assistant.\n\n${tryThese()}`;
    case "howare": return `Doing great, thanks for asking! 😄 Ready to help${who ? `, ${who}` : ""}.\n\n${tryThese()}`;
    case "thanks": return pick(["You're welcome! 😊", "Happy to help! 🙌", "Anytime! 😄", "Glad that worked! 👍"]);
    case "bye": return pick(["Bye! 👋 I'll be here when you need me.", "See you later! 👋", "Take care! 😊"]);
    case "who": return `I'm **Snack Overflow**, the office assistant for this team. I run the meal polls and menu, custom polls, Secret Santa, reminders and alerts${isHr ? ", and HR can set all of that up just by telling me in plain English" : ""}. Say *what can you do?* to see examples.`;
    case "can": return `Here's what you can ask me${who ? `, ${who}` : ""}:\n\n${examplesFor(isHr).map((e) => `- ${e}`).join("\n")}\n\nJust type it the way you'd say it. I'll ask if I need more details.${isHr ? "" : " (Some things, like creating polls and alerts, are HR-only.)"}`;
  }
  return null;
}

module.exports = { reply };
