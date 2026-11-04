/** One icon set for the whole app: 24 grid, round ends, same stroke weight everywhere. */

export type IconName = "cut-here" | "cut-close" | "cut-before" | "cut-after" | "move" | "frame" | "rect" | "ellipse" | "text" | "hand" | "zoom" | "image" | "plus" | "pen" | "comment" | "brush" | "eraser" | "mask" | "group" | "lock" | "unlock" | "eye" | "eye-off" | "sound" | "sound-off" | "component" | "instance" | "panel-left" | "panel-right" | "arrow" | "search" | "settings" | "skills" | "new-chat" | "folder" | "trash" | "close" | "unlist" | "restore" | "dots" | "grid" | "list" | "copy" | "move-to" | "marker" | "sun" | "moon" | "home" | "feedback" | "fold" | "skill-auto-layout" | "skill-mobile-screens" | "skill-spacing" | "skill-type-scale" | "skill-contrast" | "skill-plain-words" | "skill-bold-blocks" | "skill-bento" | "skill-calm-and-trusted" | "skill-friendly-and-modern" | "skill-prototypes" | "skill-custom" | "plugin-connect";

const PATHS: Record<IconName, React.ReactNode> = {
  move: <path d="M5.5 3.5l13 6.3-5.7 1.8-1.8 5.9z" />,
  frame: <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />,
  rect: <rect x="4" y="5" width="16" height="14" rx="2.5" />,
  ellipse: <circle cx="12" cy="12" r="8" />,
  text: <path d="M5.5 7V5.5h13V7M12 5.5v13M9 18.5h6" />,
  group: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  "panel-left": (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M9.5 5v14" />
    </>
  ),
  "panel-right": (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M14.5 5v14" />
    </>
  ),
  component: <path d="M12 3.5l6 6-6 6-6-6zM12 15.5l3 3-3 3-3-3z" />,
  instance: <path d="M12 4.5l5.5 5.5-5.5 5.5L6.5 10z" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5" />
    </>
  ),
  "move-to": (
    <>
      <path d="M3.5 17.5v-11A1.5 1.5 0 015 5h4l2 2h8a1.5 1.5 0 011.5 1.5v2" />
      <path d="M3.5 17.5A1.5 1.5 0 005 19h7.5M14.5 16.5h6M17.5 13.5l3 3-3 3" />
    </>
  ),
  lock: (
    <>
      <rect x="6" y="11" width="12" height="8.5" rx="2" />
      <path d="M8.5 11V8.5a3.5 3.5 0 017 0V11" />
    </>
  ),
  unlock: (
    <>
      <rect x="6" y="11" width="12" height="8.5" rx="2" />
      <path d="M8.5 11V8.5a3.5 3.5 0 016.6-1.6" />
    </>
  ),
  pen: (
    <>
      <path d="M12 21l-6-9.5 2.5-8h7l2.5 8z" />
      <path d="M12 21v-8" />
      <circle cx="12" cy="10.8" r="1.6" />
    </>
  ),
  comment: <path d="M5.5 5h13a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5H11l-4.5 3.8V16H5.5A1.5 1.5 0 014 14.5v-8A1.5 1.5 0 015.5 5z" />,
  brush: (
    <>
      <path d="M12.5 8.5L19 2.9a1.5 1.5 0 012.1 2.1L15.5 11.5" />
      <path d="M12.5 8.5l3 3" />
      <path d="M12.5 8.5C10 8.5 8.5 10 8 12.5S6.5 16.5 3.5 17.5C6 20.5 11.5 20 14 17.5c1.2-1.2 1.5-3.2 1.5-6" />
    </>
  ),
  eraser: (
    <>
      <path d="M7 20h13" />
      <path d="M5.5 15.5l8-8a2 2 0 012.8 0l2.7 2.7a2 2 0 010 2.8l-6.5 6.5H7.5L5 17a1.1 1.1 0 01.5-1.5z" />
      <path d="M10.5 10.5l5.5 5.5" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4.5 17l4.5-4.5 3 3 2.5-2.5 5 5" />
    </>
  ),
  mask: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2.5" strokeDasharray="2.5 3" />
      <circle cx="12" cy="12" r="4.5" />
    </>
  ),
  zoom: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5l5 5M8 10.5h5M10.5 8v5" />
    </>
  ),
  hand: <path d="M8 12.5V6.5a1.5 1.5 0 013 0V11m0-1.5V5a1.5 1.5 0 013 0v6m0-3.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1.2a6 6 0 01-4.8-2.4L4.6 15a1.5 1.5 0 012.3-1.9L8 14.5" />,
  arrow: <path d="M10 8l4 4-4 4" />,
  fold: <path d="M12 7l-5 5 5 5M18 7l-5 5 5 5" />,
  eye: (
    <>
      <path d="M3 12c2.2-4 5.2-6 9-6s6.8 2 9 6c-2.2 4-5.2 6-9 6s-6.8-2-9-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M3 12c2.2 3 5.2 4.5 9 4.5s6.8-1.5 9-4.5" />
      <path d="M6.5 15l-1.5 2.2M12 16.5V19M17.5 15l1.5 2.2" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3l4.5-3.5v12L7 14.5H4z" />
      <path d="M15 9.5a3.5 3.5 0 010 5M17.5 7a7 7 0 010 10" />
    </>
  ),
  "sound-off": (
    <>
      <path d="M4 9.5h3l4.5-3.5v12L7 14.5H4z" />
      <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
    </>
  ),
  "cut-here": (
    <>
      <path d="M12 3.5v17" />
      <rect x="3.5" y="8.5" width="5.5" height="7" rx="1.5" />
      <rect x="15" y="8.5" width="5.5" height="7" rx="1.5" />
    </>
  ),
  "cut-close": (
    <>
      <rect x="3.5" y="8.5" width="5" height="7" rx="1.5" />
      <rect x="15.5" y="8.5" width="5" height="7" rx="1.5" />
      <path d="M13.5 12h-3M12 10.25 10.25 12 12 13.75" />
    </>
  ),
  "cut-before": (
    <>
      <path d="M10.5 3.5v17" />
      <rect x="10.5" y="8.5" width="10" height="7" rx="1.5" />
      <path d="M3.5 10l4 4M7.5 10l-4 4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.6" />
      <path d="M9.46 5.26L9.86 3.26A9 9 0 0 1 14.14 3.26L14.54 5.26A7.2 7.2 0 0 1 16.57 6.43L18.5 5.78A9 9 0 0 1 20.64 9.48L19.1 10.83A7.2 7.2 0 0 1 19.1 13.17L20.64 14.52A9 9 0 0 1 18.5 18.22L16.57 17.57A7.2 7.2 0 0 1 14.54 18.74L14.14 20.74A9 9 0 0 1 9.86 20.74L9.46 18.74A7.2 7.2 0 0 1 7.43 17.57L5.5 18.22A9 9 0 0 1 3.36 14.52L4.9 13.17A7.2 7.2 0 0 1 4.9 10.83L3.36 9.48A9 9 0 0 1 5.5 5.78L7.43 6.43A7.2 7.2 0 0 1 9.46 5.26z" />
    </>
  ),
  skills: <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />,
  "new-chat": <path d="M11 4.5H7.5a3 3 0 00-3 3v9a3 3 0 003 3h9a3 3 0 003-3V13M17.5 3.5l3 3-8 8-3.5.5.5-3.5z" />,
  folder: <path d="M3.5 7.5a2 2 0 012-2h4l2 2.5h7a2 2 0 012 2v7.5a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />,
  marker: <path d="M7 3.5v17M7 4.5h10.5l-2.2 3.2 2.2 3.3H7" />,
  trash: <path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v2M6.5 7l.8 11.2a2 2 0 002 1.8h5.4a2 2 0 002-1.8L17.5 7M10 11v5M14 11v5" />,
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4 6.5h.5M4 12h.5M4 17.5h.5" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  unlist: <path d="M5.5 7h13M5.5 12h8M5.5 17h13M16 12h4" />,
  restore: <path d="M4.5 12a7.5 7.5 0 107.5-7.5c-2.3 0-4.4 1-5.8 2.7M4.5 4.5v4h4" />,
  "cut-after": (
    <>
      <path d="M13.5 3.5v17" />
      <rect x="3.5" y="8.5" width="10" height="7" rx="1.5" />
      <path d="M16.5 10l4 4M20.5 10l-4 4" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </>
  ),
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M9.5 21v-6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6" />
    </>
  ),
  // a megaphone, so it is never taken for the chat
  feedback: (
    <>
      <path d="M3.5 10v4a1 1 0 0 0 1 1h3l9 4.5v-15l-9 4.5h-3a1 1 0 0 0-1 1z" />
      <path d="M7.5 15l1.5 5h2.5l-1.2-4" />
      <path d="M20 10v4" />
    </>
  ),
  "skill-auto-layout": (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <rect x="6.5" y="7.5" width="4.5" height="9" rx="1" />
      <rect x="13" y="7.5" width="4.5" height="9" rx="1" />
    </>
  ),
  "skill-mobile-screens": (
    <>
      <rect x="6.5" y="3.5" width="11" height="17" rx="2.5" />
      <path d="M10 6.5h4M10.5 17.5h3" />
    </>
  ),
  "skill-spacing": (
    <>
      <rect x="3.5" y="5.5" width="4" height="13" rx="1" />
      <rect x="16.5" y="5.5" width="4" height="13" rx="1" />
      <path d="M7.5 12h9M10 9.5L7.5 12 10 14.5M14 9.5l2.5 2.5-2.5 2.5" />
    </>
  ),
  "skill-type-scale": (
    <>
      <path d="M3.5 18l5-12 5 12M5.6 13.5h5.8" />
      <path d="M15.5 18l3-7.5 3 7.5M16.8 15h3.4" />
    </>
  ),
  "skill-contrast": (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16" />
      <path d="M12 4a8 8 0 010 16z" fill="currentColor" stroke="none" />
    </>
  ),
  "skill-plain-words": (
    <>
      <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2h-5.5L8 19.5V16H6a2 2 0 01-2-2z" />
      <path d="M8 8.5h8M8 12h5" />
    </>
  ),
  "skill-bold-blocks": (
    <>
      <rect x="4" y="4" width="11" height="11" rx="1.5" />
      <path d="M8.5 15v3.5a1.5 1.5 0 001.5 1.5h8.5a1.5 1.5 0 001.5-1.5V10a1.5 1.5 0 00-1.5-1.5H15" />
    </>
  ),
  "skill-bento": (
    <>
      <rect x="3.5" y="4" width="7.5" height="16" rx="1.5" />
      <rect x="13" y="4" width="7.5" height="7" rx="1.5" />
      <rect x="13" y="13" width="7.5" height="7" rx="1.5" />
    </>
  ),
  "skill-calm-and-trusted": (
    <>
      <path d="M12 3.5s6 2 6 7.5c0 5-4.5 8-6 9.5-1.5-1.5-6-4.5-6-9.5 0-5.5 6-7.5 6-7.5z" />
      <path d="M9.5 12l2 2 3.5-4" />
    </>
  ),
  "skill-friendly-and-modern": (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9 10.5v.5M15 10.5v.5" />
      <path d="M8.5 13.5a4.5 4.5 0 007 0" />
    </>
  ),
  "skill-prototypes": (
    <>
      <rect x="3.5" y="6" width="6" height="10" rx="1.5" />
      <rect x="14.5" y="8" width="6" height="10" rx="1.5" />
      <path d="M9.5 11h5M12.5 9l2 2-2 2" />
    </>
  ),
  "skill-custom": (
    <>
      <path d="M5.5 4.5h9a2 2 0 012 2V18a2 2 0 01-2 2h-9a2 2 0 01-2-2V6.5a2 2 0 012-2z" />
      <path d="M12 9l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" />
      <path d="M7.5 17h5" />
    </>
  ),
  "plugin-connect": (
    <>
      <path d="M10 14a4 4 0 005.66 0l2.83-2.83a4 4 0 00-5.66-5.66L11.5 6.85" />
      <path d="M14 10a4 4 0 00-5.66 0L5.5 12.83a4 4 0 005.66 5.66L12.5 17.15" />
    </>
  ),
};

export default function Icon({ name, size = 17, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
