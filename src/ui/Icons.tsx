/** One icon set for the whole app: 24 grid, round ends, same stroke weight everywhere. */

export type IconName = "cut-here" | "cut-close" | "cut-before" | "cut-after" | "move" | "frame" | "rect" | "ellipse" | "text" | "hand" | "zoom" | "image" | "plus" | "pen" | "brush" | "eraser" | "mask" | "group" | "lock" | "unlock" | "eye" | "eye-off" | "sound" | "sound-off" | "component" | "instance" | "panel-left" | "panel-right" | "arrow" | "search" | "settings" | "skills" | "new-chat" | "folder" | "trash" | "close" | "unlist" | "restore" | "dots" | "grid" | "list" | "copy" | "move-to" | "marker";

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
      <path d="M3.5 20.5C5 16.5 5 12.5 6.5 10.5C8 8.5 10.5 8 12.5 6.5L17.5 11.5C16 13.5 15.5 16 13.5 17.5C11.5 19 7.5 19 3.5 20.5zM12.5 6.5L15 4c.6-.6 1.4-.6 2 0l3 3c.6.6.6 1.4 0 2l-2.5 2.5M3.5 20.5l5.76-5.76" />
      <circle cx="10.5" cy="13.5" r="1.75" />
    </>
  ),
  brush: (
    <>
      <path d="M18 4l2 2-6.5 6.5-2-2z" />
      <path d="M11.5 10.5l-2 2c-1.5 1.5-3 3-4.5 7.5 4.5-1.5 6-3 7.5-4.5l2-2" />
      <path d="M7.5 16.5c1-.8 1.8-.8 2.5-.8" />
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
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18" />
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
