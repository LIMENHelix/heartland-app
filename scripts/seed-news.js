/* Starter pieces for the free app's "From Heartland" beat.

   ALL OF THESE GO IN AS DRAFTS (live = 0) AND STAY THERE.

   They are a starting point for someone at the clinic to edit, not content to
   publish. Nobody clinical has read them, they were written by an assistant,
   and they go to men who are not patients and have no record here. Putting one
   live is a decision a person makes in the console, one piece at a time.

   Written to the rule the app runs on: information, never advice for him
   specifically, and never a diagnosis. "Men who are tired every day for weeks
   often turn out to have a reason worth finding" is fair. "You have low
   testosterone" is not, and neither is anything that implies it.

   Idempotent: matches on title, so running it twice does not duplicate.

   node scripts/seed-news.js                                                  */
"use strict";
require("./env")();
const db = require("../lib/db");

const PIECES = [
  {
    topic: "testosterone",
    title: "Tired is not the same as lazy",
    teaser: "Three things worth ruling out before you blame your willpower.",
    cta: "Have someone call me",
    body:
`Most men who come to a clinic like this one start the same way. Not with a
symptom they can name, but with a general sense that the dial has moved. Less
drive, worse sleep, harder to put muscle on and easier to put weight on, and a
feeling that the version of them from five years ago would have handled the
week better.

That is worth taking seriously, and it is also worth being careful about,
because every one of those things has more than one cause.

Sleep comes first. Under six hours a night, consistently, will flatten your
energy, your mood and your training on its own. Fix that before you conclude
anything else.

Then weight. Body fat and hormones move together in both directions, which is
why weight loss on its own changes how a lot of men feel.

Then everything else: thyroid, iron, depression, alcohol, medication you are
already on. A blood test sorts most of it out in one visit.

What we would say is this: if you have felt flat most days for months rather
than weeks, that is worth a proper look rather than another year of guessing.
It might be testosterone. It might not be. The point is that it is findable.`
  },
  {
    topic: "nutrition",
    title: "Protein is the one that moves everything",
    teaser: "If you change one thing this month, make it breakfast.",
    cta: "",
    body:
`If you are training and not changing shape, protein is the usual reason.

The rough target most men do well on is somewhere around 0.7 to 1 gram per
pound of goal bodyweight per day. For most men reading this that is 140 to 200
grams, and almost nobody hits it by accident.

The practical version, because grams are hard to think in:

Breakfast is where most men lose it. A coffee and a pastry is nothing. Three
eggs and a bit of meat is 30 grams before you have left the house.

Put a real protein at every meal and stop counting. Chicken, beef, fish, eggs,
Greek yoghurt, cottage cheese. If the plate has one, you are close.

A shake is a convenience, not a strategy. Useful when you are short. It does
not fix a day that had no protein in it.

The reason this matters more than any other single change: protein is what
keeps muscle on you while you lose fat. Losing weight without it means losing
some of the wrong thing, and the wrong thing is what was keeping your
metabolism up.`
  },
  {
    topic: "movement",
    title: "The bar is lower than you think",
    teaser: "Ten minutes on your feet beats a perfect plan you do not follow.",
    cta: "",
    body:
`The men who get results are not the ones with the best programme. They are the
ones who kept turning up on the days they did not want to.

Three lifting sessions a week is enough for almost anyone reading this. Not
five. Three, done for a year, beats five done for a month.

The bigger lever most men ignore is the rest of the day. Someone who lifts
three times a week and sits for the other 160 hours is not an active person.
Ten minutes on your feet after each meal does more for your blood sugar and
your waistline than an extra gym session would.

Walking counts. It has always counted. It counts on the days you are too tired
to train, which are the days it matters most, because doing something small is
what keeps the habit alive until you feel like doing something big.

If you are starting from nothing: walk for ten minutes after dinner, every
day, for two weeks. That is the whole assignment.`
  },
  {
    topic: "water",
    title: "Half the men who feel tired are just dry",
    teaser: "The cheapest thing you can fix, and most men are behind by noon.",
    cta: "",
    body:
`This one is boring, which is exactly why it goes unfixed.

Mild dehydration does a good impression of a bad day. Low energy, a dull
headache, poor concentration, worse workouts, and a hunger signal that is
actually thirst. Most men who feel flat at three in the afternoon have had two
coffees and no water since waking up.

There is no magic number, and the eight-glasses rule was never based on much.
A more useful test: your urine should be pale straw, not apple juice. If it is
darker than that most of the day, drink more.

The habit that works better than a target: a glass when you wake up, a glass
with every meal, and a bottle within reach wherever you spend the day. That
gets most men where they need to be without thinking about it.

If you train hard or work outside, you need noticeably more than that, and you
need some salt with it.`
  },
  {
    topic: "supplements",
    title: "Creatine, and not much else",
    teaser: "The cheapest thing in the cupboard that actually does something.",
    cta: "",
    body:
`The supplement aisle is mostly expensive urine. Creatine monohydrate is the
exception, and it is the one almost nobody takes.

It is among the most studied supplements there is. It helps with strength and
with the amount of work you can do in a session, and the evidence on it has
held up for thirty years.

Five grams a day. Any time. It does not need to be timed around training and
you do not need to load it. The unbranded monohydrate is the same molecule as
the expensive version.

Two things men get wrong about it. It is not a steroid and it is not a
hormone. And the weight you put on in the first fortnight is water inside the
muscle, not fat.

If you are going to buy one thing, buy that. Then put the rest of the money
into food.`
  },
  {
    topic: "general",
    title: "What actually happens at a first visit",
    teaser: "No commitment, and you find out where you stand.",
    cta: "Book me in",
    body:
`Most men put this off for a year because they do not know what they are
walking into. So, plainly:

You come in and talk to someone about what has actually been going on. How you
sleep, how you feel, what has changed, what you have already tried.

You have blood drawn. It takes a few minutes. That is what turns a vague
feeling into numbers somebody can act on.

You come back for the results and someone goes through them with you. If there
is something worth treating, you are told what the options are, what they
cost, and what they involve. If there is not, you are told that too, which is
a perfectly good outcome and happens often.

There is no obligation at any point, and nothing starts on the first visit.

The reason to come in is not that we know something is wrong. It is that
guessing for another year is the expensive option.`
  }
];

(async function () {
  await db.ensureSchema();
  const now = Date.now();
  let added = 0, already = 0;
  for (const p of PIECES) {
    const seen = await db.one("SELECT id FROM news WHERE title = $1", [p.title]);
    if (seen) { already++; continue; }
    await db.q(`INSERT INTO news (topic, title, teaser, body, cta, live, created_at, updated_at)
                VALUES ($1,$2,$3,$4,$5,0,$6,$6)`,
      [p.topic, p.title, p.teaser, p.body.trim(), p.cta, now]);
    added++;
  }
  const live = await db.one("SELECT COUNT(*)::int AS n FROM news WHERE live = 1");
  console.log("\n  " + added + " drafts added, " + already + " already there");
  console.log("  " + live.n + " live. Nothing sends until somebody puts a piece live in the console.\n");
  process.exit(0);
})().catch(function (e) { console.error(e.message); process.exit(1); });
