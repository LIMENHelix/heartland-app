/* Six deep articles, one for each thing the check-in asks about.

   The point of the pairing: a man who puts 3 out of 10 next to Sleep gets
   handed the sleep piece, not a general library to go hunting in. So each
   article here carries a `topic` matching a check-in field, and the existing
   library gets tagged to the same vocabulary.

   These are longer and harder than the first set on purpose. They also say
   plainly where testosterone does NOT help, because an article that only
   promises is worth nothing the first time a man's experience contradicts it,
   and he stops believing the rest of it too.

   A provider should read these before patients do. The citations are real and
   linked; the prose is mine.

   Run:  npm run articles:topics
*/
"use strict";

const loadEnv = require("./env");
const db = require("../lib/db");

const C = {
  leproult:   { label: "Leproult & Van Cauter 2011 (JAMA)", url: "https://doi.org/10.1001/jama.2011.710" },
  wittert:    { label: "Wittert 2014", url: "https://doi.org/10.1097/MED.0000000000000069" },
  luboshitzky:{ label: "Luboshitzky 2001", url: "https://doi.org/10.1210/jcem.86.3.7296" },
  hoyos:      { label: "Hoyos 2012 (CPAP and testosterone)", url: "https://doi.org/10.1111/j.1365-2265.2012.04329.x" },
  snyder16:   { label: "Snyder 2016 (Testosterone Trials, NEJM)", url: "https://doi.org/10.1056/NEJMoa1506119" },
  snyder18:   { label: "Snyder 2018 (T-Trials summary)", url: "https://doi.org/10.1210/jc.2017-02490" },
  bhasin96:   { label: "Bhasin 1996 (NEJM)", url: "https://doi.org/10.1056/NEJM199607043350101" },
  bhasin01:   { label: "Bhasin 2001 (dose-response)", url: "https://doi.org/10.1152/ajpendo.2001.281.6.E1172" },
  storer:     { label: "Storer 2003", url: "https://doi.org/10.1210/jc.2002-021041" },
  bhasin18:   { label: "Bhasin 2018 (Endocrine Society guideline)", url: "https://doi.org/10.1210/jc.2018-00229" },
  resnick:    { label: "Resnick 2017 (Cognitive Function Trial, JAMA)", url: "https://doi.org/10.1001/jama.2016.21044" },
  huang:      { label: "Huang 2016 (mood and cognition)", url: "https://doi.org/10.1210/jc.2015-3846" },
  walther:    { label: "Walther 2019 (meta-analysis, JAMA Psychiatry)", url: "https://doi.org/10.1001/jamapsychiatry.2018.2734" },
  zarrouf:    { label: "Zarrouf 2009 (meta-analysis)", url: "https://doi.org/10.1097/01.pra.0000358315.88931.fc" },
  corona:     { label: "Corona 2017", url: "https://doi.org/10.1016/j.sxmr.2017.02.005" },
  travison17: { label: "Travison 2017 (harmonized reference ranges)", url: "https://doi.org/10.1210/jc.2016-2935" },
  finkelstein:{ label: "Finkelstein 2013 (NEJM)", url: "https://doi.org/10.1056/NEJMoa1206168" },
  jastreboff: { label: "Jastreboff 2022 (SURMOUNT-1, NEJM)", url: "https://doi.org/10.1056/NEJMoa2206038" }
};

const ARTICLES = [

/* ------------------------------------------------------------------ SLEEP */
{
  title: "Sleep is where testosterone is made",
  slug: "sleep-and-testosterone",
  category: "sleep",
  topics: ["sleep", "energy"],
  summary: "One week of short nights drops a healthy man's testosterone by 10 to 15 percent. This is the loop most men are fighting without knowing it.",
  cites: [C.leproult, C.luboshitzky, C.wittert, C.hoyos, C.bhasin18],
  body: [
    "If you are scoring your sleep low in the app, read this one first. Not because sleep is nice to have, but because of where testosterone is physically produced in the day.",
    "Testosterone release is not spread evenly across twenty-four hours. It is pulsatile, driven by luteinizing hormone released in bursts, and the largest bursts happen during sleep. Levels climb through the night, peak in the early morning, and drift down across the day. That is why your labs are drawn in the morning: it is the only time the number means something comparable.",
    "The practical consequence is blunt. Cut the night short and you cut into the window where most of the day's production happens.",
    "The size of that effect has been measured directly, and it is larger than most men expect. Healthy young men restricted to five hours a night for one week showed daytime testosterone fall by roughly 10 to 15 percent. One week. In men whose sleep was normal to begin with, with no illness and no medication. Put differently, a week of bad sleep aged their hormonal profile by something on the order of a decade.",
    "Now notice the shape of the problem. Low testosterone worsens sleep quality. Poor sleep lowers testosterone. Each one feeds the other, and a man can spend two years inside that loop thinking he has a testosterone problem when what he has is a testosterone problem and a sleep problem that keep handing the baton back and forth.",
    "This is also why your provider asks about your nights rather than only reading your labs. Two men with the same number are not in the same situation if one of them is sleeping seven hours and the other is sleeping five.",
    "There is a specific version of this worth naming, because it is common in the men who come to a clinic like this one and because it is the one that gets missed. Obstructive sleep apnea is when the airway collapses repeatedly overnight, waking you briefly hundreds of times without you remembering any of it. You are in bed eight hours and getting nothing. The overlap with low testosterone is high, and it rises with body weight and with neck circumference.",
    "The signs are worth knowing because your partner usually notices them before you do: loud snoring, gasping or choking awake, waking with a headache or a dry mouth, and falling asleep during the day in situations where you should not. If any of that sounds familiar, tell your coordinator. It is testable, and it is treatable.",
    "There is a caution attached that runs the other way. Testosterone therapy can worsen existing sleep apnea, particularly at higher doses. That is not an argument against treatment. It is an argument for saying so if you have it, or suspect you have it, so it is managed rather than discovered.",
    "The good news is that this runs in both directions. Treating apnea, where it exists, tends to improve the sleep architecture that testosterone production depends on. Men who get their nights back frequently find that other things which had seemed independent, energy, mood, the willingness to train, come along with it.",
    "What to actually do, in order of how much it tends to matter:",
    "Protect the window. A consistent wake time does more for sleep quality than a consistent bedtime, because it anchors your circadian clock from the front end. Pick one and hold it, including on weekends.",
    "Deal with the alcohol question honestly. A drink helps you fall asleep and wrecks the second half of the night, suppressing the deep stages where the hormonal work happens. Men who cut evening alcohol often report the single biggest change in how they feel on waking.",
    "Watch the timing of your training and your caffeine. Both are good for you and both are disruptive close to bed. Caffeine has a half-life of around five hours, meaning an afternoon coffee is still substantially in your system at bedtime.",
    "And log it. If your sleep score in the app runs low for two weeks, that pattern is worth more to your provider than your best guess at your average, because nobody remembers last Tuesday accurately."
  ]
},

/* ---------------------------------------------------------------- STRENGTH */
{
  title: "What testosterone does to muscle, and what it does not do without you",
  slug: "strength-and-testosterone",
  category: "strength",
  topics: ["strength", "energy"],
  summary: "The dose-response is real and it is large. It is also not the whole story: the trial that proved it had a training arm for a reason.",
  cites: [C.bhasin96, C.bhasin01, C.storer, C.snyder16, C.bhasin18],
  body: [
    "Of everything testosterone does, its effect on muscle is the best characterized and the least disputed. It is worth understanding precisely, because knowing what the evidence actually says protects you from two opposite mistakes: expecting nothing, and expecting everything.",
    "The landmark experiment is straightforward and has been replicated many times. Men were assigned to four groups: placebo without exercise, testosterone without exercise, placebo with a supervised strength program, and testosterone with the same program. Ten weeks. Then everyone's lean mass and strength were measured.",
    "Two results came out of it, and men usually remember only one.",
    "The first: testosterone without exercise produced significant gains in lean mass and strength. Sitting still. That is a real and somewhat startling finding, and it is the one that gets quoted.",
    "The second: testosterone with training produced substantially more than either alone, and considerably more than the two effects added together. The combination is not additive. It multiplies.",
    "Later work established that this scales with dose in an orderly way. Across a range of weekly doses, lean mass and leg strength rose in step with the achieved serum concentration. This is genuinely dose-responsive, which is unusual and worth appreciating.",
    "Now the part that matters more, because dose-responsive is exactly the finding men misuse. The same studies that show strength rising with dose also show the side effects rising with dose, and the side-effect curve does not flatten out where the benefit curve does. Above the physiologic range you are buying a thickening haematocrit, more aromatization to estradiol, and a worse lipid profile in exchange for progressively less additional muscle. The dose that is right for you is the one that resolves your symptoms, not the one that produces the largest number on a bench press.",
    "There is a distinction here that catches a lot of men out. Testosterone changes what your body will do in response to training. It is not a substitute for the training. If you are scoring your strength low in the app and you have not been in a gym in eight weeks, the dose is probably not the variable to change first, and your coordinator will say so.",
    "What the honest version of the evidence looks like in practice:",
    "Lean mass responds first and most reliably. Most men see body composition shift within eight to twelve weeks, often before the scale moves at all, because muscle is being added while fat is being lost. Judging this by weight alone is how men conclude nothing is happening when something is.",
    "Strength follows, and follows faster if you are actually loading the muscle. Progressive resistance work two or three times a week is the intervention with the best return here. It does not have to be complicated. It does have to be consistent, and it has to get harder over time.",
    "Protein matters more than it did. Building tissue requires the raw material. Most men in this position are under-eating protein without realising it, and a body that is being told to build muscle with nothing to build it from will not.",
    "The T-Trials, the largest set of randomized testosterone trials in older men, found a measurable increase in physical function but a modest one. This is the honest calibration: real, worth having, not transformative on its own. The men who transform are the men who use the window it opens.",
    "One warning specific to this. If you are also on a GLP-1 for weight, protecting muscle while losing weight becomes a deliberate project rather than something that happens by itself. Weight lost is not automatically fat lost. Resistance training and adequate protein are what determine which one you are losing, and this is the single most common thing that goes wrong in men doing both at once. Tell your coordinator if that is your situation."
  ]
},

/* --------------------------------------------------------------- COGNITIVE */
{
  title: "Brain fog: what testosterone will and will not fix",
  slug: "cognition-and-testosterone",
  category: "focus",
  topics: ["cognitive", "mood"],
  summary: "Men report their head clearing. The best trial on memory found nothing. Both of those are true, and the gap between them is worth understanding.",
  cites: [C.resnick, C.huang, C.snyder16, C.snyder18, C.leproult],
  body: [
    "This is the article most likely to disagree with what you have read elsewhere, so here is the conclusion up front: the evidence that testosterone improves memory in older men is weak, and the best trial designed to test it found no benefit at all. Men still very commonly report that their head clears. Both statements are accurate, and understanding why takes about five minutes and will make you better at judging your own response.",
    "Start with the negative result, because it is the more rigorous one and because a clinic that only tells you the good findings should not be trusted about the rest.",
    "The Cognitive Function Trial was one arm of the Testosterone Trials, a coordinated set of randomized, placebo-controlled studies in men over 65 with unequivocally low testosterone. This particular arm enrolled men who also had age-associated memory impairment. They received testosterone gel or placebo for a year, with levels titrated into the range of healthy young men, and were tested on delayed paragraph recall, visual memory, executive function and spatial ability.",
    "There was no significant benefit on any of those measures. Not a small one. None.",
    "That is a well-conducted trial answering a specific question, and the answer is that if your concern is memory decline of the kind that gets called age-associated impairment, testosterone is not the treatment for it. Anyone selling it to you on that basis is going beyond the evidence.",
    "So why do men report the fog lifting?",
    "The likeliest explanation is that what men call brain fog is usually not a memory problem. It is a composite: difficulty starting things, difficulty holding attention on something boring, a general sense of mental effort costing more than it used to, and low motivation to engage. Those are real experiences and they are not what a delayed paragraph recall test measures. A man can be sharper in the way he cares about and score identically on the test.",
    "The second explanation is that the fog is frequently downstream of something else in your check-in. Look at what else you scored low. Poor sleep degrades attention and working memory measurably and quickly, which is well established independently of any hormone. Depressed mood impairs concentration as a defining feature. Both of those respond to treatment, and when they lift, so does the fog. That is not testosterone acting on your brain directly. It is testosterone, or better sleep, or a treated mood problem, removing something that was interfering.",
    "This distinction is worth holding onto because it changes what you should do. If your focus score is low and your sleep score is also low, the sleep is the more likely lever, and it is the more addressable one. If your focus is low and your mood is low, say so, because that combination points somewhere specific.",
    "What the broader evidence does support is more modest and more useful than a memory claim. The T-Trials found small but real improvements in mood and depressive symptoms, and those are the measures that track most closely with what men mean by feeling mentally like themselves again.",
    "How to use this article rather than just read it:",
    "Score focus honestly, including on the good days. A trend is only informative if it is not curated.",
    "If focus is your lowest number, look at sleep in the same entry before concluding anything about your dose. They are usually related, and one of them has a clearer fix.",
    "Bring it up. Concentration that is getting worse over months, rather than fluctuating, is worth a conversation and occasionally worth looking at for reasons that have nothing to do with testosterone.",
    "And treat any source that tells you testosterone is a cognitive enhancer with suspicion. The trial was done. That is not what it found."
  ]
},

/* ------------------------------------------------------------------ ENERGY */
{
  title: "Energy: the symptom men come in for, and the one with the smallest effect size",
  slug: "energy-and-vitality",
  category: "energy",
  topics: ["energy", "mood"],
  summary: "Fatigue is the most common reason men present. It is also the measure where testosterone alone performed weakest in the largest trial. That is worth knowing before you start.",
  cites: [C.snyder16, C.snyder18, C.leproult, C.corona, C.travison17],
  body: [
    "Most men who walk into a men's health clinic are there because they are tired. Not tired in the way a bad night makes you, but flattened in a way that has lasted long enough to stop feeling like a phase. It is the most common presenting complaint, and it is the one where you should have the most carefully calibrated expectations.",
    "Here is why. The Testosterone Trials included a Vitality Trial specifically designed to answer this question in men over 65 with low testosterone and self-reported low vitality. Testosterone gel against placebo, a year, validated fatigue instruments.",
    "The result was a small improvement in mood and depressive symptoms, and a benefit on vitality that did not reach the trial's own threshold for a meaningful response. Sexual function improved clearly and substantially in the same men. Vitality did not.",
    "That is a real finding from a good trial and it deserves to be stated plainly rather than buried. If a clinic promises you that testosterone will hand back your energy, it is promising something the best available evidence does not support in the form you are imagining.",
    "So what should you expect, and what actually helps?",
    "The first thing to understand is that fatigue is not one thing. It is the final common pathway of about fifteen different problems, and testosterone addresses a minority of them. That is not a reason to be pessimistic. It is a reason to be specific.",
    "Look at your own check-in. If your energy is low and your sleep is low, sleep is the more likely driver, and the effect size there is much larger than anything testosterone will do. A week of five-hour nights measurably drops testosterone in healthy men, so short sleep is both a cause of fatigue and a cause of the low number you are trying to treat.",
    "If your energy is low and your mood is low, that pairing has its own explanation and its own answer, and the trials support treating mood more strongly than they support treating vitality directly.",
    "If your energy is low and your strength is low and you have not trained in two months, the deconditioning is doing more of the work than the hormone is. This one is genuinely unwelcome as advice, because the intervention is exercise and exercise is the last thing an exhausted man wants to hear about. It is also, consistently, the intervention with the best return on fatigue.",
    "And if your energy is low and everything else is fine, that is genuinely useful information and worth flagging, because isolated fatigue with normal everything else has a differential that includes things worth ruling out: thyroid disease, anaemia, sleep apnea, depression, and the side effects of medications you may not have connected to it.",
    "There is a second reason to be careful with expectations here. Fatigue responds strongly to placebo in trials, more than most symptoms do. Men often feel better in the first two weeks, before any pharmacology could plausibly have taken effect. That early lift is real to experience but it is not the treatment working, and men who mistake it for the treatment sometimes conclude at week eight that something has stopped working when in fact the actual effect is only beginning to arrive.",
    "The honest version, then. Testosterone therapy in a man with genuinely low testosterone is very likely to improve his sexual function, likely to improve his body composition given some training, and modestly likely to improve mood. Its effect on the specific sensation of energy is real but smaller than the marketing suggests, and it is usually not the largest lever available to you.",
    "Score it honestly anyway, including the good weeks. The pattern over a month tells your provider more than any single number, and if energy is the thing that has not moved when everything else has, that is exactly the observation that should redirect the conversation."
  ]
},

/* -------------------------------------------------------------------- MOOD */
{
  title: "Mood, irritability, and the difference between a side effect and a symptom",
  slug: "mood-and-testosterone",
  category: "mood",
  topics: ["mood", "cognitive"],
  summary: "Low testosterone can flatten mood. So can too much of it. The two feel different, and telling them apart is most of the work.",
  cites: [C.walther, C.zarrouf, C.snyder16, C.huang, C.bhasin18],
  body: [
    "Mood is the field in the check-in most likely to be under-reported, because men are worse at reporting it than anything else on the list. It is also one where the evidence is reasonably encouraging, so it is worth being honest in the box.",
    "The starting point: low testosterone is associated with depressed mood, irritability, and loss of drive, and the association is not merely statistical. Meta-analyses of randomized trials find that testosterone treatment produces a modest but statistically clear reduction in depressive symptoms, with the effect largest in men who were both hypogonadal and symptomatic at baseline. A large meta-analysis in JAMA Psychiatry reached the same conclusion across trials.",
    "The T-Trials, which found only a small effect on vitality, found a clearer one on mood and depressive symptoms in the same men. That pattern is consistent across the literature: mood responds better than energy does.",
    "So mood is one of the more reliable things to expect improvement in. Now the complication, which is the actual reason this article exists.",
    "Too much testosterone also disturbs mood, and it does so in a way that is easy to misread as the underlying problem coming back.",
    "The two states feel different, and learning the difference is genuinely useful.",
    "Under-treated low testosterone tends to feel flat. Blunted. Not sad exactly, more that nothing generates much of a response in either direction. Motivation is the thing that goes first. Men describe not caring about things they know they used to care about, and finding it hard to summon the energy for a conversation, let alone an argument.",
    "Over-treatment tends to feel the opposite. Not flat but volatile: a short fuse, disproportionate irritation at small things, sleep that is disturbed in a wired way rather than an exhausted way, and a sense of being wound too tight. Men around you usually notice this before you do, and it very often arrives together with the other signs of running high.",
    "There is a mechanism worth knowing here, because it explains why this is not simply a matter of dose. Testosterone converts to estradiol via aromatase, and both a shortage and an excess of estradiol disturb mood in men. Estradiol is not a female hormone that men should minimize; men need it, for bone, for libido, and for mood. Push testosterone up hard and estradiol follows, and some of what men attribute to too much testosterone is actually the estradiol coming along behind it. This is one of the reasons your provider reads a pattern rather than a single number, and one of the reasons aggressive dosing tends to make men feel worse rather than better.",
    "What this means for how you use the app. If your mood score drops, the useful information is not just the number but what is happening around it. Note whether it is flat or volatile. Note whether your sleep changed. Note whether it started after a dose change. Those three details turn an ambiguous number into something your provider can act on, and they take one sentence to write.",
    "Two things that are not dose problems and should not be treated as one.",
    "A life event is a life event. A man whose father is dying does not have a testosterone problem that week, and treating it as one is both wrong and insulting. Say what is going on. The record is more useful with the context in it.",
    "And depression is a real, separate, treatable condition that testosterone does not reliably fix and should not be used as a substitute for treating. If your mood has been low for weeks regardless of anything else, that deserves proper attention on its own terms. Say so and it will get it.",
    "Finally, the line that matters most on this page. If you are having thoughts of harming yourself, do not wait for a check-in, a callback, or an appointment. Call or text 988 to reach the Suicide and Crisis Lifeline, any hour of any day. If you are in immediate danger, call 911. There is a box for this in the app and ticking it will put those numbers in front of you straight away, but you do not need our app's permission to make that call."
  ]
},

/* ------------------------------------------------------------------ LIBIDO */
{
  title: "Desire and function are two different problems",
  slug: "desire-versus-function",
  category: "sexual health",
  topics: ["libido"],
  summary: "Wanting sex and being able to have it run on different machinery. Treating the wrong one is the most common reason men feel unheard.",
  cites: [C.snyder16, C.corona, C.finkelstein, C.bhasin18, C.travison17],
  body: [
    "There is a distinction that men and clinicians both blur, and blurring it is the most common reason a man ends up on a treatment that does not address what is actually bothering him.",
    "Desire is wanting sex. Function is the physical machinery working when you do. They are governed by different systems, they fail for different reasons, and they respond to different treatments.",
    "Erectile function is a blood flow event. Arousal triggers nitric oxide release, nitric oxide produces cyclic GMP, cyclic GMP relaxes smooth muscle, the arteries dilate and blood is trapped. PDE-5 inhibitors, tadalafil and the rest, work on that pathway. They preserve the signal that arousal creates.",
    "Desire is not that. It is a central phenomenon, generated in the brain, and testosterone is one of its main determinants. This is the domain where testosterone therapy performs most convincingly. In the Testosterone Trials, sexual function and sexual desire both improved clearly and significantly, and this was the strongest and most consistent finding across the whole program. Where testosterone's effect on vitality was equivocal, its effect on desire was not.",
    "Now put the two together and the clinical picture becomes readable.",
    "A man with strong desire and unreliable erections has a function problem. That is usually vascular, and it responds to the erectile ladder: daily tadalafil first, on-demand dosing added, shockwave therapy if the underlying blood supply needs addressing. Raising his testosterone when it is already adequate will not fix it and may introduce side effects for nothing.",
    "A man whose erections work perfectly well when it comes to it, but who has stopped initiating and stopped thinking about sex at all, has a desire problem. PDE-5 inhibitors do essentially nothing for him. He will conclude the medication failed, when in fact it was never aimed at his complaint. This is the man for whom testosterone is most likely to be the right answer.",
    "And plenty of men have both, which is common and unremarkable, and needs both addressed rather than one and a hope.",
    "There is a mechanistic detail worth adding, because it explains something that otherwise looks contradictory. Finkelstein's work, which suppressed men's own hormone production and then added back testosterone at varying doses with and without blocking aromatase, showed that libido and erectile function depend on estradiol as well as on testosterone. Men in whom aromatization was blocked had worse sexual desire at the same testosterone level.",
    "The practical implication: crushing estradiol in pursuit of a cleaner testosterone number is a reliable way to kill the libido you were trying to restore. If your desire got worse rather than better after a change to your regimen, that is worth saying out loud, and it is one of the specific patterns your provider is watching the labs for.",
    "A few other things that genuinely move desire and are worth ruling in or out before adjusting anything:",
    "Medication. SSRIs are the most common culprit by a wide margin, and the effect is not subtle. Finasteride, some blood pressure medications, and opioids all belong on the list. Your provider needs the full list, including the ones you take occasionally.",
    "Sleep and mood. Both suppress desire independently of hormones, and both are on your check-in for a reason. If desire is low and mood is low, that pairing usually resolves in one direction.",
    "Alcohol. Consistently underestimated, especially the chronic-moderate pattern rather than the occasional heavy night.",
    "And the relationship itself, which no clinic can measure and no lab will show, and which is a legitimate and common answer that nobody should feel embarrassed raising.",
    "The reason to score desire honestly in the app, including when it is low, is that it is one of the clearest signals in the whole set. It responds well and it responds relatively fast. If your desire has not moved after twelve weeks of adequate treatment, that is not something to sit with quietly. It is a specific finding and it should change the plan."
  ]
}
];

/* The existing library gets tagged to the same vocabulary, so nothing in it is
   unreachable from a low score. */
/* The FIRST topic is what an article is primarily about, and that is what the
   app ranks on. Only the six pieces written for a specific measure lead with
   that measure; everything else leads with "general" so it can be a second
   suggestion but never the headline answer to a low score. Without this a man
   who says his strength is 3 gets handed the GLP-1 article. */
const TAGS = {
  "three-hormones":            ["general", "energy", "mood"],
  "why-a-range":               ["general", "energy", "strength", "mood"],
  "how-an-erection-works":     ["general", "libido"],
  "shockwave-regeneration":    ["general", "libido"],
  "treatment-ladder":          ["general", "libido"],
  "why-your-labs-are-timed":   ["general", "energy"],
  "the-first-month-on-a-glp-1":["general", "strength", "energy"],
  "sleep-and-testosterone":    ["sleep", "energy"],
  "strength-and-testosterone": ["strength", "energy"],
  "cognition-and-testosterone":["cognitive", "mood"],
  "energy-and-vitality":       ["energy", "mood"],
  "mood-and-testosterone":     ["mood", "cognitive"],
  "desire-versus-function":    ["libido"]
};

(async function () {
  loadEnv();
  await db.ensureSchema();
  const now = Date.now();

  for (let i = 0; i < ARTICLES.length; i++) {
    const a = ARTICLES[i];
    const words = a.body.join(" ").split(/\s+/).length;
    await db.q(
      `INSERT INTO articles (title, slug, summary, body, category, published,
                             citations, topics, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9)
       ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary,
         body=EXCLUDED.body, category=EXCLUDED.category, citations=EXCLUDED.citations,
         topics=EXCLUDED.topics, updated_at=EXCLUDED.updated_at`,
      [a.title, a.slug, a.summary, a.body.join("\n\n"), a.category,
       JSON.stringify(a.cites), JSON.stringify(a.topics),
       now - (ARTICLES.length - i) * 1000, now]);
    console.log("  " + String(words).padStart(5) + " words  " +
                String(a.cites.length) + " refs  [" + a.topics.join(",") + "]  " + a.title);
  }

  for (const slug of Object.keys(TAGS)) {
    await db.q("UPDATE articles SET topics = $1 WHERE slug = $2",
               [JSON.stringify(TAGS[slug]), slug]);
  }

  /* Every topic the check-in can flag must have something behind it, or a man
     gets told his sleep is bad with nothing to read about it. */
  const rows = await db.q("SELECT title, slug, topics, body FROM articles WHERE published = 1");
  /* Every measure the check-in can flag must have exactly one article that
     LEADS with it, or a low score points somewhere approximate. */
  const owner = {};
  rows.forEach(function (r) {
    let t = []; try { t = JSON.parse(r.topics || "[]"); } catch (e) {}
    if (t[0]) (owner[t[0]] = owner[t[0]] || []).push(r.title);
  });
  console.log("");
  let gap = 0;
  db.FIELD_KEYS.forEach(function (k) {
    const list = owner[k] || [];
    if (list.length !== 1) gap++;
    console.log("  " + (list.length === 1 ? "ok  " : "GAP ") + k.padEnd(11) +
                (list.length ? list.join(" | ") : "nothing leads with this"));
  });
  const untagged = rows.filter(function (r) { return !r.topics || r.topics === "[]"; });
  untagged.forEach(function (r) { console.log("  untagged: " + r.title); });
  const total = rows.reduce(function (a, r) { return a + r.body.split(/\s+/).length; }, 0);
  console.log("\n  " + rows.length + " published, " + total + " words total");
  await db.getPool().end();
  process.exit(gap ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
