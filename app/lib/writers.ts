import { SEATS, N_SEATS, SeatIndex } from "./agents";

export const SKILLS: Record<number, { name: string; description: string }> = {
  0: {
    name: "Imagist",
    description:
      "Add one concrete sensory image — something you can see, hear, touch, smell, or taste. If the text is only a word, grow it into a short line or two around the image. Keep anything already striking.",
  },
  1: {
    name: "Metaphorist",
    description:
      "Introduce exactly one metaphor or simile that reframes something literal in the text. If the text is only a word, invent a metaphor from it and give it a brief setting.",
  },
  2: {
    name: "Juxtaposer",
    description:
      "Place two unlike elements next to each other to create unexpected contrast or tension. Add a second image/idea if needed so something can be juxtaposed. Preserve the first image.",
  },
  3: {
    name: "Rhythm-keeper",
    description:
      "Reorder words and swap near-synonyms so the piece has a clearer rhythm when read aloud. Do not change meaning, do not add new images, do not remove images.",
  },
  4: {
    name: "Compressor",
    description:
      "Cut roughly a third of the length, preserving the most striking image. If the text is extremely short, cut only a single word that adds the least.",
  },
  5: {
    name: "Polisher",
    description:
      "Light edit for sound, grammar, and clarity. Do not add or remove images. Fix only what feels off.",
  },
};

export const WRITERS_RULES = `
Six writers sit around a round table with a tall floral pot in the middle.
The pot blocks any sight or sound across the diagonal: you can only whisper to
your two immediate neighbors, and you cannot see any seat that is not your direct
neighbor.

Seating (clockwise): ${SEATS.map((s, i) => `${s} (${i})`).join(", ")}.

The table is collaboratively writing a short poem. There is one shared artifact in
front of everyone, visible to all. It began as a single seed word.

Each round has three steps:
  1. Whisper. Send a short whisper to your left neighbor and one to your right.
  2. Vote. Nominate an ordered pair of seats (A, B) who should collaborate next.
     "Ordered" means A acts first: A transforms the artifact using A's skill,
     and B then transforms A's output using B's skill.
  3. Resolve. The ordered pair with the plurality of votes does the composed
     transformation. The artifact is updated for everyone to see.

There are three rounds. Each pair can be used at most once (the ordered direction
counts: (A, B) and (B, A) are distinct). The group's shared goal is simply to
produce a good poem — short, rhythmic, with at least one vivid image and at
least one unexpected turn.

Every writer sees the full table of skills. You have your own single skill,
listed in your system prompt.
`.trim();

export function skillsTable(): string {
  return Object.entries(SKILLS)
    .map(([i, s]) => `  - seat ${i} (${SEATS[Number(i)]}): ${s.name}`)
    .join("\n");
}

export function skillBrief(seat: SeatIndex): { name: string; description: string } {
  return SKILLS[seat];
}
