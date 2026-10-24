# Homepage redesign

Implemented from the supplied `Shan-Deep Government Tender Advisory Homepage.png` reference. The UI remains native React and CSS, with a generated photographic background.

## Original functionality retained

- All eight service groups and their 81 linked service offerings.
- Hero registration and GST details, plus the same details in the footer.
- All original hero actions and navigation destinations.
- English and Hindi, including translated new sections and saved language preference.
- Existing public Supabase sample-tender loading; explicitly labeled synthetic examples appear when sample data is unavailable. No invented live deadlines are shown.
- Original portal description, weekly reports, and four detailed features (including the 150-tender limit and search criteria), available under “Explore all portal features.”
- Four-step overview plus the original nine-step interactive workflow under “Explore our complete nine-step process.”
- Department-category overview plus all 12 original department names in the expandable coverage list, with the original association note.
- Original introductory enquiry text, required name/business/email, optional phone/message, consent, privacy wording, bot honeypot, API submission, errors, loading, and success state with call/WhatsApp links.
- Phone, email, WhatsApp, sign-in, footer information note, and per-page SEO metadata.

The desktop/mobile portal illustration is decorative HTML/CSS with an accessible sign-in link. It is not a screenshot of live account data.

## Generated background

- Mode: built-in `image_gen` tool; imagegen skill.
- Project asset: `public/images/parliament-hero.png` (1536 × 1024 PNG).
- Original generation saved at `C:/Users/lnc/.codex/generated_images/01a16c6a-eecc-7810-9c64-acbd723ce858/exec-adcdd3ba-80c6-48c5-8a3e-9d24628e70c2.png` and copied into the project.
- Used only as decorative background; no generated text is embedded in the UI.

Final generation prompt:

> Use case: photorealistic-natural. Asset type: wide website hero background, landscape 1536x1024. Create a premium realistic architectural photograph of India's historic circular Parliament House, warm cream sandstone colonnades curving across the LOWER RIGHT of frame, recognizable graceful central dome visible above columns, and a tall Indian national tricolor flag waving clearly in the UPPER RIGHT with correct saffron white green stripes and navy Ashoka Chakra. Bright fresh blue sky with soft white clouds, small green trees and garden at bottom right. Building occupies rightmost 48 percent and bottom 60 percent. Leftmost 52 percent is only very pale icy blue sky fading almost to white, quiet and completely empty for an HTML headline; no building, trees or flag on left half. Wide composition, gently low camera angle, natural sunlit stone details, professional trustworthy corporate website aesthetic, crisp realistic photography. No text, letters, logos, watermark, borders, UI, people or collage. Reference is a government tender advisory homepage, but generate only the photographic background, never a website screenshot.

## Validation

- Production Vite build.
- All 15 existing public API and frontend-serving tests pass.
- `e2e/08-homepage-redesign.mjs`: dependency-free Chrome DevTools checks against the running frontend and an isolated in-memory demo API.
- Original content/functionality checks, responsive overflow at 320/390/760/980/1024/1280px, mobile navigation, Hindi and persistence, image loading, SEO, consent gating, successful real API enquiry submission, success contact actions, and service/contact pages.
- Desktop, 1024px, 390px, and Hindi screenshots in `e2e-output/homepage-redesign/` (git-ignored).

To run the browser checks, start the frontend and demo API as described in `e2e/README.md`, launch a separate headless Chrome with `--remote-debugging-port=9227` and a dedicated workspace profile, then run `node e2e/08-homepage-redesign.mjs`.
