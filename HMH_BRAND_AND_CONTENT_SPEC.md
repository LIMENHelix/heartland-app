# Heartland Men's Health — Brand & Content Spec
Source: heartlandmenshealth.com, harvested 2026-07-30. Every value below was pulled from the
live site (raw HTML, Oxygen `universal.css`, logo SVGs) — not estimated from screenshots.

---

## 1. Identity

**Name:** Heartland Men's Health (HMH)
**Parent:** Promeniq Restorative Health Partner Practice (Denver, CO — (720) 372-1501)
**Tagline:** "CHANGING MEN'S LIVES, ONE TREATMENT AT A TIME"
**Positioning line:** "THE PREMIER PROVIDER FOR MEN'S SEXUAL & RESTORATIVE HEALTHCARE IN KANSAS & MISSOURI"
**Descriptor:** Concierge medical clinic for men's sexual and lifestyle health.

**Mission (verbatim):**
> "Transform men's healthcare by providing effective treatments and restoring their well-being,
> youthful vigor, and intimate relationships."

**Core values (8, verbatim labels):**
Truth · Excellence · Empathy · Hard Work · Respect · Relationships · Adaptability · Results

**Brand emotional job:** remove stigma. The site's whole posture is that men avoid care because
of embarrassment, so every surface leans on *discreet, professional, fast, no-judgment*.
Office-park suites, not hospitals. This is the single most important thing for app tone.

---

## 2. Color palette (extracted from CSS + logo SVG)

| Role | Hex | Notes |
|---|---|---|
| **Primary gold** | `#C5A359` | Logo fill (color mark). The brand color. |
| Gold (UI variant) | `#B49243` | Most-used accent in site CSS (13 occurrences). Buttons, rules, icons. |
| Gold (dark/hover) | `#8D6E25` | Deep gold for pressed/hover |
| Gold (alt) | `#B1923C` | Minor variant |
| **Primary dark** | `#21313B` | Logo dark fill + dominant dark surface (12 occurrences). Deep slate-navy. |
| Dark (alt) | `#20313B` / `#23313B` | Same family, rounding variance |
| **Secondary blue** | `#25495C` | Section backgrounds, secondary surfaces |
| Blue (alt) | `#2A495D` / `#356883` | Variants |
| **Accent terracotta** | `#C66B3D` | Warm secondary accent (5 occurrences) — used sparingly |
| Terracotta dark | `#974F2B` | Hover state |
| **Stone / cream** | `#E5E4DA` | Logo "stone" fill; the light neutral |
| Stone (alt) | `#E6E5DB` | |
| Off-white | `#F9F9FA` | Page background |
| White | `#FFFFFF` | |
| Gray mid | `#ADB4B9` | Muted text / borders |
| Gray mid-dark | `#98A1A8` | |
| Gray line | `#CFD3D7` | Dividers |
| Text dark | `#374047` / `#333333` | Body copy |

**Overlay values in use:** `rgba(33,49,59,0.8)` (dark scrim over hero imagery),
`rgba(255,255,255,.12)` (subtle light dividers on dark), `rgba(0,0,0,0.5)`.

**Palette character:** gold-on-deep-slate. Reads as premium/private-club rather than clinical
blue-and-white. Deliberately not "medical." Keep it that way.

---

## 3. Typography

Loaded from Google Fonts:
`PT Sans` · `Raleway` (700/800/900) · `Roboto` · `Bai Jamjuree`

| Use | Family | Spec |
|---|---|---|
| **Headings h1–h6** | **Raleway** | `font-weight: 700`; h1/h2 `36px`; h3–h6 `18px` |
| **Body** | **PT Sans** | default weight |
| **UI / accent** | **Bai Jamjuree** | used with `!important` on nav + component chrome |
| Utility | Roboto | minor |

**Treatment:** heavy use of `text-transform: uppercase` (11 rules) on headings, buttons and
eyebrow labels. One display rule uses `letter-spacing: 5px`. Uppercase + wide tracking + gold
is the signature.

---

## 4. Shape & component language

- **Border radius:** `8px` is the dominant value (11 rules), `10px` secondary (8 rules),
  `100%` for circular icon badges. Legacy buttons `3px`.
- **Buttons:** rectangular, near-square corners, uppercase label, gold fill on dark or
  gold outline on light.
- **Imagery:** stock lifestyle photography of men (40s–60s), plus dark scrimmed hero images.
- **Logo assets (SVG, public):**
  - `https://heartlandmenshealth.com/wp-content/uploads/2024/06/HMH-Full-Logo-Centered-Color.svg`
  - `https://heartlandmenshealth.com/wp-content/uploads/2024/06/HMH-Full-Logo-Centered-Gold-Stone.svg`
  - Icon mark: `https://heartlandmenshealth.com/wp-content/uploads/2023/07/Icon-4c.svg`

---

## 5. Site structure (full internal link map)

```
/                          Home
/about/                    Mission, 8 values, leadership team
/faq/                      Cost, payment, privacy, hours, what to bring
/contact/                  Appointment request form
/locations/                3 clinics

WHAT WE TREAT
/erectile-dysfunction/     ED — 7 treatment modalities
/low-testosterone/         Low-T
/premature-ejaculation/    PE
/glp-1/                    Weight loss
/eswt/                     Shockwave therapy
/eswt-intrapulse/          IntraPulse ESWT system
/concierge-low-t-treatments/

THE SCIENCE
/science-erectile-dysfunction/

TOOLS
/ed-quiz/                  ED severity screen  (= SHIM/IIEF-5, see §7)
/low-t-quiz/               Low-T screen        (= ADAM-derived, see §7)

LEGAL / OPS
/privacy-policy/  /terms-and-conditions/  /disclaimer/
/cookies-policy/  /telehealth-consent/    /our-advertising/
/continuity-of-care/  /media-inquiry/
```

**Persistent header:** logo · nav (Home, About Us, What We Treat, The Science, Locations,
Patient Portal) · "Book Online" button · phone `1-844-447-6600`.
**Persistent urgent element:** priapism emergency hotline `844-981-4996`.

---

## 6. Operational facts (drive app copy — do not invent alternatives)

- **Main phone:** 1-844-447-6600 (live schedulers)
- **Priapism emergency line:** 844-981-4996
- **Hours:** Mon–Fri 8:30 AM – 5:00 PM. Walk-ins welcome until 3:30 PM. Appointments recommended.
- **Availability claim:** "Same & Next-Day Appointment Availability"
- **Office visit price:** **$99** — includes confidential consult with a licensed KS/MO
  provider, complete diagnostic blood panel *including testosterone and PSA*, and a test dose
  of medication if medically advised.
- **ED guarantee (verbatim intent):** if the test dose doesn't work during the initial
  appointment, the visit is not charged.
- **Insurance:** **not processed in the clinic.** Cash-pay. Accepts Visa, MasterCard, Amex,
  personal check, cash. **HSA accepted.** Documentation provided for patient-filed claims.
- **Privacy claim:** majority of tests/labs handled in-house; "latest encryption technology"
  for records.
- **What to bring:** medical history + medication list, government photo ID, payment method,
  partner optional (welcomed).

### Locations
| Clinic | Address |
|---|---|
| Overland Park, KS | 4601 W. 109th St., Suite 325, Overland Park, KS 66211 |
| Independence, MO | 4911 S. Arrowhead Dr., Suite 304, Independence, MO 64055 |
| North Kansas City, MO | 4150 N. Mulberry Dr., Suite 140, Kansas City, MO 64116 |

### Team
Jeff Dillon (CEO, Founding Partner) · Erik Haack (Regional VP, Partner) ·
Jeff Turek (Market Director/Provider) · Alex Crossen (Provider) · Carrie Meek (Provider) ·
Dianna Garcia (PA)

---

## 7. The two quizzes — corrected identification

The site presents these as proprietary. They are not.

**`/ed-quiz/` items 1–5 are the SHIM (Sexual Health Inventory for Men / IIEF-5), verbatim,
with the exact published response anchors.** Item 6 ("Have you ever been treated with
medication for ED?") is an HMH addition and is not scored.

Published SHIM scoring — each item 1–5, sum of items 1–5, range 5–25:
| Score | Classification |
|---|---|
| 22–25 | No ED |
| 17–21 | Mild ED |
| 12–16 | Mild–moderate ED |
| 8–11 | Moderate ED |
| 5–7 | Severe ED |

**`/low-t-quiz/` is an ADAM-derived (Androgen Deficiency in the Aging Male) 10-item yes/no
screen.** HMH substitutes two items (sleep trouble, weight gain/muscle mass) for ADAM's
"lost height" and "decreased enjoyment of life"; the other eight map 1:1.

Published ADAM rule: **positive screen** = "yes" to Q1 (decreased libido) *or* Q7 (weaker
erections), *or* "yes" to any 3 other questions.

Site items, verbatim:
1. Have you noticed a decrease in libido (sex drive)?
2. Have you experienced less daily energy?
3. Are you unable to complete workouts and/or seeing a decrease in results?
4. Are you experiencing weight gain or decreased muscle mass?
5. Have you had trouble sleeping?
6. Are you experiencing feelings of sadness or depression?
7. Are you experiencing weak erections or an inability to maintain an erection?
8. Have you seen an overall decline in your health?
9. Do you find yourself falling asleep right after dinner?
10. Are you accomplishing less at work?

> **Neither instrument is diagnostic.** Both are screens that indicate whether to have a
> conversation with a provider. Any app implementation must say exactly that, and the
> scoring bands above must be signed off by an HMH provider before shipping.

---

## 8. Clinical content available for the app

**ED** — causes (vascular, hormonal, neurologic, psychogenic, medication); prevalence claim
"nearly 50% of men by age 50, +10% per decade"; outcome claim "successfully treated in well
over 90% of cases." Seven modalities:
1. ESWT (low-intensity acoustic waves) — 1–2 days downtime
2. Oral/sublingual — sildenafil, vardenafil, tadalafil, avanafil. **Contraindicated with
   nitrates**; caution with alpha-blockers
3. Vacuum erection device
4. Injection therapy — Tri-Mix, Caverject, alprostadil, papaverine, phentolamine
5. Penile implants (surgical referral)
6. Intraurethral suppositories / MUSE (referral)
7. Autologous regenerative therapies

**Low-T** — symptoms: low libido, fatigue, low energy, muscle loss, weight gain, ED, memory
loss, depression. Dx by blood test. Monitoring: "keeps a close eye on blood levels to detect
side effects early." Documented risks: elevated BP, prostate complications, RBC changes,
cholesterol/PSA changes, hair loss, mood swings, gynecomastia, testicular atrophy, decreased
sperm count, acne, worsened sleep apnea. *Delivery method (injection/pellet/cream) is not
stated on the site — must come from the clinic.*

**IntraPulse ESWT** — ~30 min per treatment, 45 min appointment slot. Session count varies
by patient. May combine ESWT with oral or injected meds. $99 consult.

**GLP-1 weight loss** — compounded GLP-1. BMI assessment for eligibility. Side effects
(nausea, vomiting, diarrhea, abdominal pain, constipation, heartburn, burping) "typically
resolve within the first month." **Contraindicated** with personal/family history of
medullary thyroid carcinoma or MEN2. *Dosing/titration schedule not published — must come
from the clinic.*

**PE** — causes: stress/anxiety, hormonal imbalance, injury, medication. Treatments:
supplements/medications, stamina techniques/exercises, customized protocols.

> **Mandatory disclaimer, appears site-wide:** "Featured therapies are compounded and have
> not been approved nor evaluated for safety, effectiveness, or quality by the FDA."
> Dispensed by state-licensed compounding pharmacies. This must appear anywhere the app
> names a compounded therapy.

---

## 9. Technical constraints (the part that decides the build)

**EHR / patient portal: AdvancedMD**, office key `150527`.
Portal URL: `https://patientportal.advancedmd.com/150527/account/logon`

AdvancedMD offers two API surfaces:
- **FHIR APIs** — free, **read-only (GET only)**, SMART-on-FHIR OAuth 2.0. Enough to *display*
  records, never to write.
- **Connect APIs** — proprietary, XML-RPC and REST, near-full UI functionality (read + write).
  Requires a signed **Certified API Developer Agreement with licensing and support fees**,
  which then unlocks docs + sandbox.
- AdvancedMD prohibits development/testing against real patient data.

**Consequence:** any feature that writes to the chart, books a real appointment slot, or pulls
live labs is gated on a *business agreement*, not on code. That is a Jeff Dillon / Promeniq
decision with a cost and a lead time, and it should be started now if it's wanted, because it
runs in parallel with the build.

**Compliance constraints already published by the practice** (from `/telehealth-consent/`):
- Async messaging channels "may not be monitored continuously. Response times are not
  guaranteed." — the app must state this on any messaging surface.
- Automated/AI tools "do not diagnose medical conditions," "do not provide medical advice,"
  "do not determine treatment eligibility." — hard ceiling on anything AI-driven in the app.
- Telehealth explicitly excludes emergencies; 911 language required.
- Consent is captured by checkbox / "I agree" / e-signature / intake submission / booking.
- Patient-side security duties: private location, secure connection, avoid public Wi-Fi.

**PHI:** any symptom score, dose log, or lab value tied to an identifiable patient is PHI.
That requires a HIPAA-eligible backend under a signed BAA, encryption at rest and in transit,
audit logging, and session timeout. It is not a "add auth later" detail — it determines the
hosting choice on day one.
