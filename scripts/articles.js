/* The patient library.

   Adapted from the clinic's own presentation deck. The deck is coordinator
   facing and written to walk a prospect through mechanisms; these keep the
   mechanism and the numbers but speak to a man already in treatment, carry no
   pricing, and end in what it means for him rather than what to buy.

   Every clinical claim traces to the deck or to a cited paper. A provider
   should read these before patients do: rewording clinical content can shift
   its meaning, and the rewording here is mine.

   Run:  npm run articles
*/
"use strict";

const loadEnv = require("./env");
const db = require("../lib/db");

const FDA = "Featured therapies are compounded and have not been approved or evaluated for " +
  "safety, effectiveness or quality by the FDA. They are dispensed by state-licensed " +
  "compounding pharmacies.";

const C = {
  tsigos:      { label: "Tsigos 2002",     url: "https://doi.org/10.1016/S0022-3999(02)00429-4" },
  cumming:     { label: "Cumming 1983",    url: "https://doi.org/10.1210/jcem-57-3-671" },
  schneider:   { label: "Schneider 1979",  url: "https://doi.org/10.1210/jcem-48-4-633" },
  vermeulen:   { label: "Vermeulen 2000",  url: "https://doi.org/10.1016/S0378-5122(99)00075-4" },
  travison07:  { label: "Travison 2007",   url: "https://doi.org/10.1210/jc.2006-1375" },
  travison17:  { label: "Travison 2017",   url: "https://doi.org/10.1210/jc.2016-2935" },
  harman:      { label: "Harman 2001",     url: "https://doi.org/10.1210/jcem.86.2.7219" },
  bhasin:      { label: "Bhasin 2018 (Endocrine Society guideline)", url: "https://doi.org/10.1210/jc.2018-00229" },
  finkelstein: { label: "Finkelstein 2013 (NEJM)", url: "https://doi.org/10.1056/NEJMoa1206168" },
  capogrosso:  { label: "Capogrosso 2017", url: "https://doi.org/10.1016/j.jsxm.2017.03.250" },
  vardi:       { label: "Vardi 2010 (Eur Urol, sham-controlled)", url: "https://doi.org/10.1016/j.eururo.2010.09.043" }
};

const ARTICLES = [

{
  title: "The three hormones that move together",
  slug: "three-hormones",
  category: "testosterone",
  summary: "Testosterone never acts alone. Cortisol and estradiol move with it, and what you feel is usually all three.",
  cites: [C.tsigos, C.cumming, C.schneider, C.vermeulen, C.travison07, C.harman],
  body: [
    "Most men arrive thinking about a single number. It is the wrong frame, and it is the reason two men with identical testosterone levels can feel completely different. Testosterone moves alongside cortisol, your primary stress hormone, and estradiol, which your own body manufactures from testosterone. What you actually experience is the position of all three relative to each other.",
    "Start with stress, because it is the mechanism men most often dismiss. The system governing your stress response and the system governing your sex hormones are not separate circuits. Sustained cortisol output suppresses release of gonadotropin-releasing hormone from the hypothalamus and luteinizing hormone from the pituitary. Those are the upstream signals telling the Leydig cells in the testes to produce testosterone. Turn the signal down and production follows.",
    "This has a name in the literature, stress-induced hypogonadism, and the effect size is not subtle. A man carrying chronically elevated cortisol can present with testosterone a full age-decade below what his years would predict. That is a measurable physiological consequence of a sustained load, not a matter of attitude, and it is why a conversation about your sleep and your work is a clinical conversation rather than small talk.",
    "The second mechanism is about body composition. An enzyme called aromatase converts testosterone into estradiol, and aromatase is expressed most heavily in adipose tissue. The more body fat a man carries, the more of his testosterone is diverted down that path. More fat means more conversion, and more conversion means less of the testosterone he does produce reaching the tissues that need it.",
    "That explains a pattern which otherwise looks contradictory. A heavier or older man can present with high estradiol and low free testosterone simultaneously. It is also why testosterone therapy given without attention to estrogen can amplify certain symptoms rather than relieve them. You have raised the substrate, and if the conversion pathway is wide open you have raised the product too.",
    "Stack those two across a lifespan and you get the shape that appears in population data. Cortisol output drifts up, particularly in men under chronic load. Testosterone production drifts down. And a greater share of what remains is converted to estradiol. The result is a slow scissor: one line falling, two rising. The crossover, where men typically start noticing it as symptoms rather than as a lab value, commonly appears somewhere in the forties and fifties.",
    "Be careful with the numbers themselves. Median values describe populations and individual variation is wide. Reference ranges in men run roughly 6 to 23 mcg/dL for morning serum cortisol and 10 to 50 pg/mL for estradiol. Where you sit inside those, and how you arrived there, matters considerably more than whether you are technically within them.",
    "What this means in practice. Your provider is not reading one number, because one number cannot distinguish a man with low production from a man with adequate production and high conversion. Those two men need different treatment. It also means the things you might not think to mention, a weight change, a period of unusual stress, sleep that has quietly degraded, are part of the clinical picture. Tell your coordinator. It changes what the numbers mean."
  ]
},

{
  title: "Why the target is a range, and why higher is not better",
  slug: "why-a-range",
  category: "testosterone",
  summary: "The right dose resolves your symptoms at the lowest level that does so. Chasing a bigger number reliably makes men worse.",
  cites: [C.bhasin, C.finkelstein, C.travison17, C.harman],
  body: [
    "There is an intuition almost every man brings to testosterone therapy: if some helps, more will help more. It is wrong, and acting on it is one of the more common ways men on treatment end up feeling worse than when they started.",
    "The goal is returning you to a healthy physiologic range, broadly 500 to 900 ng/dL on therapy. That range is where symptom relief happens. Above it the benefit curve flattens while the side-effect curve does not. You are no longer buying improvement, you are buying consequences.",
    "The cleanest way to hold this: the correct dose is whichever one resolves your symptoms at the lowest serum level that achieves it, not the highest level you can physically tolerate.",
    "Two numbers often get conflated and should not be. You will see 300 ng/dL quoted as a threshold. That is a laboratory reference cutoff used to support a diagnosis. It is not a description of when a man feels well or unwell. Plenty of men are symptomatic above it and plenty are asymptomatic below it, and symptom-based quality-of-life decline is commonly reported well above that line. This is exactly why your provider reads your labs next to what you report, and why 'your number is normal' is not by itself an answer to feeling poorly.",
    "What goes wrong when levels run too high is worth knowing, because most of it is silent until it is not.",
    "Your blood thickens. Testosterone stimulates red cell production, and a haematocrit climbing above roughly 54% raises thromboembolic risk. This is specifically watched on your labs and is one of the main reasons the monitoring schedule exists at all.",
    "Aromatization surges. More substrate through the same enzyme means more estradiol, which presents as breast tenderness or gynecomastia, water retention and mood volatility.",
    "Your own production shuts down. Exogenous testosterone suppresses the upstream signal, causing testicular atrophy and impaired fertility. If children are on your horizon, that is a conversation to have before starting rather than after.",
    "Beyond those: sleep apnea worsens where it already exists; blood pressure rises, driven by both plasma volume and red cell mass; lipids shift, LDL up and HDL down, in a dose-dependent way; skin gets oilier, acne appears, and androgenic hair loss accelerates in men predisposed to it; mood can tip toward irritability and disrupted sleep.",
    "Read that list again and notice something. Almost every item is dose-dependent. These are not arguments against treatment. They are arguments against overshooting, and they are why the monitoring cadence is not optional.",
    "So if your dose does not feel right, say so rather than adjusting anything yourself. Under-dosing and over-dosing can feel surprisingly similar from the inside, and labs distinguish them where your subjective experience cannot. Message your coordinator and describe what changed."
  ]
},

{
  title: "How an erection actually works, and where each treatment intervenes",
  slug: "how-an-erection-works",
  category: "sexual health",
  summary: "One mechanism, several points of entry. Understanding it explains why the treatments are ordered the way they are.",
  cites: [C.capogrosso, C.bhasin],
  body: [
    "An erection is a blood flow event governed by a chemical signal. Once you understand the signal, every treatment on the ladder stops looking like a separate product and starts looking like a different point of entry into the same process.",
    "Sexual arousal causes nerve endings and the vascular lining in the penis to release nitric oxide. Nitric oxide triggers production of a messenger called cyclic GMP. Cyclic GMP relaxes the smooth muscle in the erectile chambers. As that muscle relaxes the helicine arteries feeding the chambers dilate and blood floods in. The chambers expand against a tough surrounding sheath, the tunica albuginea, and that expansion compresses the veins that would otherwise drain the blood away. Inflow rises, outflow closes, and the erection holds.",
    "An enzyme called PDE-5 continuously clears cyclic GMP away. That is normal housekeeping; it is how an erection resolves afterwards.",
    "PDE-5 inhibitors, which is what tadalafil, sildenafil, vardenafil and avanafil are, block that clearing enzyme. The signal your own arousal produces accumulates instead of being swept away. This is the single most important thing to understand about them: they do not create an erection, they preserve a signal that arousal has to produce first. Without arousal there is no cyclic GMP to preserve and nothing happens. Men who expect otherwise conclude the medication failed when it did precisely what it does.",
    "Daily low-dose tadalafil is the usual starting point for two reasons. The first is practical: tadalafil's half-life is around 17.5 hours, long enough that a small daily dose keeps PDE-5 partially inhibited around the clock. Nothing has to be timed, and spontaneity returns, which for many men is most of the complaint.",
    "The second reason matters more and gets less attention. Continuous low-level PDE-5 inhibition improves endothelial function, the health of the lining of your blood vessels, independent of whether you are having sex. Vasculogenic dysfunction, a problem with that lining, is the most common underlying cause of erectile difficulty in the first place. So daily dosing is not only treating the symptom, it acts on the mechanism producing it. That is why it is the conservative first line: safe, well tolerated, and aimed at the most common cause.",
    "On-demand full strength, sildenafil 50 to 100 mg or tadalafil 10 to 20 mg taken 30 to 60 minutes beforehand, is added when the daily dose alone is not delivering the erection quality you want. Note the word added; it layers on top rather than replacing.",
    "Then there is a delivery problem worth understanding. A swallowed tablet must clear the stomach, absorb across the small intestine, and survive first-pass metabolism in the liver before any of it reaches circulation. A large fraction never arrives. Typical bioavailability is roughly 40% for sildenafil and around 14% for vardenafil. Much of what you swallow is gone before it can act.",
    "A sublingual troche dissolves under the tongue and absorbs through the oral mucosa, which is densely vascularized, into venous return draining to the superior vena cava, bypassing that first pass through the liver. Three consequences follow. Onset is faster and more predictable. A lower milligram dose produces the same erectile effect with less downstream metabolite load. And it is unaffected by a fatty meal, which can otherwise noticeably blunt a swallowed tablet. Clinically it is the right escalation for a man who has not responded reliably to swallowed oral medication, or who wants a faster and more predictable onset.",
    "Two safety points that are not negotiable. Never combine a PDE-5 inhibitor with nitrates in any form. Tell your provider if you take an alpha-blocker. And an erection lasting four hours or more is a medical emergency that can cause permanent damage: call the priapism line on 844-981-4996 or go to an emergency room.",
    FDA
  ]
},

{
  title: "Shockwave therapy: what regeneration actually means",
  slug: "shockwave-regeneration",
  category: "sexual health",
  summary: "Not a stimulant. A controlled mechanical signal that switches on your own tissue's repair response, over weeks.",
  cites: [C.vardi, C.capogrosso],
  body: [
    "Low-intensity shockwave therapy is the treatment men most often misunderstand, because its name suggests something forceful and its category suggests something immediate. It is neither. It is regenerative, it works over weeks, and judging it the week after your last session tells you essentially nothing.",
    "A focused acoustic probe delivers controlled mechanical pulses into the cavernosal tissue, typically at an energy flux density of 0.09 to 0.25 mJ/mm² across 3,000 to 5,000 pulses per session. Those are deliberately low-energy figures. The intent is not to disrupt tissue.",
    "What the pulses produce is shear stress on the endothelium, the lining of the blood vessels. That stress is not damage. It is a signal, and the tissue responds the way tissue responds to a controlled demand: by activating its native repair machinery.",
    "Two things follow, and they matter for different reasons. Vascular endothelial growth factor synthesis surges in the treated tissue, recruiting endothelial progenitor cells out of circulation to the site. And expression of endothelial nitric oxide synthase increases, the enzyme producing the nitric oxide that starts the entire erectile cascade.",
    "That second point is the one to hold onto. Shockwave therapy restores the upstream signal that PDE-5 inhibitors work by amplifying. If oral medication has been giving you only a partial response, one plausible reason is that there was not much signal there to amplify. This addresses that directly rather than working around it.",
    "New arteriolar networks form in the erectile chambers over roughly the following four to twelve weeks. That is why benefit appears well after the course finishes, and why patience with it is not a stalling tactic but the actual pharmacology of tissue regeneration.",
    "Practically: an individual treatment runs about 30 minutes inside a 45-minute appointment that includes preparation and time with your provider. Session count varies by patient and by response. Most men need a day or two of taking it easy afterwards. Side effects are generally mild: bruising, swelling, transient numbness or tingling.",
    "Because it works on the underlying blood supply rather than masking the symptom, some men find afterwards that they can step back down to a lighter treatment than they were on. Needing less rather than more is the point of a regenerative tier, and it is unusual among erectile treatments.",
    "One sequencing note. Regenerative injections such as PRP are timed deliberately into the window shortly after a shockwave course, within roughly four to eight weeks, when the tissue is already primed and the repair response is running. Administering them at an arbitrary point is not the same treatment.",
    FDA
  ]
},

{
  title: "The treatment ladder, and why it is ordered this way",
  slug: "treatment-ladder",
  category: "sexual health",
  summary: "Six tiers, conservative first. Most men sit low on it, and moving up is driven by response rather than preference.",
  cites: [C.capogrosso, C.vardi],
  body: [
    "Erectile treatments here are offered in a deliberate order, and that order is conservative first. It is worth understanding, because it explains why you were started where you were started and what would have to be true for that to change.",
    "Read it from the bottom up. Most men sit on the lower tiers and stay there. Escalation is driven by treatment response and by what you are actually trying to achieve, not by preference and not by what sounds most advanced.",
    "The base is diagnostic: evaluation by a licensed clinician, baseline laboratory workup, and ongoing monitoring. Nothing above this tier is prescribed without it, because erectile dysfunction is frequently the presenting symptom of something else, vascular disease, hormonal deficiency, a medication side effect, or a psychological cause. Treating the symptom while missing that is a failure of care regardless of how well the symptom responds.",
    "Tier one is oral: daily low-dose tadalafil, with on-demand full-strength PDE-5 inhibitors when the daily dose alone is insufficient. Safe, well tolerated, aimed at the most common underlying cause.",
    "Tier two is sublingual on-demand, added on top of the daily dose rather than replacing it, for men where swallowed tablets are not delivering reliably. This is a change of delivery route, not of drug class.",
    "Tier three is regenerative: a discrete course of shockwave therapy layered onto whatever pharmacologic baseline you are already on. Men commonly stay here as long as the response holds, and because it improves blood flow rather than masking the symptom, some are able to drop back a tier afterwards.",
    "Tier four sequences regenerative injections into the shockwave priming window for maximum effect, rather than administering them independently.",
    "Tier five is injection therapy, Trimix or Quadmix, reserved for men whose erectile response does not meet their goals on the oral and regenerative tiers. One rule here is absolute: the in-office test dose always precedes any at-home use. That is not bureaucracy. It is how the dose is calibrated and how prolonged erections are avoided.",
    "Tier six is a surgical implant, and it is genuinely last. Only after the pharmacologic and regenerative tiers have been tried, and only when you and your clinician agree erectile function is otherwise unrecoverable. It is effective and it is irreversible, which is precisely why it sits where it sits.",
    "If you want to understand your own position on this ladder, what would move you up, or what would let you step down, ask your coordinator. It is a reasonable question with a specific answer in your case.",
    FDA
  ]
},

{
  title: "Why your labs are timed the way they are",
  slug: "why-your-labs-are-timed",
  category: "labs",
  summary: "Eight weeks, then four, then every six months. Each draw answers a different question.",
  cites: [C.bhasin, C.travison17],
  body: [
    "Your lab schedule is not administrative. Each draw is timed to answer a specific question, and the timing is the reason the answer can be trusted.",
    "The first is at eight weeks. That interval exists because levels need time to settle into a steady state on a given dose. Draw earlier and you are measuring a transient rather than a treatment. Eight weeks in, what comes back reflects what the therapy is actually doing rather than what it did in the first two weeks.",
    "The second is four weeks after that, twelve weeks from your start, and its job is confirmation. A single reading can be an artifact of timing, illness, sleep or a dozen other things. Two readings in agreement establish that the picture is stable and the dose is right, or establish clearly that it is not.",
    "After that it moves to every six months, which is a monitoring cadence rather than a titration one. By then the question has changed from 'is this dose correct' to 'is anything drifting'.",
    "What gets looked at. Your visit panel includes total testosterone and PSA. Through treatment your blood levels are watched so that anything needing attention is caught early rather than late. Several of the meaningful risks of testosterone therapy, a rising haematocrit, prostate changes, lipid shifts, are silent in the sense that you will not feel them arriving. Labs are the only way they are detected while still easy to address. That is the honest reason the schedule is not optional.",
    "It is also why a number alone is insufficient. Two men can return an identical testosterone value and need opposite adjustments, because one is converting most of his to estradiol and the other is not. Your provider reads a pattern, not a figure, and reads it alongside what you have reported about how you feel.",
    "That last part depends on you. If your energy, sleep, mood or libido has shifted since the last draw, say so, even if it seems minor and even if you assume it is unrelated. It changes how the numbers are interpreted.",
    "Practically: you do not need an appointment. Walk in Monday to Friday between 8:30 AM and 4:30 PM. Your next scheduled draw is shown on your home screen, and if one has passed the app will keep saying so until it is done."
  ]
}
];

(async function () {
  loadEnv();
  await db.ensureSchema();
  const now = Date.now();

  // retire the earlier shallow versions
  const OLD = ["stress-weight-testosterone", "range-not-the-highest-number",
               "why-daily-tadalafil", "why-sublingual", "what-eswt-is-doing",
               "how-ed-treatments-layer"];
  for (const slug of OLD) await db.q("DELETE FROM articles WHERE slug = $1", [slug]);

  for (let i = 0; i < ARTICLES.length; i++) {
    const a = ARTICLES[i];
    const words = a.body.join(" ").split(/\s+/).length;
    await db.q(
      `INSERT INTO articles (title, slug, summary, body, category, published, citations, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)
       ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary,
         body=EXCLUDED.body, category=EXCLUDED.category, citations=EXCLUDED.citations,
         updated_at=EXCLUDED.updated_at`,
      [a.title, a.slug, a.summary, a.body.join("\n\n"), a.category,
       JSON.stringify(a.cites), now - (ARTICLES.length - i) * 1000, now]);
    console.log("  " + String(words).padStart(4) + " words  " +
                String(a.cites.length) + " refs   " + a.title);
  }

  const rows = await db.q("SELECT title, citations FROM articles ORDER BY category, title");
  const noRef = rows.filter(function (r) { return !r.citations || r.citations === "[]"; });
  console.log("\n  " + rows.length + " articles live, " + (rows.length - noRef.length) + " referenced");
  noRef.forEach(function (r) { console.log("    no refs: " + r.title); });
  await db.getPool().end();
})().catch(function (e) { console.error(e); process.exit(1); });
