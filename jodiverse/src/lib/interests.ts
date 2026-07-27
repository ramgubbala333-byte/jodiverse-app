// Interest catalog — labels are what's stored in profiles.interests (text[]);
// emoji live only here so the DB stays plain and the list can grow freely.
// The ranker (get_deck / match_score) boosts profiles sharing interests.
//
// India-first, chosen for what's genuinely shared across genders rather than
// stereotype picks: cricket, OTT/K-content, street food, festivals, gaming,
// astrology and side-hustle culture all skew close to 50/50 in urban India,
// so they're prioritized over narrowly-gendered categories.

export type Interest = { label: string; emoji: string };
export type InterestGroup = { title: string; items: Interest[] };

export const MAX_INTERESTS = 10;

export const INTEREST_GROUPS: InterestGroup[] = [
  {
    title: "Sports & fitness",
    items: [
      { label: "Gym", emoji: "🏋️" },
      { label: "Yoga", emoji: "🧘" },
      { label: "Running", emoji: "🏃" },
      { label: "Playing cricket", emoji: "🏏" },
      { label: "Football", emoji: "⚽" },
      { label: "Badminton", emoji: "🏸" },
      { label: "Pickleball", emoji: "🥒" },
      { label: "Table tennis", emoji: "🏓" },
      { label: "Swimming", emoji: "🏊" },
      { label: "Cycling", emoji: "🚴" },
      { label: "Trekking", emoji: "🥾" },
      { label: "Marathons", emoji: "🎽" },
      { label: "Zumba", emoji: "🕺" },
      { label: "Dancing", emoji: "💃" },
      { label: "Bike rides", emoji: "🏍️" },
      { label: "Martial arts", emoji: "🥋" },
    ],
  },
  {
    title: "Food & drink",
    items: [
      { label: "Cooking", emoji: "🍳" },
      { label: "Foodie", emoji: "🍜" },
      { label: "Street food", emoji: "🌮" },
      { label: "Chaat", emoji: "🥙" },
      { label: "Biryani", emoji: "🍛" },
      { label: "Momos", emoji: "🥟" },
      { label: "Home-cooked food", emoji: "🍲" },
      { label: "Baking", emoji: "🧁" },
      { label: "Coffee", emoji: "☕" },
      { label: "Chai", emoji: "🫖" },
      { label: "Trying new restaurants", emoji: "🍽️" },
      { label: "Vegan cooking", emoji: "🥗" },
      { label: "Wine tasting", emoji: "🍷" },
      { label: "Mixology", emoji: "🍹" },
    ],
  },
  {
    title: "Movies, OTT & gaming",
    items: [
      { label: "Bollywood", emoji: "🎥" },
      { label: "South Indian cinema", emoji: "🎬" },
      { label: "Web series", emoji: "📺" },
      { label: "K-dramas", emoji: "🎞️" },
      { label: "K-pop", emoji: "🎤" },
      { label: "Anime", emoji: "🌸" },
      { label: "Sci-fi", emoji: "🛸" },
      { label: "Stand-up comedy", emoji: "😂" },
      { label: "Mobile gaming", emoji: "📱" },
      { label: "Video games", emoji: "🎮" },
      { label: "Board games", emoji: "🎲" },
      { label: "Card games", emoji: "🃏" },
      { label: "Watching cricket", emoji: "📡" },
      { label: "Watching football", emoji: "🥅" },
    ],
  },
  {
    title: "Music & creative arts",
    items: [
      { label: "Live music", emoji: "🎸" },
      { label: "Singing", emoji: "🎙️" },
      { label: "Playing an instrument", emoji: "🎹" },
      { label: "Classical music", emoji: "🎻" },
      { label: "Indie music", emoji: "🎧" },
      { label: "Hip-hop", emoji: "🎧" },
      { label: "Punjabi music", emoji: "🥁" },
      { label: "Sufi & ghazals", emoji: "🕊️" },
      { label: "Bollywood dance", emoji: "💃" },
      { label: "Classical dance", emoji: "🪷" },
      { label: "Photography", emoji: "📷" },
      { label: "Content creation", emoji: "🎬" },
      { label: "Painting", emoji: "🎨" },
      { label: "Writing", emoji: "✍️" },
      { label: "Shayari & poetry", emoji: "📜" },
      { label: "Theatre", emoji: "🎭" },
    ],
  },
  {
    title: "Travel & outdoors",
    items: [
      { label: "Travel", emoji: "✈️" },
      { label: "Solo travel", emoji: "🧳" },
      { label: "Backpacking", emoji: "🎒" },
      { label: "Exploring new cities", emoji: "🗺️" },
      { label: "Road trips", emoji: "🚗" },
      { label: "Goa trips", emoji: "🏖️" },
      { label: "Hill stations", emoji: "🏞️" },
      { label: "Himalayan treks", emoji: "🏔️" },
      { label: "Camping", emoji: "🏕️" },
      { label: "Beaches", emoji: "🌊" },
      { label: "Gardening", emoji: "🪴" },
      { label: "Stargazing", emoji: "🔭" },
      { label: "Wildlife & nature", emoji: "🦁" },
    ],
  },
  {
    title: "Mind, money & learning",
    items: [
      { label: "Reading", emoji: "📚" },
      { label: "Book clubs", emoji: "📖" },
      { label: "Science", emoji: "🔬" },
      { label: "History", emoji: "🏛️" },
      { label: "Philosophy", emoji: "💭" },
      { label: "Podcasts", emoji: "🎧" },
      { label: "Learning languages", emoji: "🗣️" },
      { label: "Tech", emoji: "💻" },
      { label: "AI & startups", emoji: "🚀" },
      { label: "Side hustles", emoji: "💼" },
      { label: "Investing", emoji: "📈" },
      { label: "Crypto", emoji: "🪙" },
      { label: "Chess", emoji: "♟️" },
      { label: "Quizzing", emoji: "🧠" },
    ],
  },
  {
    title: "Lifestyle, faith & festivals",
    items: [
      { label: "Dogs", emoji: "🐶" },
      { label: "Cats", emoji: "🐱" },
      { label: "Spirituality", emoji: "🕉️" },
      { label: "Meditation", emoji: "🧘‍♂️" },
      { label: "Astrology", emoji: "✨" },
      { label: "Tarot", emoji: "🔮" },
      { label: "Volunteering", emoji: "🤝" },
      { label: "Family time", emoji: "👨‍👩‍👧" },
      { label: "Sense of humor", emoji: "😄" },
      { label: "Empathy", emoji: "💙" },
      { label: "Fashion", emoji: "👗" },
      { label: "Skincare", emoji: "🧴" },
      { label: "Thrifting", emoji: "🛍️" },
      { label: "Holi", emoji: "🎨" },
      { label: "Diwali", emoji: "🪔" },
      { label: "Garba & Dandiya", emoji: "🪘" },
    ],
  },
];

const EMOJI: Record<string, string> = Object.fromEntries(
  INTEREST_GROUPS.flatMap((g) => g.items.map((i) => [i.label, i.emoji])),
);

/** "Gym" → "🏋️ Gym"; unknown labels pass through unchanged. */
export const withEmoji = (label: string) =>
  EMOJI[label] ? `${EMOJI[label]} ${label}` : label;
