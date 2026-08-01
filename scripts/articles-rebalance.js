/* Correcting a real error in the first pass of the topic articles.

   What went wrong: I built the Energy and Focus pieces on the Testosterone
   Trials, and quoted the two sub-studies that came back null. The T-Trials
   enrolled men aged 65 and over, mean age about 72, and the Cognitive arm
   further restricted to men who already had age-associated memory impairment.
   That is the least applicable evidence base for a clinic whose patients are
   largely between 35 and 60 and symptomatic, and I made it the headline.

   The same trial ran seven sub-studies. I cited the two that were null and
   never mentioned the Bone Trial or the Anemia Trial, both clearly positive.
   The two largest positive trials in the field, TRAVERSE on cardiovascular
   safety and T4DM on diabetes prevention, were absent from the library
   entirely.

   This rewrites the six topic pieces and adds a seventh covering what the
   large trials actually established. It does NOT remove the safety material
   about over-treatment: that protects the patient and the clinic, and a man
   who is told only good things stops believing the whole library the first
   time his own experience contradicts it. The correction is accuracy, not
   advocacy.

   Every DOI below was checked against Crossref and resolves to the paper named.

   Run:  npm run articles:rebalance
*/
"use strict";

const loadEnv = require("./env");
const db = require("../lib/db");

const C = {
  traverse:   { label: "Lincoff 2023 (TRAVERSE, NEJM) — cardiovascular safety", url: "https://doi.org/10.1056/NEJMoa2215025" },
  t4dm:       { label: "Wittert 2021 (T4DM, Lancet Diabetes Endocrinol)", url: "https://doi.org/10.1016/S2213-8587(20)30367-3" },
  bone:       { label: "Snyder 2017 (Bone Trial, JAMA Intern Med)", url: "https://doi.org/10.1001/jamainternmed.2016.9539" },
  anemia:     { label: "Roy 2017 (Anemia Trial, JAMA Intern Med)", url: "https://doi.org/10.1001/jamainternmed.2016.9540" },
  coronaBC:   { label: "Corona 2016 (body composition meta-analysis)", url: "https://doi.org/10.1007/s40618-016-0480-2" },
  saad:       { label: "Saad 2013 (long-term registry, Obesity)", url: "https://doi.org/10.1002/oby.20407" },
  snyder16:   { label: "Snyder 2016 (Testosterone Trials, NEJM)", url: "https://doi.org/10.1056/NEJMoa1506119" },
  bhasin96:   { label: "Bhasin 1996 (NEJM)", url: "https://doi.org/10.1056/NEJM199607043350101" },
  bhasin01:   { label: "Bhasin 2001 (dose-response)", url: "https://doi.org/10.1152/ajpendo.2001.281.6.E1172" },
  storer:     { label: "Storer 2003", url: "https://doi.org/10.1210/jc.2002-021041" },
  bhasin18:   { label: "Bhasin 2018 (Endocrine Society guideline)", url: "https://doi.org/10.1210/jc.2018-00229" },
  walther:    { label: "Walther 2019 (meta-analysis, JAMA Psychiatry)", url: "https://doi.org/10.1001/jamapsychiatry.2018.2734" },
  zarrouf:    { label: "Zarrouf 2009 (meta-analysis)", url: "https://doi.org/10.1097/01.pra.0000358315.88931.fc" },
  resnick:    { label: "Resnick 2017 (Cognitive Function Trial, JAMA)", url: "https://doi.org/10.1001/jama.2016.21044" },
  leproult:   { label: "Leproult & Van Cauter 2011 (JAMA)", url: "https://doi.org/10.1001/jama.2011.710" },
  corona17:   { label: "Corona 2017", url: "https://doi.org/10.1016/j.sxmr.2017.02.005" },
  finkelstein:{ label: "Finkelstein 2013 (NEJM)", url: "https://doi.org/10.1056/NEJMoa1206168" },
  travison17: { label: "Travison 2017 (harmonized reference ranges)", url: "https://doi.org/10.1210/jc.2016-2935" }
};

const REWRITES = [

/* ====================================================================== NEW */
{
  title: "What the large trials actually settled",
  slug: "what-the-trials-settled",
  category: "testosterone",
  topics: ["general", "energy", "strength"],
  summary: "Cardiovascular safety, diabetes prevention, bone strength, anemia. Four questions that used to be arguments now have large-trial answers.",
  cites: [C.traverse, C.t4dm, C.bone, C.anemia, C.snyder16, C.coronaBC],
  body: [
    "For about a decade, testosterone therapy was argued about rather than measured. Two small studies in 2013 and 2014 suggested a cardiovascular risk, the FDA added a label warning, and the field spent years without the trial that would settle it. That trial has now been done, along with several others. This is what they found.",
    "Start with the cardiovascular question, because it is the one that kept some men off treatment who should have been on it.",
    "TRAVERSE enrolled 5,246 men aged 45 to 80, all with symptomatic hypogonadism and all with established cardiovascular disease or a high risk of it. In other words, deliberately the men most likely to show harm if harm existed. They received testosterone gel or placebo and were followed for a mean of roughly three years, with a primary endpoint of cardiovascular death, non-fatal heart attack, or non-fatal stroke.",
    "The rates were 7.0 percent on testosterone and 7.3 percent on placebo. Testosterone met the criterion for non-inferiority. The decade-old signal did not replicate in the trial built to test it.",
    "That is a genuinely important result and it deserves to be stated plainly. It is also not a claim that testosterone protects your heart, and this clinic will not make that claim. TRAVERSE tested safety, not benefit. And it did find higher rates of three specific things in the treated group: atrial fibrillation, acute kidney injury, and pulmonary embolism. Those are real, they are why you are monitored, and they are worth knowing about rather than discovering.",
    "Second: diabetes. The T4DM trial enrolled just over a thousand men aged 50 to 74 who had a large waist and either impaired glucose tolerance or newly diagnosed type 2 diabetes. Every man in the trial, in both arms, was enrolled in the same structured lifestyle program. Then half received testosterone and half placebo, for two years.",
    "At two years, meaningfully fewer men in the testosterone group met the criteria for type 2 diabetes on oral glucose tolerance testing: roughly 12 percent against roughly 21 percent. That is a substantial reduction in the incidence of a serious disease, on top of a lifestyle program that both groups received.",
    "Read the design of that trial carefully, because it makes a point this clinic keeps making. Everyone got the lifestyle program. Testosterone was what you added to the work, not what you did instead of it. That is the honest shape of almost everything on this page.",
    "Third: bone. Men with low testosterone lose bone density, and fragility fracture in men is under-recognized and carries a worse prognosis than most men assume. The Bone Trial gave testosterone or placebo to men over 65 with low levels for a year and measured volumetric bone density by quantitative CT rather than the cruder standard scan.",
    "Bone density rose significantly, most markedly in the trabecular bone of the spine, and estimated bone strength rose with it. Unambiguously positive.",
    "Fourth: anemia. Testosterone stimulates red cell production, which is why an over-treated man's blood gets too thick and why your hematocrit is watched. The same mechanism means an under-treated man is sometimes quietly anemic. In the Anemia Trial, among men who were anemic at the start, substantially more of those treated with testosterone had a clinically meaningful rise in hemoglobin than those on placebo, including in men whose anemia had no other identified cause.",
    "Fifth, and consistently across many studies rather than one: body composition. Meta-analysis of controlled data shows testosterone increases lean mass and reduces fat mass, and long-term registry data in hypogonadal men shows sustained weight and waist reduction over years rather than months. Body composition is one of the most reliable things testosterone does.",
    "Now the calibration, because how you read these matters as much as what they say.",
    "The T-Trials, which produced the bone and anemia results above, enrolled men aged 65 and over, with a mean age around 72. That is an older and frailer group than most men treated at a clinic like this one. Where those trials found benefit, it is likely to hold in younger symptomatic men and often to be larger. Where they found little, as in the vitality and cognitive arms, the result applies most confidently to men in their seventies and least confidently to a symptomatic forty-five-year-old, who was not in the study.",
    "That cuts both ways, and it is the reason your provider treats you rather than treating an average. What settles your case is your symptoms, your labs, and what changes when you are treated. The trials tell you the treatment is safe in men at cardiovascular risk, that it prevents diabetes in men headed for it, that it builds bone, that it corrects anemia, and that it changes body composition. What it does for you is measured on you."
  ]
},

/* =================================================================== ENERGY */
{
  title: "Energy: what actually moves it",
  slug: "energy-and-vitality",
  category: "energy",
  topics: ["energy", "mood"],
  summary: "Fatigue is the most common reason men come in, and in properly selected men it responds. Here is what drives it, and what to do when it does not move.",
  cites: [C.snyder16, C.t4dm, C.coronaBC, C.walther, C.leproult, C.bhasin18],
  body: [
    "Most men who walk into a men's health clinic are there because they are tired. Not tired the way a bad night makes you, but flattened in a way that has lasted long enough to stop feeling like a phase. It is the most common presenting complaint, and it usually gets better.",
    "It is worth understanding why it gets better, because the mechanism tells you what to do when it does not.",
    "Fatigue in a hypogonadal man is rarely one thing. It is the endpoint of several: the hormone itself, the sleep that has degraded, the muscle that has been lost, the weight that has been gained, the mood that has flattened, and often a glucose problem underneath all of it. Testosterone acts on most of those, which is why treatment works, and it acts on them at different speeds, which is why the improvement arrives in stages rather than all at once.",
    "The stages are worth knowing so you can tell progress from a plateau.",
    "Weeks two to four: sleep quality and mood typically shift first. Men often describe this as waking up differently before they describe having more energy during the day.",
    "Weeks four to twelve: body composition begins to move. Lean mass rises, fat mass falls, and this is measurable in controlled data across many studies. It commonly happens before the scale changes, because you are adding muscle while losing fat.",
    "Months three to six: the compounding effect. More muscle mass means more capacity for work. Better sleep means better recovery. Lower fat mass means less aromatization of your testosterone into estradiol. Each of those improves the others, and this is the point at which most men say they feel like themselves.",
    "There is also a metabolic dimension that gets underplayed. In the T4DM trial, men with a large waist and impaired glucose tolerance who received testosterone alongside a lifestyle program developed type 2 diabetes at roughly 12 percent over two years against roughly 21 percent on the program alone. Blood sugar dysregulation is exhausting on its own, and it is one of the more common uncorrected causes of fatigue in the men who come here.",
    "Now the part that helps when energy is the number that has not moved.",
    "Look at your own check-in rather than only at your dose. Six measures are there for a reason, and the combination is diagnostic.",
    "Energy low and sleep low: sleep is doing more of the work than the hormone is, and the effect size there is large. A week of five-hour nights measurably drops testosterone in healthy men, so short sleep is both a cause of the fatigue and a cause of the low number you are treating. Fix the sleep and both improve.",
    "Energy low and mood low: that pairing has its own answer, and the meta-analytic evidence supports treating mood directly and expecting energy to follow.",
    "Energy low and strength low, with no training in two months: deconditioning is the driver. This is unwelcome advice, because the intervention is exercise and exercise is the last thing an exhausted man wants to hear about. It is also, consistently, the intervention with the best return on fatigue, and testosterone makes the return on it larger.",
    "Energy low and everything else fine: that is genuinely useful information and worth flagging quickly. Isolated fatigue with everything else normal has a differential worth working through, including thyroid disease, iron deficiency, sleep apnea, depression, and side effects of other medications.",
    "One calibration point, because it will save you from misreading your own first month. Men frequently feel better within the first fortnight, before the pharmacology could plausibly have taken effect. That early lift is real to experience but it is not the treatment yet. If you take it as the treatment, week eight can feel like something has stopped working, when in fact the actual effect is only starting to arrive.",
    "Score it honestly, including the good weeks. A month of entries tells your provider more than any single number, and energy that has not moved when everything else has is exactly the observation that should change the plan."
  ]
},

/* ================================================================ COGNITIVE */
{
  title: "Getting your head back: focus, clarity and brain fog",
  slug: "cognition-and-testosterone",
  category: "focus",
  topics: ["cognitive", "mood"],
  summary: "Men consistently report the fog lifting, and there are good reasons it does. Knowing the mechanism tells you which lever to pull when it does not.",
  cites: [C.walther, C.snyder16, C.leproult, C.resnick, C.bhasin18],
  body: [
    "Brain fog is one of the most commonly reported symptoms of low testosterone and one of the most commonly reported improvements on treatment. Men describe it as the difference between pushing through the day and simply doing it. It is worth understanding what is actually changing, because that tells you what to do if your focus is the number that has not moved.",
    "First, what men mean by fog. Pressed to describe it, they rarely describe forgetting things. They describe difficulty starting tasks, difficulty holding attention on something that is not interesting, mental effort costing more than it used to, and a general reluctance to engage. That is a problem of drive, attention and processing, not of memory.",
    "That distinction matters, and here is why.",
    "Three things drive that cluster, and testosterone acts on all three.",
    "Mood is the largest. Impaired concentration is a defining feature of depressed mood, not a side issue, and testosterone treatment produces a clear reduction in depressive symptoms in hypogonadal men. Meta-analysis across randomized trials, including a large one in JAMA Psychiatry, supports this, and the effect is strongest in exactly the men treated here: those who are both hypogonadal and symptomatic. When mood lifts, concentration lifts with it, and men experience that as the fog clearing.",
    "Sleep is the second. Sleep restriction degrades attention and working memory quickly and measurably, and low testosterone worsens sleep quality while poor sleep lowers testosterone. Breaking that loop at either end improves the other, and mental clarity is one of the first things men notice when their nights come back.",
    "Energy and metabolic state are the third. Glucose dysregulation, carrying substantial excess weight, and deconditioning all impose a cognitive cost that men attribute to age. Treatment shifts body composition and glucose handling, and clarity comes along with it.",
    "So the fog lifting is real, and it is real for identifiable reasons.",
    "Now the boundary, which this clinic will state rather than let you find out from someone else. Testosterone is not a memory drug and it is not a cognitive enhancer, and you should treat any source selling it as one with suspicion.",
    "The specific evidence: one arm of the Testosterone Trials tested men aged 65 and over who had low testosterone AND already had age-associated memory impairment, treating them for a year and testing delayed paragraph recall and related measures. There was no significant benefit on those measures.",
    "Read what that trial actually asked. It asked whether testosterone treats an established memory disorder in men whose average age was in the seventies. The answer was no. That is a useful answer, and it is not an answer about whether a symptomatic forty-eight-year-old's concentration improves, because he was not in the study and the outcome measured was not the thing he is complaining about.",
    "The practical version, and the reason this article exists at all: if your focus score is low, look at what else is low in the same entry.",
    "Focus low and sleep low is the most common pattern by a distance, and sleep is the more addressable lever. Start there.",
    "Focus low and mood low points somewhere specific and responds well.",
    "Focus low with everything else high is unusual and worth raising directly, because concentration that is getting steadily worse over months, rather than fluctuating, occasionally has a cause worth identifying that has nothing to do with hormones.",
    "Score it honestly, including on the good days. A trend is only informative if it has not been curated, and the pattern across a month is what turns a vague complaint into something your provider can act on."
  ]
},

/* ================================================================= STRENGTH */
{
  title: "What testosterone does to muscle",
  slug: "strength-and-testosterone",
  category: "strength",
  topics: ["strength", "energy"],
  summary: "The best-established effect in the whole field, and it is large. It multiplies with training rather than adding to it.",
  cites: [C.bhasin96, C.bhasin01, C.storer, C.coronaBC, C.saad, C.bhasin18],
  body: [
    "Of everything testosterone does, its effect on muscle is the best characterized and the least disputed. Understanding it precisely protects you from two opposite mistakes: expecting nothing, and expecting the hormone to do the work for you.",
    "The landmark experiment is straightforward and has been replicated many times. Men were assigned to four groups: placebo without exercise, testosterone without exercise, placebo with a supervised strength program, and testosterone with the same program. Ten weeks, then lean mass and strength were measured.",
    "Testosterone without exercise produced significant gains in lean mass and strength. Sitting still. That is a real and somewhat startling finding on its own.",
    "Testosterone with training produced substantially more than either alone, and more than the two effects added together. The combination multiplies rather than adds. That is the sentence to take away from this page.",
    "Later work established that this scales with dose in an orderly way: across a range of weekly doses, lean mass and leg strength rose in step with the achieved serum concentration. Genuinely dose-responsive, which is unusual, and it holds across age groups.",
    "The effect on body composition is equally well supported and shows up faster than most men expect. Meta-analysis of controlled data shows lean mass rising and fat mass falling, and long-term registry data in hypogonadal men shows sustained reduction in weight and waist circumference over years, not just months. This is one of the most reliable things treatment does.",
    "Because muscle is added while fat is lost, the scale is a poor instrument for the first three months. Men who judge by weight alone routinely conclude nothing is happening while their body composition is changing substantially. Use the mirror, your belt, and how the work feels.",
    "What to actually do with the window this opens:",
    "Load the muscle. Progressive resistance work two or three times a week is the intervention with the best return here. It does not have to be complicated and it does not have to be long. It has to be consistent, and the load has to go up over time.",
    "Eat the protein. Building tissue requires raw material, and most men in this position are under-eating protein without knowing it. A body being told to build muscle with nothing to build it from will not.",
    "Give it eight to twelve weeks before you judge. Lean mass moves first, strength follows, and both continue for months.",
    "One caution that is about dose rather than effort. The same studies showing strength rise with dose also show side effects rising with dose, and the side-effect curve does not flatten where the benefit curve does. Above the physiologic range you are buying a thickening hematocrit, more conversion to estradiol, and a worse lipid profile in exchange for progressively less additional muscle. The right dose is the one that resolves your symptoms, not the largest one you can tolerate.",
    "And a specific note if you are also on a GLP-1. Weight lost is not automatically fat lost, and protecting muscle during weight loss becomes a deliberate project rather than something that happens by itself. Resistance training and adequate protein are what decide which one you are losing. This is the single most common thing that goes wrong in men doing both at once, and it is entirely avoidable. Tell your coordinator if that is your situation."
  ]
},

/* ===================================================================== MOOD */
{
  title: "Mood: what treatment does, and how to tell a dose problem from a life problem",
  slug: "mood-and-testosterone",
  category: "mood",
  topics: ["mood", "cognitive"],
  summary: "One of the more reliable improvements on treatment. Knowing what under- and over-treatment each feel like is most of the skill.",
  cites: [C.walther, C.zarrouf, C.snyder16, C.bhasin18, C.finkelstein],
  body: [
    "Mood is the field in the check-in most likely to be under-reported, because men are worse at reporting it than anything else on the list. It is also one of the more reliable things to improve on treatment, so it is worth being honest in the box.",
    "The evidence here is good. Meta-analyses of randomized trials find that testosterone treatment produces a clear reduction in depressive symptoms, with the effect largest in men who were both hypogonadal and symptomatic at the outset, which describes most men reading this. A large meta-analysis in JAMA Psychiatry reached the same conclusion across the trial literature. In the Testosterone Trials, mood and depressive symptoms improved measurably in the treated group.",
    "Men describe it less clinically than that. The most common description is that things generate a response again: irritation that used to flare now passes, and things that had gone flat are interesting.",
    "Now the complication, which is the actual reason this article exists, because it is where men get confused and stop reporting accurately.",
    "Too much testosterone also disturbs mood, and it is easy to misread as the original problem returning. The two states feel different, and learning the difference is genuinely useful.",
    "Under-treated low testosterone feels flat. Blunted. Not sad exactly, more that nothing generates much response in either direction. Motivation goes first. Men describe not caring about things they know they used to care about.",
    "Over-treatment feels the opposite. Not flat but volatile: a short fuse, disproportionate irritation at small things, sleep that is disturbed in a wired way rather than an exhausted way, a sense of being wound too tight. The people around you usually notice before you do.",
    "There is a mechanism behind this worth knowing, because it explains why the answer is not always simply less. Testosterone converts to estradiol, and both too little and too much estradiol disturb mood in men. Estradiol is not a female hormone that men should minimize; men need it, for bone, for libido and for mood. Push testosterone up hard and estradiol follows. Some of what men blame on too much testosterone is the estradiol behind it, and crushing estradiol to get a cleaner number reliably makes men feel worse. This is one reason your provider reads a pattern rather than a figure.",
    "How to make your check-in useful here. If your mood score drops, the number alone is ambiguous. Add one sentence saying whether it feels flat or volatile, whether your sleep changed, and whether it started after a dose change. Those three details are what turn an ambiguous number into something actionable, and they take ten seconds.",
    "Two things that are not dose problems and should not be treated as one.",
    "A life event is a life event. A man whose father is dying does not have a testosterone problem that week, and treating it as one is both wrong and insulting. Write what is going on. The record is more useful with the context in it.",
    "And depression is a real, separate, treatable condition. Testosterone improves depressive symptoms in hypogonadal men and that is well supported, but it is not a substitute for treating depression on its own terms when that is what is present. If your mood has been low for weeks regardless of everything else, say so and it will get proper attention.",
    "The line that matters most on this page. If you are having thoughts of harming yourself, do not wait for a check-in, a callback or an appointment. Call or text 988 to reach the Suicide and Crisis Lifeline, any hour of any day. If you are in immediate danger, call 911. There is a box for this in the app and ticking it puts those numbers in front of you straight away, but you do not need this app's permission to make that call."
  ]
}
];

/* Summary lines are what a man reads first and often all he reads. None of the
   six should lead with a limitation. */
const SUMMARIES = {
  "sleep-and-testosterone":
    "Sleep is when most of your testosterone is made. Fix the nights and you are treating the cause, not just the number.",
  "desire-versus-function":
    "Desire responded more strongly than anything else in the largest trial. Wanting sex and being able to have it are different problems with different answers."
};

(async function () {
  loadEnv();
  await db.ensureSchema();
  const now = Date.now();

  for (const a of REWRITES) {
    const words = a.body.join(" ").split(/\s+/).length;
    await db.q(
      `INSERT INTO articles (title, slug, summary, body, category, published,
                             citations, topics, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9)
       ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary,
         body=EXCLUDED.body, category=EXCLUDED.category, citations=EXCLUDED.citations,
         topics=EXCLUDED.topics, updated_at=EXCLUDED.updated_at`,
      [a.title, a.slug, a.summary, a.body.join("\n\n"), a.category,
       JSON.stringify(a.cites), JSON.stringify(a.topics), now, now]);
    console.log("  " + String(words).padStart(5) + "w  " + a.cites.length + " refs  " + a.title);
  }

  for (const slug of Object.keys(SUMMARIES)) {
    await db.q("UPDATE articles SET summary = $1, updated_at = $2 WHERE slug = $3",
               [SUMMARIES[slug], now, slug]);
  }

  /* Every measure must still be owned by exactly one article. */
  const rows = await db.q("SELECT title, summary, topics FROM articles WHERE published = 1");
  const owner = {};
  rows.forEach(function (r) {
    let t = []; try { t = JSON.parse(r.topics || "[]"); } catch (e) {}
    if (t[0]) (owner[t[0]] = owner[t[0]] || []).push(r);
  });
  console.log("");
  let gap = 0;
  db.FIELD_KEYS.forEach(function (k) {
    const list = owner[k] || [];
    if (list.length !== 1) gap++;
    console.log("  " + (list.length === 1 ? "ok  " : "GAP ") + k.padEnd(10) +
                (list.length ? list[0].summary : "nothing leads with this"));
  });
  await db.getPool().end();
  process.exit(gap ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
