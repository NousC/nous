# Founding Charter — Diagrams

Visual companion to `founding-charter.md`. One diagram per section, kept deliberately minimal — *less is more*.

**How to use:** in Excalidraw, open the Mermaid insert dialog and paste a single block at a time. All diagrams are `flowchart` type, which converts to editable Excalidraw shapes. The *italic* line under each is the talking point for a presentation or video.

---

## Overview — the presentation arc

```mermaid
flowchart LR
    A["The Shift"] --> B["The Formula"]
    B --> C["The Tests"]
    C --> D["What We Build"]
    D --> E["The Moat"]
```

*"Here's the logic we'll walk through — each step forces the next."*

---

## 1 · The Shift

```mermaid
flowchart TD
    A["AGI makes cognition free"] --> B{"Where is the value?"}
    B -->|"value IS cognition"| C["OBSOLETE"]
    B -->|"value is evidence"| D["SURVIVES"]
    C --> C1["writing · parsing · matching · querying"]
    D --> D1["observations · provenance · the loop"]
```

*"When thinking gets free, only one kind of thing keeps its value."*

---

## 2 · The Formula

```mermaid
flowchart TD
    A["Accuracy is capped by min( )"] --> C["Cognition"]
    A --> F["Freshness x Coverage"]
    C --> C1["AGI drives to ~1 — no longer the limit"]
    F --> F1["Stays scarce — the whole bottleneck"]
```

*"Accuracy is a min of two things. AGI removes one. So the other is everything."*

---

## 3 · The Three Tests

```mermaid
flowchart LR
    I["New idea"] --> T1{"AGI test"}
    T1 -->|pass| T2{"Compounding test"}
    T2 -->|pass| T3{"Coordination test"}
    T3 -->|pass| B["BUILD"]
    T1 -->|fail| X["DON'T BUILD"]
    T2 -->|fail| X
    T3 -->|fail| X
```

*"Every idea runs three gates in series. Miss one, it dies."*

---

## 4 · The Litmus Test

```mermaid
flowchart TD
    Q{"Would the best model in 5 years make this MORE valuable, or unnecessary?"}
    Q -->|"more valuable"| B["BUILD — it's evidence"]
    Q -->|"unnecessary"| D["DON'T BUILD — it's cognition"]
```

*"When in doubt, one question decides it."*

---

## 5 · The Problem

The problem is not a number — it's **trust**. Unreliable data can't be trusted, and without trust the entire promise of AI-native GTM collapses.

```mermaid
flowchart TD
    D["Unreliable, decaying data"] --> T["No trust"]
    F["Scattered across 10+ tools"] --> T
    T --> H["Humans re-check everything — AI saves ~0"]
    T --> A["Or agents act wrong at scale — damage"]
    H --> P["AI-native GTM cannot work"]
    A --> P
```

*"Bad data isn't the problem. Untrustworthy data is — because an agent either gets babysat, or does damage at scale. Trust is the hinge everything turns on."*

---

## 6 · The Baseline

```mermaid
flowchart LR
    A["Today: 60-70% accurate"] --> B["Industry ceiling: ~85%"]
    B --> C["Nous: 99%+ continuous"]
```

*"Everyone is stuck below 85%. We're going somewhere no current tooling reaches — and we keep it there."*

---

## 7 · What We Build — the substrate

```mermaid
flowchart TD
    O["Observation — immutable evidence"] --> C["Claim — derived belief + confidence"]
    E["Entity — canonical anchor"] --> C
    C --> R["Account record built for agents"]
```

*"Three primitives. We store evidence and derive belief — we never store a bare value."*

---

## 8 · The Self-Healing Loop

```mermaid
flowchart LR
    O["Observation"] --> C["Claim + confidence"]
    C --> A["Agent acts"]
    A --> R["Reality responds: bounce / reply"]
    R --> O
```

*"Reality answers back, and every answer corrects the model. For free."*

---

## 9 · The Compound Loop

```mermaid
flowchart LR
    P["Prediction"] --> A["Agent acts"]
    A --> O["Real outcome"]
    O --> E["Episode = prediction + outcome"]
    E --> M["Model refines"]
    M --> P
```

*"Every prediction gets graded. Every grade makes the next one sharper."*

---

## 10 · Why Us — vs the alternatives

```mermaid
flowchart TD
    S["The opportunity"] --> A1["GTM app"]
    S --> A2["Horizontal layer"]
    S --> A3["Better CRM"]
    S --> A4["Evidence substrate"]
    A1 --> X1["AGI eats it"]
    A2 --> X2["Can't compound"]
    A3 --> X3["No moat"]
    A4 --> W["WE BUILD THIS"]
```

*"Four paths. Three are traps. One appreciates."*

---

## 11 · The ROI

```mermaid
flowchart TD
    N["Nous substrate"] --> R1["Recovered selling time"]
    N --> R2["Agent autonomy unlocked"]
    N --> R3["Calibrated scoring + forecasting"]
```

*"Reliable data turns into money three ways — and autonomy is the big one."*

---

## 12 · The Moat

```mermaid
flowchart LR
    A["Every agent + customer using it"] --> B["More observations + graded episodes"]
    B --> C["More accurate, more predictive"]
    C --> D["Lived evidence AGI cannot synthesize"]
    D --> A
```

*"The moat isn't the code. It's the lived record — and it compounds with every use."*
