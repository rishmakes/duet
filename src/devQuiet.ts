/**
 * Duet dev only: React's development build writes a timing note for every redraw, comparing each
 * component's old and new props. In Safari's engine those notes pile up and every change grew slow
 * (caption sliders froze for a third of a second, #404). React writes them only when the console can
 * stamp times, so Duet dev takes that away before React loads. The real app's build has no notes.
 * Must be the first import of main.tsx.
 */
if (import.meta.env.DEV) (console as { timeStamp?: unknown }).timeStamp = undefined;
