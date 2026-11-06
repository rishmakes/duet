import { useRef } from "react";
import ChatPanel from "./ChatPanel";
import { PANEL_CHAT_MIN, getLayout, setLayout, useLayout } from "./layout";

/** The chat under the right panel in Studio. The line above it is pulled up or down to share the room with the panel. */
export default function PanelChat() {
  const h = useLayout((d) => d.panelChatH);
  const box = useRef<HTMLElement>(null);
  const grab = (e: React.PointerEvent) => {
    e.preventDefault();
    const stack = box.current?.parentElement;
    if (!stack) return;
    const startY = e.clientY;
    const startH = getLayout().panelChatH;
    // the panel above keeps at least a little room
    const most = Math.max(PANEL_CHAT_MIN, stack.clientHeight - 120);
    const move = (ev: PointerEvent) => setLayout({ panelChatH: Math.round(Math.min(most, Math.max(PANEL_CHAT_MIN, startH + startY - ev.clientY))) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <section className="panel-chat" ref={box} style={{ height: h }}>
      <div className="panel-chat-grip" title="Pull to make the chat taller or shorter" onPointerDown={grab} onDoubleClick={() => setLayout({ panelChatH: 360 })} />
      <ChatPanel docked />
    </section>
  );
}
