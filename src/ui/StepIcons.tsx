import type { StepKind } from "../ai/recipes";

/**
 * Step icons drawn exclusively for Kitchen.
 * Bold, simple, 2 or 3 shapes each, stroke 2 on a 24×24 grid.
 * Soft filled shapes in a tint of the step's colour plus a confident 2px stroke,
 * rounded joins, optically centred.
 */

export type StepIconName =
  | "brief"
  | "questions"
  | "answers"
  | "wireframe"
  | "comments"
  | "design"
  | "icons"
  | "check"
  | "polish"
  | "ai-fallback"
  | "you-fallback";

/** Match step by its id for shipped steps, by title words otherwise. */
export function stepIconFor(step: { id: string; title: string; kind: StepKind }): StepIconName {
  const id = step.id.toLowerCase();
  // Match shipped steps by id
  if (id === "brief") return "brief";
  if (id === "questions") return "questions";
  if (id === "answers") return "answers";
  if (id === "wireframe") return "wireframe";
  if (id === "wireframe-comments" || id === "design-comments") return "comments";
  if (id === "design") return "design";
  if (id === "icons") return "icons";
  if (id === "check") return "check";
  if (id === "polish") return "polish";

  // Match by title words for user steps
  const t = step.title.toLowerCase();
  if (/\bbrief\b|\bspec\b|\bnote\b|\bdoc\b/.test(t)) return "brief";
  if (/\bquestion\b|\bask\b|\bquery\b/.test(t)) return "questions";
  if (/\banswer\b|\breply\b|\bresponse\b/.test(t)) return "answers";
  if (/\bwireframe\b|\bwire\b|\blayout\b|\bsketch\b/.test(t)) return "wireframe";
  if (/\bcomment\b|\breview\b|\bfeedback\b/.test(t)) return "comments";
  if (/\bdesign\b|\bui\b|\bmockup\b|\bvisual\b/.test(t)) return "design";
  if (/\bicon\b|\basset\b|\bsymbol\b/.test(t)) return "icons";
  if (/\bcheck\b|\baudit\b|\btest\b|\binspect\b/.test(t)) return "check";
  if (/\bpolish\b|\btidy\b|\bclean\b|\bfinish\b/.test(t)) return "polish";

  // Fallback by kind
  return step.kind === "ai" ? "ai-fallback" : "you-fallback";
}

export default function StepIcon({ name, className }: { name: StepIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICONS[name]}
    </svg>
  );
}

const ICONS: Record<StepIconName, React.ReactNode> = {
  // Brief: a page with a short note
  brief: (
    <>
      <path
        d="M5 3h9l5 5v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 21V4.5A1.5 1.5 0 0 1 5 3z"
        fill="currentColor"
        fillOpacity={0.2}
      />
      <path d="M14 3v5h5" fill="none" />
      <path d="M7 13h10M7 17h6" fill="none" />
    </>
  ),

  // Questions: two overlapping speech bubbles with a question mark
  questions: (
    <>
      {/* Background bubble */}
      <path
        d="M9 4h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1.5L15 15.5V13H9"
        fill="currentColor"
        fillOpacity={0.16}
      />
      {/* Foreground bubble */}
      <path
        d="M4 8h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8.5L5 19.5V17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"
        fill="currentColor"
        fillOpacity={0.25}
      />
      {/* Question mark */}
      <path d="M7 11.2a1.4 1.4 0 0 1 2.6.5c0 .8-1.1 1.1-1.1 1.9" strokeWidth={1.8} fill="none" />
      <circle cx="8.5" cy="15.2" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),

  // Answers: bubble with a tick
  answers: (
    <>
      <path
        d="M4 4.5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"
        fill="currentColor"
        fillOpacity={0.2}
      />
      <path d="M8.5 10.5l2.5 2.5 5-5" fill="none" />
    </>
  ),

  // Wireframe: a page split into rough blocks
  wireframe: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="none" />
      <rect x="6" y="6.5" width="12" height="3" rx="1" fill="currentColor" fillOpacity={0.25} stroke="none" />
      <rect x="6" y="11.5" width="5" height="6" rx="1" fill="currentColor" fillOpacity={0.25} stroke="none" />
      <rect x="13" y="11.5" width="5" height="6" rx="1" fill="currentColor" fillOpacity={0.25} stroke="none" />
    </>
  ),

  // Comments: one speech bubble with a pin dot
  comments: (
    <>
      <path
        d="M4 4.5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"
        fill="currentColor"
        fillOpacity={0.2}
      />
      <circle cx="12" cy="10.5" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),

  // Design: a layout with a filled picture and a text block
  design: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="none" />
      <rect x="6" y="6.5" width="5" height="11" rx="1.2" fill="currentColor" fillOpacity={0.25} />
      <path d="M13.5 8h4.5M13.5 12h3M13.5 15h4" fill="none" />
    </>
  ),

  // Icons: one star in a rounded square
  icons: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="currentColor" fillOpacity={0.2} />
      <path
        d="M12 6.5c0 3.2 2.3 5.5 5.5 5.5-3.2 0-5.5 2.3-5.5 5.5 0-3.2-2.3-5.5-5.5-5.5 3.2 0 5.5-2.3 5.5-5.5z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),

  // Check: a magnifier over a tick
  check: (
    <>
      <circle cx="10.5" cy="10.5" r="6" fill="currentColor" fillOpacity={0.2} />
      <path d="M15 15l4.5 4.5" fill="none" />
      <path d="M8 10.5l2 2 3.5-3.5" fill="none" />
    </>
  ),

  // Polish: a four-point sparkle with a small one beside it
  polish: (
    <>
      <path
        d="M10.5 3c0 4-3.5 7.5-7.5 7.5 4 0 7.5 3.5 7.5 7.5 0-4 3.5-7.5 7.5-7.5-4 0-7.5-3.5-7.5-7.5z"
        fill="currentColor"
        fillOpacity={0.25}
      />
      <path
        d="M19 3.5c0 1.8-1.4 3.2-3.2 3.2 1.8 0 3.2 1.4 3.2 3.2 0-1.8 1.4-3.2 3.2-3.2-1.8 0-3.2-1.4-3.2-3.2z"
        fill="currentColor"
        fillOpacity={0.35}
        strokeWidth={1.5}
      />
    </>
  ),

  // Fallback for AI steps
  "ai-fallback": (
    <>
      <path
        d="M12 3.5c0 4.5-4 8.5-8.5 8.5 4.5 0 8.5 4 8.5 8.5 0-4.5 4-8.5 8.5-8.5-4.5 0-8.5-4-8.5-8.5z"
        fill="currentColor"
        fillOpacity={0.25}
      />
      <circle cx="19" cy="5.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),

  // Fallback for You steps
  "you-fallback": (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" fill="currentColor" fillOpacity={0.2} />
      <path d="M8 8.5h8M8 12.5h5" fill="none" />
      <path d="M14.5 15.5l1.8 1.8 3.2-3.2" fill="none" strokeWidth={1.75} />
    </>
  ),
};
