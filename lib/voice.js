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

/* ---------------------------------------------------------------- free app */

const FREE = {
  breakfast: [
    { title: "PROTEIN", body: "First meal of the day. Make it count." },
    { title: "Eat something real", body: "Not a coffee and a prayer. Protein." },
    { title: "Breakfast", body: "30 grams of protein now beats a scramble at 3pm." },
    { title: "Morning", body: "Eggs. Meat. Something that was recently alive." }
  ],
  lunch: [
    { title: "Lunch", body: "Eat properly now or you raid the cupboard at four. Your call." },
    { title: "Halfway", body: "Protein and something green. It is not complicated." },
    { title: "PROTEIN", body: "Round two. Do not skip it and call it discipline." },
    { title: "Lunch", body: "A sandwich is not a meal. Put some meat in it." }
  ],
  dinner: [
    { title: "Dinner", body: "Protein, something green, and stop when you are full." },
    { title: "Last meal", body: "Eat it early enough that you can actually sleep." },
    { title: "Dinner", body: "You have done well today. Do not undo it at 9pm." },
    { title: "PROTEIN", body: "Third time. This is the whole trick." }
  ],
  train: [
    { title: "Get after it", body: "Forty minutes. You have got forty minutes." },
    { title: "TRAIN", body: "Nobody has ever regretted going. Plenty regret not." },
    { title: "Gym", body: "You do not have to want to. You just have to go." },
    { title: "Move", body: "Lift something heavy. Walking counts if that is today." },
    { title: "Training", body: "The hard part is the car park. After that it is easy." }
  ],
  winddown: [
    { title: "Wind it down", body: "Screens off soon. Sleep is when your body does the repair work." },
    { title: "Enough", body: "Put the phone down. Yes, this one." },
    { title: "Wind down", body: "Bad sleep costs you more than a missed session ever will." },
    { title: "Shut it down", body: "Tomorrow starts tonight. Go to bed." }
  ],
  wake: [
    { title: "Up", body: "Same time every day. That is the whole trick with sleep." },
    { title: "Morning", body: "Get up. The snooze button has never helped anyone." },
    { title: "Rise", body: "Consistent wake time does more than a perfect bedtime." }
  ],
  water: [
    { title: "WATER", body: "Drink some. Most men read tired when they are just dry." },
    { title: "Water", body: "A glass now. It is the easiest win of your day." },
    { title: "Hydrate", body: "If you have not had water since coffee, that is the problem." },
    { title: "WATER", body: "Go on. Takes ten seconds." }
  ],
  steps: [
    { title: "Get up", body: "Ten minutes on your feet. That is the whole ask." },
    { title: "MOVE", body: "You have been sitting for hours. Fix that." },
    { title: "Walk", body: "Round the block. It counts, and you know it counts." },
    { title: "Up you get", body: "Sitting all day undoes half the work in the gym." }
  ],
  creatine: [
    { title: "Creatine", body: "Five grams. Did you take it?" },
    { title: "CREATINE", body: "Cheapest thing in your cupboard that actually works." },
    { title: "Creatine", body: "Takes ten seconds and you will forget by lunch. Now." },
    { title: "Creatine", body: "Boring, unglamorous, and it works. Take it." },
    { title: "Five grams", body: "Creatine. Does not matter when, only that you do." }
  ]
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
  return pick(FREE[slot], dayKey, salt) || { title: "Heartland", body: "" };
}
function patientMessage(slot, dayKey, salt) {
  return pick(PATIENT[slot], dayKey, salt) || null;
}

module.exports = { FREE, PATIENT, OFFERS, freeMessage, patientMessage, pick };
