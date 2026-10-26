# Homepage redesign

The public landing page follows the supplied six-screen reference: a serif-headed B2B layout with a **keyword tender-search hero**, a parliament image **pinned behind the whole page** while content scrolls over it, white cards, a bright-blue accent, two-tone serif section titles, and a dark **mega footer**. It is native React and CSS.

## Fixed background

`.lp-bg` is `position: fixed` behind everything (`public/images/parliament-hero.png`), softened with a mask and a light wash so dark text stays readable; the content sections are transparent/white cards that scroll over it, and the footer is solid dark. The whole site shell (`.site-landing`) is transparent on `/` so the fixed layer shows through. To replace the image, drop a new file at the same path (landscape, subject on the right, airy sky).

## Where things are

| What | File |
|---|---|
| Page and its sections | `src/pages/public/Home.jsx` |
| Landing styles (all scoped to `.lp`) | `src/landing.css` |
| Shared header, footer, buttons, tokens | `src/site.css` (below the "Public site shell" comment) and `src/layouts/PublicLayout.jsx` |
| Landing text, English and Hindi | `src/i18n/en.js`, `hi.js` under `site.lp` |
| Legal pages (English only) | `src/content/legal.js`, `src/pages/public/Legal.jsx` |
| Hero background | `public/images/parliament-hero.png` (1536 x 1024) |

## Sections, top to bottom

1. **Header**: brand, Home / Services / About / Contact, EN | हिंदी, **Request Access**, **Tender Portal**. Collapses to a menu below 1080px.
2. **Hero**: kicker, "Find Government Tenders. **Win with Confidence.**", a **keyword search box** with Tender-Type and Value filters and "More filters", popular-search chips, **Request Access** / **Explore Services**, and a four-stat strip. The search is real: it builds the portal's filter query and routes through sign-in to the results (`/login` with a `from=/app/search?…` redirect).
3. **Latest government tenders**: three cards (department, deadline, title, state, value, reference). Live synthetic rows come from the public Supabase table; otherwise labelled illustrations, with a loading skeleton.
4. **Our Services**: the eight groups, each linking to its page (81 services). Card wording follows the reference, e.g. "GeM Portal Services" (the group page keeps its canonical "GeM Portal Specialist").
5. **The portal**: what subscribers get, with the code-drawn laptop and phone illustration.
6. **How We Help You Win**: four steps, with "View detailed process" revealing the interactive nine-step chart.
7. **About Shan-Deep**: intro, four feature cards (tender intelligence, compliance, submission desk, coverage) and a three-stat strip.
8. **Government departments we cover**: seven categories, "View all departments" revealing the 12 named departments and the no-association note.
9. **Get in Touch**: phone / email / office / WhatsApp cards and an office-location card (hours, prime location, easy access), with Request-a-Callback and email buttons.
10. **Request Access**: the enquiry form with leading field icons and a character counter (creates an *access request* for staff, see ADMIN_GUIDE) beside a side panel (quick response, expert advisory, immediate assistance, who gets access).
11. **Mega footer**: brand + tagline + three trust badges; Services (the 8 groups), Company and Get Started columns; a contact row (call, WhatsApp, email, office); a registration block (business registration, GST, address, language); and the legal bar (Privacy, Terms, Disclaimer, Sitemap).

## Contact details are live, not the mockup's placeholders

The reference screens show sample numbers (e.g. `+91 755 491 2345`, `info@shandeepadvisory.in`, a GST like `23ABCDE…`). The page does **not** hard-code those — phone, email, WhatsApp, business registration and GST all come from the server (`useSiteConfig` / site-config), so they stay correct and editable without a rebuild. The office address shows the general Bhopal, MP location and the office hours are a sensible default; confirm both with Shan-Deep (see CLIENT_INPUTS_CHECKLIST).

## Decisions worth knowing

- **Marketing stats.** The reference's "7,000+ Government Departments" and "100% Compliance Focus" are shown as in the reference (they are Shan-Deep's own marketing claims, repeatedly requested). "81 Services", "36 States & UTs" and "8 groups" are facts from the catalogue. Confirm the two marketing figures are ones Shan-Deep is comfortable standing behind.
- **No "Resources" menu.** The reference nav/footer had Resources, Guides, Careers, etc.; there is no such content, so those links are not created. The footer's Services column links the eight real service groups, and Company / Get Started link only to real pages.
- **Public search gating.** Department and State filters need the master lists (sign-in only), so the hero exposes keyword + Tender Type + Value and sends everything into the portal search after sign-in; "More filters" opens the full search there.
- **Fonts.** Headlines use Source Serif 4 (Noto Serif Devanagari for Hindi), from Google Fonts; the production CSP already allows it.
- **Legal pages** describe what the system does (forms, consent record, no trackers, hashed passwords). Have Shan-Deep's adviser review them, and bump `NOTICE_VERSION` in `legal.js` when the privacy text changes.
- **Hindi** is a first draft, like the rest of the Hindi text.

## Background image

The hero reuses the generated photograph already in the project: curved sandstone colonnade and flag on the right, clear sky on the left for the headline. It is softened and faded into the page in CSS. To replace it, drop a new file at the same path (landscape, about 1536 x 1024, subject on the right 45%, empty sky on the left). A prompt that matches the reference:

> Photorealistic wide website hero, landscape 1536x1024. India's Parliament House: warm cream sandstone colonnade and dome on the right half, a tall Indian tricolour flag against a soft blue sky with light clouds, a few green trees at the base. Left 50% is calm pale sky fading to near white, empty for a headline. Soft natural daylight, slightly desaturated, calm and trustworthy. No text, logos, people, watermark or borders.

## Checks

- `e2e/08-homepage-redesign.mjs` (Chrome DevTools, no dependencies): section content, links, the nine-step chart, no overflow from 1280 down to 320px, mobile menu, Hindi, form consent, a real submission, and the request appearing in the staff Access requests queue. Start the frontend and demo API as in `e2e/README.md`, launch headless Chrome with `--remote-debugging-port=9227` and a dedicated profile, then `node e2e/08-homepage-redesign.mjs`.
- `e2e/06-website.mjs` covers the home page, group and service pages, search, Hindi, the sitemap (97 URLs) and the mobile menu.
