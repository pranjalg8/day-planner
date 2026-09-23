// Schedule template — no personal identifiers, diagnosis, contact info, or
// payment data. Just the operational plan needed to run daily reminders.
// Edit this file to adjust the plan as your program/coach updates it.

export const PROGRAM = {
  // The day you actually start following this plan day-to-day (diet,
  // walks, tracking). Separate from the medicine course dates below, since
  // those follow the prescription date regardless of when tracking starts.
  planStart: "2026-09-24",
  // 30-day daily-medicine course window (prescription-dated).
  dailyMedsCourseStart: "2026-09-19",
  dailyMedsCourseDays: 30,
  // Weekly medicine (Uprise-D3) course: once a week for 12 weeks, starting
  // the first Thursday of the plan.
  weeklyMedStart: "2026-09-24",
  weeklyMedDayOfWeek: 4, // 0=Sun .. 6=Sat, 4=Thursday
  weeklyMedCourseWeeks: 12,
  // Prescription review checkpoint (~4 weeks from prescription date).
  reviewDate: "2026-10-17",
};

// Default clock times (24h "HH:MM") if the user hasn't overridden them for
// a given day. All are editable per-day in the app.
export const DEFAULT_TIMES = {
  wake: "06:15",
  earlyMorning: "06:30",
  breakfast: "08:30",
  lunch: "13:30",
  snack: "16:00",
  dinner: "19:30",
  bedtime: "22:30",
};

// Daily medicines. `slot` ties a medicine to a meal block. `bufferAfterMin`
// means: nothing else may be taken for this many minutes after this
// medicine. `dependsOnBuffer` means: this medicine waits until the named
// slot's buffer clears before it's taken.
export const MEDICINES = [
  {
    id: "stable-n-fit-am",
    name: "Stable N Fit 60mg",
    slot: "breakfast",
    course: "daily",
    offsetAfterMealMin: 5, // must be within 30 min after meal; 5 gives margin
    bufferAfterMin: 60,
    notes: "Take within 30 min after food. Nothing else for 1 hour after.",
  },
  {
    id: "l-carnitine-am",
    name: "L-Carnitine 500mg",
    slot: "breakfast",
    course: "daily",
    dependsOnBuffer: "stable-n-fit-am",
    notes: "After meal.",
  },
  {
    id: "b12-matilda-forte-am",
    name: "Vitamin B12 (Matilda Forte)",
    slot: "breakfast",
    course: "ongoing",
    dependsOnBuffer: "stable-n-fit-am",
    notes: "Existing daily routine — dose per your own supply label. Shifted here to clear the Stable N Fit buffer.",
  },
  {
    id: "evion-l-5000",
    name: "Evion L 5000",
    slot: "lunch",
    course: "daily",
    offsetAfterMealMin: 15,
    notes: "After meal — liver support / antioxidant.",
  },
  {
    id: "uprise-d3-60k",
    name: "Uprise-D3 60K",
    slot: "lunch",
    course: "weekly",
    offsetAfterMealMin: 15,
    notes: "Weekly dose — same slot as Evion L.",
  },
  {
    id: "stable-n-fit-pm",
    name: "Stable N Fit 60mg",
    slot: "dinner",
    course: "daily",
    offsetAfterMealMin: 5,
    bufferAfterMin: 60,
    notes: "Take within 30 min after food. Nothing else for 1 hour after.",
  },
  {
    id: "l-carnitine-pm",
    name: "L-Carnitine 500mg",
    slot: "dinner",
    course: "daily",
    dependsOnBuffer: "stable-n-fit-pm",
    notes: "After meal.",
  },
  {
    id: "roseday-f-10",
    name: "Roseday-F 10",
    slot: "dinner",
    course: "daily",
    dependsOnBuffer: "stable-n-fit-pm",
    notes: "After meal — cholesterol.",
  },
];

// Non-medicine actions.
export const ACTIONS = {
  cucumberSlices: 3,
  walkAfterMealMin: 15,
  stepTarget: 2000,
  walkTargetMin: 30,
  waterTargetLitres: 2,
  waterCheckpoints: 4, // spread evenly between wake and bedtime
};

// 7-day meal rotation. Index 0 = Sunday .. 6 = Saturday (matches Date#getDay()).
export const MENUS = {
  earlyMorning: [
    "Warm water 250ml + lemon 1tsp + soaked almonds (5)", // Sun
    "Warm water 250ml + lemon 1tsp + soaked almonds (5)", // Mon
    "Warm water 250ml + lemon 1tsp + soaked almonds (5)", // Tue
    "Warm water 250ml + lemon 1tsp + soaked almonds (5)", // Wed
    "Warm water 250ml + lemon 1tsp + soaked almonds (5)", // Thu
    "Warm water 250ml + lemon 1tsp + soaked almonds (5)", // Fri
    "Warm water 250ml + lemon 1tsp + soaked almonds (5)", // Sat
  ],
  breakfast: [
    "Sprouts chaat (60g sprouts) + vegetables + lemon + 1 tsp olive oil", // Sun
    "Besan chilla (40g besan) + 50g vegetables (onion, tomato, spinach) + oil 1 tsp + Curd 100g", // Mon
    "Moong dal chilla (50g soaked moong dal) + paneer stuffing 40g + oil 1 tsp — soak dal the night before", // Tue
    "Paneer bhurji (60g paneer) + vegetables 50g + oil 1 tsp + 1 small roti (30g flour)", // Wed
    "Sooji cheela (30g sooji/suji) + vegetables 50g + curd 50g + oil 1 tsp", // Thu
    "Oats cheela (30g oats flour) + vegetables 50g + curd 50g + oil 1 tsp", // Fri
    "Vegetable upma (40g suji) + vegetables 100g + 3 almonds", // Sat
  ],
  lunch: [
    "Jowar Bhakri (30g) + Lauki Paneer Sabji (1 katori) + Vegetable Salad (1 katori)", // Sun
    "Jowar Bhakri (30g) + Lauki Paneer Sabji (1 katori) + Vegetable Salad (1 katori)", // Mon
    "Little Millet Khichdi (little millet 2 tbsp + masoor dal 2 tbsp + chopped veg 1 katori + ghee 1 tsp) + Soya chunks sauteed vegetables (1 katori)", // Tue
    "Jowar Bhakri (30g) + Rajma Curry (1 katori) + Papaya & Carrot (1 katori)", // Wed
    "Soy chunk curry (50g raw soya chunks) + Brown rice (1 katori) + Cucumber Raita (1 katori)", // Thu
    "Palak Paneer (80g paneer) + Jowar Bhakri (30g) + Salad (1 katori)", // Fri
    "Mix veg + Tofu (80g tofu) + 1 small Jowar Bhakri (30g)", // Sat
  ],
  snack: [
    "Roasted chana 30g + green tea", // Sun
    "Paneer cubes 50g + spices", // Mon
    "Sprouts salad (50g) steamed", // Tue
    "Roasted chana 30g + green tea", // Wed
    "Paneer cubes 50g + spices", // Thu
    "Sprouts salad (50g) steamed", // Fri
    "Roasted chana 30g + green tea", // Sat
  ],
  dinner: [
    "Curd bowl (200g) + seeds (chia/flax 1 tsp each)", // Sun
    "Paneer tikka (100g paneer) + sautéed vegetables 100g", // Mon
    "Tofu bhurji (80g tofu) + vegetables 100g", // Tue
    "Dal (40g raw) + vegetable sabzi 100g (no roti)", // Wed
    "Palak paneer (80g paneer)", // Thu
    "Vegetable soup + paneer cubes 50g", // Fri
    "Stir-fried vegetables + soy chunks 40g raw", // Sat
  ],
};
