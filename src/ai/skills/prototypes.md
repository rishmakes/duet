# Prototypes
Connect screens so a design can be clicked through like the real app or website.

- A prototype is screens joined by connections. Set them with set_props on the thing that is clicked: link (the screen's id), linkKind (empty to go there, overlay to open it on top, back to go back), trigger (empty for on click, hover for while the pointer is over it), transition and transitionMs.
- Put the connection on the whole button or card, not on the text inside it, so the whole thing can be clicked.
- Every screen needs a way in and a way out. Give each inner screen a back button or a way home.
- Menus, popups, sheets and dialogs are their own small frames, opened with overlay. A dropdown on a desktop site opens on hover.
- Movement says where you are going: push-left for the next step, push-right for back, push-up for a sheet, dissolve for a tab or a page that replaces the last.
- Tall pages set scroll: true on the screen, so they scroll in Present.
- Read get_prototype before you start and again when you are done. Fix every screen in notReached and every dead end that should lead somewhere.
- Building the real thing from a design: get_prototype is the plan of pages and links, get_outline and get_document hold every size, colour and word.
