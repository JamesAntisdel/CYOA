import type { StarterStory } from "../metadata";

export const trainingRoom: StarterStory = {
  summary: {
    id: "training-room",
    title: "Escape the Training Room",
    summary: "A three-room tutorial about keys, consequences, and careful choices.",
    tone: "candlelit tutorial",
    difficulty: "tutorial",
    estimatedLength: "5-10 minutes",
    entitlementRequired: "free",
    safetyProfile: "general",
    mode: "authored",
  },
  story: {
    id: "training-room",
    version: 1,
    title: "Escape the Training Room",
    defaultSceneLength: "brief",
    startNodeId: "waking-cell",
    deathNodeId: "ending-crushed",
    initialState: {
      vitality: 10,
      currency: 0,
      attributes: {
        resolve: {
          id: "resolve",
          label: "Resolve",
          value: 1,
          visibility: "hidden",
          min: 0,
          max: 5,
        },
      },
      inventory: [],
      flags: {
        read_wall_runes: false,
      },
    },
    endings: {
      "ending-crushed": {
        id: "ending-crushed",
        label: "The Lesson Lands Hard",
        kind: "death",
      },
      "ending-escape": {
        id: "ending-escape",
        label: "The Door Remembers You",
        kind: "success",
      },
    },
    nodes: {
      "waking-cell": {
        id: "waking-cell",
        title: "Room 1 - The Locked Cell",
        seed:
          "The player wakes in a candlelit training cell with a locked oak door, wall runes, and a loose brick.",
        choices: [
          {
            id: "take-key",
            label: "Lift the loose brick and take the rusty key.",
            targetNodeId: "rune-hall",
            effects: [
              {
                kind: "inventory_add",
                item: {
                  id: "rusty_key",
                  label: "Rusty Key",
                  description: "A bent iron key with a tooth missing.",
                },
              },
              { kind: "flag_set", flag: "found_key", value: true },
            ],
          },
          {
            id: "study-runes",
            label: "Study the wall runes before touching anything.",
            targetNodeId: "rune-hall",
            effects: [
              { kind: "flag_set", flag: "read_wall_runes", value: true },
              { kind: "stat", statId: "resolve", delta: 1 },
            ],
          },
          {
            id: "kick-door",
            label: "Kick the locked door until it gives.",
            targetNodeId: "rune-hall",
            effects: [
              { kind: "stat", statId: "vitality", delta: -2 },
              { kind: "flag_set", flag: "made_noise", value: true },
            ],
          },
        ],
      },
      "rune-hall": {
        id: "rune-hall",
        title: "Room 2 - The Rune Hall",
        seed:
          "A narrow hall hums with training magic. A chalk sigil, a brass bowl, and a shut gate wait ahead.",
        effectsOnEnter: [
          {
            kind: "delayed",
            delayNodes: 2,
            effects: [{ kind: "stat", statId: "vitality", delta: -1 }],
          },
        ],
        choices: [
          {
            id: "unlock-gate",
            label: "Use the rusty key on the gate.",
            targetNodeId: "weight-room",
            conditions: [{ kind: "has_item", itemId: "rusty_key", hint: "Needs Rusty Key" }],
            effects: [
              { kind: "inventory_remove", itemId: "rusty_key" },
              { kind: "flag_set", flag: "gate_unlocked", value: true },
            ],
          },
          {
            id: "trace-sigil",
            label: "Trace the chalk sigil exactly as the runes described.",
            targetNodeId: "weight-room",
            conditions: [
              {
                kind: "flag_equals",
                flag: "read_wall_runes",
                value: true,
                hint: "The runes were not studied",
              },
            ],
            effects: [
              {
                kind: "inventory_add",
                item: {
                  id: "chalk_mark",
                  label: "Chalk Mark",
                  description: "A bright mark of passage on your palm.",
                },
              },
              { kind: "stat", statId: "resolve", delta: 1 },
            ],
          },
          {
            id: "grab-bowl",
            label: "Take the brass bowl as a makeshift shield.",
            targetNodeId: "weight-room",
            effects: [
              {
                kind: "inventory_add",
                item: {
                  id: "brass_bowl",
                  label: "Brass Bowl",
                  description: "Dented, heavy, and better than bare hands.",
                },
              },
              { kind: "currency", delta: 1 },
            ],
          },
        ],
      },
      "weight-room": {
        id: "weight-room",
        title: "Room 3 - The Counterweight Door",
        seed:
          "The final chamber holds a counterweight door, a pressure plate, and a lesson about consequences.",
        choices: [
          {
            id: "brace-with-bowl",
            label: "Brace the pressure plate with the brass bowl.",
            targetNodeId: "ending-escape",
            conditions: [{ kind: "has_item", itemId: "brass_bowl", hint: "Needs Brass Bowl" }],
            effects: [{ kind: "flag_set", flag: "escaped_cleanly", value: true }],
          },
          {
            id: "trust-mark",
            label: "Press your chalk-marked palm to the counterweight door.",
            targetNodeId: "ending-escape",
            conditions: [{ kind: "has_item", itemId: "chalk_mark", hint: "Needs Chalk Mark" }],
            effects: [{ kind: "stat", statId: "resolve", delta: 1 }],
          },
          {
            id: "force-final-door",
            label: "Throw your full weight against the door.",
            targetNodeId: "ending-crushed",
            conditions: [{ kind: "stat_at_least", statId: "resolve", value: 2 }],
            effects: [{ kind: "stat", statId: "vitality", delta: -12 }],
          },
          {
            id: "read-counterweight-lesson",
            label: "Study the counterweight lesson and reset the door.",
            targetNodeId: "ending-escape",
            effects: [
              { kind: "stat", statId: "resolve", delta: 1 },
              { kind: "flag_set", flag: "escaped_by_lesson", value: true },
            ],
          },
        ],
      },
      "ending-crushed": {
        id: "ending-crushed",
        title: "A Hard Lesson",
        seed:
          "The training room ends the attempt with an external mechanical hazard, then resets for another try.",
        endingId: "ending-crushed",
        isDeath: true,
        choices: [],
      },
      "ending-escape": {
        id: "ending-escape",
        title: "The Door Remembers You",
        seed: "The player escapes the tutorial room with a first lesson in consequences.",
        endingId: "ending-escape",
        choices: [],
      },
    },
  },
};
