# Lovable prompt — JodiVerse "Royal Emerald" redesign

Paste the prompt below into Lovable as-is. Iterate on individual screens with
follow-up prompts ("make the deck card scrim taller", etc.), then screenshot
the results to port back into the Expo app.

---

Build a high-fidelity mobile UI mockup (not a real backend — static demo data
is fine) for **JodiVerse**, a premium Indian dating app. Render everything
inside a centered iPhone-sized frame (390×844) on a neutral page background,
with a screen switcher above the frame to jump between screens.

## Brand & feel
- Positioning: premium, trustworthy, elegant — "serious about finding your
  jodi (pair)". Think five-star hotel lobby, NOT neon hookup app.
- Absolutely avoid: red/pink/orange gradients, flame icons, or anything that
  resembles Tinder. No 3-color gradients anywhere.
- Wordmark: "JodiVerse" in an elegant serif (Fraunces or Playfair Display);
  all UI text in a clean grotesque (Inter or General Sans).
- Logo mark: a minimal gold monoline motif of two interlocking rings (like a
  subtle infinity/knot), never an emoji.

## Color system (use these exact tokens)
- `bg`        #0A1210  — near-black green, main background
- `surface`   #12201B  — cards, sheets, tab bar
- `surface2`  #1A2E26  — raised chips, inputs
- `line`      #24382F  — hairline borders
- `ink`       #F2EFE6  — warm ivory, primary text
- `muted`     #8CA396  — secondary text
- `gold`      #D4AF6A  — champagne gold: primary CTAs, active states, badges
- `goldSoft`  rgba(212,175,106,.14) — gold tint fills
- `emerald`   #1E8E6E  — success, "online" dots, like button
- `danger`    #C25349  — muted brick red for pass/destructive (never bright red)
- `info`      #6FA8C9  — verification blue-teal
- Shadows: soft, large-radius, very low opacity. Radii: cards 24, chips/pills
  999, inputs 14. Generous whitespace; hairline borders over heavy dividers.
- Primary CTA: solid gold pill with near-black text. Secondary: 1px gold
  outline, gold text. Never gradients.

## Screens to build

### 1. Welcome / sign-in
Full-bleed `bg` with a faint radial gold glow top-center. Serif tagline
"It starts with a Jodi." Gold CTA "Continue with Google", outline CTA
"Create account", ghost "Sign in". Tiny legal line in `muted`.

### 2. Swipe deck (home)
Top bar: small gold ring-logo + "JodiVerse" serif wordmark, left-aligned.
Card: full-bleed photo, 24px radius, bottom scrim fading to #0A1210.
On the card:
- White pill badge "New here" (small, top of the text block)
- Name + age in ivory serif (32px), gold verified check beside it
- Row: 💼 "Product designer" · row: green dot "Recently active" · row:
  📍 "Lives in Hyderabad · Within ~5 km" (13px muted-on-photo)
- Chip row: hairline ivory-outline pills — "Life partner", "Hindu",
  "🏏 Cricket", "☕ Chai" (11px)
- Photo progress bars top of card (thin, ivory)
Below the card, 5 floating circular action buttons on `surface`:
rewind (gold arrow), pass (✕ in `danger`), super (star in `info`, slightly
larger), like (heart in `emerald`), boost (bolt in `gold`).

### 3. Full profile view
Scrolling page: 3–6s intro video block first (show a photo with a small
"🔊 muted" toggle bottom-right), then photo stack. Then on `bg`:
- White "New here" pill, serif name+age with gold check
- Green-dot "Online" status line, 💼 occupation, 📍 city
- Pill button "▶ Voice intro" (gold play icon, `surface` fill)
- Bio paragraph in ivory (16px, 1.6 line height)
- Section label "MY BASICS" (11px, letter-spaced, muted) → chips on
  `surface2`: "Life partner", "Hindu", "📏 5'8" (172 cm)", "🍷 Socially",
  "🚬 Never", "Telugu", "English"
- Section "MY INTERESTS" → gold-tinted chips (goldSoft fill, gold border):
  "🏏 Cricket", "🥒 Pickleball", "🎬 Movies", "☕ Chai", "✈️ Travel"
- Sticky bottom row: outline "Chat" + gold "Call (soon)" buttons

### 4. Chats list
Serif "Chats" title. "New jodis" horizontal row of round avatars with gold
rings. Conversation list: avatar, name (ivory 15px semibold), last message
(muted 13px), time, gold unread-count dot. `surface` rows, hairline dividers.

### 5. Likes you (monetization)
Grid of 2×3 blurred photo cards with a lock icon; top card unblurred with
gold border. Gold banner CTA: "See everyone who likes you — JodiVerse Gold".

### 6. Profile edit
Photo grid (6 slots, 3:4, `surface` with dashed `line` borders and gold +),
"Intro video" and "Voice intro" rows (icon + label + gold "Add" link),
inputs on `surface2`, interests picker: grouped gold-tinted chips with a
"7/10" counter, gold "Save" pill.

### 7. "It's a Jodi!" match overlay
Dark overlay (#0A1210 at 96%), two round photos side by side with gold rings,
small gold knot mark between them, serif "It's a Jodi!" headline in ivory,
gold CTA "Send a message", ghost "Keep swiping". Subtle gold confetti dots.

### Bottom tab bar (all main screens)
`surface`, hairline top border, 5 icons: cards, likes-heart, chats, profile.
Active = gold filled icon + tiny gold dot under it. Inactive = `muted` outline.

## Details that matter
- Use realistic Indian names/cities in demo data (Ananya, Vikram, Meera;
  Hyderabad, Bengaluru, Mumbai). Ages 24–34.
- Photos: use elegant placeholder gradients or unsplash-style portraits.
- Every screen must feel like one family: same radii, same chip style, same
  serif-for-names / sans-for-UI rule.
- Dark theme only.
