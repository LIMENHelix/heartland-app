/* ==========================================================================
   What the notifications actually say.

   A lock screen gets about two seconds and one glance. These are written for
   that: short, direct, a bit of humour, no clinical hedging and no exclamation
   marks stacked on top of each other. It is a men's clinic, not a wellness
   brand.

   Each slot holds several variants and the day of the year picks one, so the
   same man does not read the same sentence every morning for a month. Nothing
   here is personal or clinical, which is what lets it be blunt: it is the same
   line for everybody and it can never leak anything about anyone.

   RULE FOR ANYTHING ADDED HERE: it goes on a lock screen, which is not a
   private place. Never name a medication, a dose, a result, or a condition.
   Not even in general terms: "sleep is where testosterone gets made" is a true
   and harmless sentence that still tells the man next to him which clinic is
   sending it. scripts/test/voice.js enforces this.
   ========================================================================== */
"use strict";

/* Rotates by day so it is stable within a day and different tomorrow. */
function pick(list, dayKey, salt) {
  if (!list || !list.length) return null;
  const s = String(dayKey || "") + "|" + String(salt || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/* ------------------------------------------------------------- free app

   FOUR BEATS, NOT NINE REMINDERS.

   The first version had a notification per behaviour: breakfast, lunch,
   dinner, water, steps, creatine, training, wind-down, wake. Every line below
   survives from it, but they are now the CONTENT of four messages rather than
   nine separate interruptions. A man who is told nine things has been told
   nothing, and the ninth notification is not read, it is what makes him
   uninstall the app.

   So the day has a shape instead of a checklist:

     PLAN     one thing, said in the morning while it can still be acted on
     MIDDAY   a check and a course correction, which is where the old
              water/steps/protein lines went
     NEWS     comes from the database, written by the clinic, chosen by his own
              scores. Only the fallback lives here.
     RATE     the ask that makes the other three worth sending

   Each beat holds several variants and the day plus the device picks one. */

const FREE = {
  plan: [
    { title: "PROTEIN", body: "First meal of the day. Get that right and the rest follows." },
    { title: "Today", body: "Three meals with protein in them. That is the whole plan." },
    { title: "Morning", body: "Eggs, meat, something that was recently alive. Then get on with it." },
    { title: "One thing", body: "Eat properly today. Not perfectly. Properly." },
    { title: "Up", body: "Same time every day is the whole trick with sleep. Now go and eat." },
    { title: "TRAIN TODAY", body: "Decide now, while it is still easy to say yes." },
    { title: "Today", body: "Forty minutes and a decent breakfast. You have got that." },
    { title: "Morning", body: "Nobody has ever regretted going. Plenty regret not." }
  ],
  midday: [
    { title: "WATER", body: "Have you had any? Most men read tired when they are just dry." },
    { title: "Halfway", body: "Protein and something green. It is not complicated." },
    { title: "Check", body: "Eat properly now or you raid the cupboard at four. Your call." },
    { title: "MOVE", body: "You have been sitting for hours. Ten minutes on your feet." },
    { title: "Halfway", body: "A sandwich is not a meal. Put some meat in it." },
    { title: "Still time", body: "Whatever this morning was, the afternoon is a fresh one." },
    { title: "Creatine", body: "Five grams. Did you take it, or did you mean to?" },
    { title: "Water", body: "A glass now. Easiest win available to you today." }
  ],
  /* Only used when the clinic has written nothing that fits. */
  news: [
    { title: "From Rejuv", body: "Something worth two minutes of your day." }
  ],
  rate: [
    { title: "Score the day", body: "Thirty seconds. Food, water, movement, creatine, energy." },
    { title: "How was it?", body: "Five taps. It is what makes tomorrow's nudge worth reading." },
    { title: "Rate today", body: "Be honest. Nobody sees it and it is not a test." },
    { title: "End of day", body: "Five numbers. Then put the phone down and go to sleep." },
    { title: "Before bed", body: "Score it, then wind down. Screens off." },
    { title: "Today", body: "Rate it while you still remember it." }
  ]
};

/* What a low score in each area actually means, shown to him under his own
   numbers. Not advice, and deliberately not alarming: the app is allowed to
   say that being tired every day is worth looking into, and is not allowed to
   suggest a reason for it. */
const RATE_FEEDBACK = {
  nutrition: "Protein at every meal is the one that moves everything else.",
  water:     "Start with a glass when you wake up. Most men are behind by noon.",
  movement:  "Ten minutes on your feet counts. Doing nothing is the only failure.",
  supplements: "Creatine is the cheapest thing in the cupboard that actually works.",
  testosterone: "Low energy most days, for weeks, is worth getting looked at properly."
};

/* ------------------------------------------------------------- patients only

   These CAN be about treatment, so they are written to be meaningless to
   anyone reading the lock screen over his shoulder. "Shot day" says nothing
   about what, how much, or why. */

const PATIENT = {
  shot_tomorrow: [
    { title: "Shot day tomorrow", body: "Get it out of the fridge tonight so it is not cold." },
    { title: "Tomorrow", body: "Shot day. Have everything where you can find it." },
    { title: "Heads up", body: "Shot day tomorrow. You know the drill." }
  ],
  shot_today: [
    { title: "SHOT DAY", body: "Did you take it?" },
    { title: "Shot day", body: "Do it before the day runs away from you." },
    { title: "Today", body: "Shot day. Same time, same spot rotation." },
    { title: "Shot day", body: "Two minutes. Then it is done for the week." }
  ],
  shot_missed: [
    { title: "Still owed", body: "Yesterday was shot day and it is not marked done. Everything alright?" },
    { title: "Shot day passed", body: "Missed one is fine. Two starts to show. Text your coordinator." }
  ],
  labs_due: [
    { title: "Labs are due", body: "Walk in any weekday, 8:30 to 4:30. No appointment." },
    { title: "Time for labs", body: "No appointment needed. Just turn up." },
    { title: "Labs", body: "Due now. Ten minutes, walk in, done." }
  ],
  labs_overdue: [
    { title: "Labs are overdue", body: "Your dose is guesswork until these are done. Walk in this week." },
    { title: "Still no labs", body: "Nothing gets adjusted without them. Any weekday, 8:30 to 4:30." }
  ],
  supply_low: [
    { title: "Running low", body: "About a week left. Sort the refill before you run out." },
    { title: "Refill", body: "You are near the end. Do not coast into a gap." },
    { title: "Low", body: "A week or so left. Text your coordinator and get ahead of it." }
  ],
  supply_out: [
    { title: "You are out", body: "Gaps undo months of work. Text your coordinator today." },
    { title: "Out of supply", body: "This is the one that costs you progress. Sort it now." }
  ],
  renewal_soon: [
    { title: "Renewal coming up", body: "Keep it continuous. Stopping and restarting is the slow way round." },
    { title: "Time to renew", body: "Consistency is the whole game. Do not put a hole in it." },
    { title: "Renewal", body: "Coming up. Text your coordinator and keep it rolling." }
  ],
  renewal_now: [
    { title: "Renew now", body: "Your plan ends this week. A gap sets you back further than you think." },
    { title: "Plan ends this week", body: "Renew and keep the momentum you have paid for." }
  ],
  checkin: [
    { title: "How was today?", body: "Two minutes. Your coordinator reads it." },
    { title: "Check in", body: "Six numbers and a sentence. That is it." },
    { title: "Today", body: "Log it while you remember it." }
  ]
};

/* ----------------------------------------------------------------- offers

   Marketing. Kept apart from everything above so it is obvious what is a nudge
   and what is a sell, and so the two can be rate-limited differently. */

const OFFERS = {
  glp1: {
    title: "You qualify for GLP-1",
    body: "Based on what is on your chart you are eligible for weight-loss medication. Want to hear about it?",
    cta: "Tell me more"
  },
  couples: {
    title: "Couples plans",
    body: "We now do weight loss for two. Same programme, better odds, because doing it alone is the hard way.",
    cta: "Send me the details"
  }
};

function freeMessage(slot, dayKey, salt) {
  return pick(FREE[slot], dayKey, salt) || FREE.plan[0];
}
function patientMessage(slot, dayKey, salt) {
  return pick(PATIENT[slot], dayKey, salt) || null;
}

module.exports = { FREE, PATIENT, OFFERS, RATE_FEEDBACK, freeMessage, patientMessage, pick };
