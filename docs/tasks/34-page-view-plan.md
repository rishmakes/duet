# Task 34: Page View Implementation Plan (#250)

Plan for introducing **Page View** in Studio (Design & Photo spaces). Sized projects created from Home (Instagram post, story, thumbnail, presentation, A4, custom) open as focused single pages fitted to the screen without free panning, accompanied by a bottom page strip for thumbnail navigation, page creation, and drag-and-drop reordering. Open canvas and App screens projects preserve the infinite 2D canvas.

---

## 1. How a project is marked as 'pages' (and whether that touches the file format)

### Zero file format changes
- **Does NOT touch the file format**: Duet's `.duet` file format (`Doc`, `serializeDoc`, `parseDoc` in `src/document/serialize.ts`) remains **100% untouched**.
- **Helper agent compliance**: Preserves the rule in `AGENTS.md` forbidding modifications to `src/document/serialize.ts` and `src/project/`.
- **Presentation preference, not geometry**: Whether a project displays as a single fitted page or an infinite canvas is an editor view mode, identical to how Design vs Video vs Photo modes are saved.

### How it is determined and stored
1. **Creation source decides default**:
   - Creating from Home sized templates (Instagram post, story, YouTube thumbnail, slide, A4, or custom dimensions) marks the project view mode as `"pages"`.
   - Creating from "Open canvas" or "App screens" marks the project view mode as `"canvas"`.
2. **Persistence per project**:
   - Stored in browser storage (`localStorage` / `sessionStorage`) keyed by project path or live untitled tab key, matching how `src/ui/layout.ts` already persists project modes (`duet:modes`).
   - Managed in `src/ui/layout.ts` via helper functions `pageViewOf(path)` and `keepPageView(path, viewMode)`.
   - Remembers the designer's last view mode per project across sessions.

---

## 2. How a page maps to a frame

1. **Frames are the pages**:
   - In Duet's flat JSON document model (`Doc.elements`), there is no separate `"page"` element type.
   - Every top-level frame in `doc.rootIds` (`doc.elements[id]?.type === "frame"`) functions as a page.
   - The frame's `name` property (`el.name`) provides the page title (e.g., "Page 1: Title Cover").
   - Child elements (`el.childIds`) are the contents of that page.
2. **Page order matches `doc.rootIds`**:
   - The sequence of thumbnails in the bottom page strip strictly reflects the order of frame IDs in `doc.rootIds`.
   - Reordering pages in the strip alters the order of root IDs in `doc.rootIds`.
3. **Underlying spatial canvas layout**:
   - While Page View displays only one frame at a time, frames remain positioned on the 2D canvas in a neat left-to-right row with standard spacing (e.g. `x = (width + 40) * index`, `y = 0`), exactly as shown in Mockup Frame 4.
   - When switching to Whole Canvas view, all pages sit side-by-side in visual reading order without collisions or overlaps.

---

## 3. How add/reorder go through `src/commands` with tests

Every document mutation is a pure command in `src/commands/` returning a fresh immutable `Doc`, thoroughly tested in `src/commands/pages.test.ts`.

### 1. `add_page`
- **Command Definition**: Added in `src/commands/pages.ts` and registered in `src/commands/index.ts`.
- **Arguments**:
  ```ts
  export interface AddPageArgs {
    sourceId?: string; // frame to copy dimensions and fill from (defaults to active page)
    afterId?: string;  // root frame to insert after (defaults to end or after sourceId)
    width?: number;
    height?: number;
    name?: string;
    id?: string;
  }
  ```
- **Behavior**:
  - Derives `width`, `height`, and `fill` from `sourceId` if not explicitly provided.
  - Determines spatial coordinates: places the new frame to the right of all existing root frames (`x = maxX + 40`, `y = 0`) to prevent canvas overlap.
  - Inserts the new frame ID into `doc.rootIds` immediately following `afterId` (or at the end).
  - Returns a new immutable `Doc`.
- **Tests in `src/commands/pages.test.ts`**:
  - `add_page` to empty doc creates initial frame.
  - `add_page` inherits dimensions from `sourceId`.
  - `add_page` inserts at correct index in `rootIds`.
  - `add_page` positions frame to the right without overlapping existing frames.
  - Pure function test: verifies input `doc` is never mutated.

### 2. `reorder_pages`
- **Command Definition**: Added in `src/commands/pages.ts` and registered in `src/commands/index.ts`.
- **Arguments**:
  ```ts
  export interface ReorderPagesArgs {
    id: string;        // frame ID being moved
    toIndex: number;   // destination index in root frames
    reflow?: boolean;  // whether to re-sequence x positions along the row (default: true)
  }
  ```
- **Behavior**:
  - Validates `id` exists in `doc.rootIds`.
  - Splices `id` from its current position in `doc.rootIds` and inserts it at `toIndex`.
  - When `reflow: true`: updates the `x` coordinates of root frames along the horizontal row so canvas order matches the new strip order.
  - Leaves child elements intact.
- **Tests in `src/commands/pages.test.ts`**:
  - Moves first page to end of `rootIds`.
  - Moves last page to beginning of `rootIds`.
  - Correctly reflows horizontal `x` positions when `reflow: true`.
  - Preserves custom positions when `reflow: false`.
  - Safely ignores invalid IDs or out-of-bounds indices.

### 3. `duplicate_page`
- **Arguments**: `{ sourceId: string; newId?: string }`
- **Behavior**: Deep-clones the frame and all descendant elements with new unique IDs, places the new frame adjacent to the source, and inserts it immediately after `sourceId` in `doc.rootIds`.
- **Tests**: Validates full deep-copy of nested children, ID mapping, and placement.

### 4. `delete_page`
- **Arguments**: `{ id: string }`
- **Behavior**: Removes the frame and recursively deletes all its child elements. If only 1 page remains, deletion is prevented or leaves a fresh blank page.
- **Tests**: Validates recursive cleanup of child elements and single-page guard.

---

## 4. How the user gets back to the whole canvas

Following Rish's decision on #250 (1 Nov 2026):
1. **Dedicated view switcher**:
   - Positioned in Studio header or canvas top bar (as shown in Mockups 3 & 4).
   - Label: `[Pages | Canvas]` or `[Focus | Canvas]` or a dedicated button `"Whole canvas"` / `"Page view"`.
   - Avoids "Pages" terminology collision with future document-level pages (#251).
2. **View transitions**:
   - **Switching to Whole Canvas**:
     - Clears single-frame isolation (`setOnlyFrame(null)`).
     - Restores canvas panning and zooming.
     - Glides smoothly out to show all pages on the dot grid (`zoomToFit`).
   - **Returning to Page View**:
     - Clicking any thumbnail in the bottom page strip, or clicking a frame in Whole Canvas and hitting the focus button, re-enters Page View.
     - Isolates that frame via `setOnlyFrame(pageId)`.
     - Calls `zoomToElements([pageId])` to fit the page to the viewport.
     - Saves previous canvas viewport in `before.current` ref to restore when returning to canvas.
3. **Paging navigation without canvas zoom**:
   - `< Page 1 of 5 >` arrows in the top bar.
   - Keyboard shortcuts (Page Up / Page Down or Option+Left / Option+Right).
   - Clicking numbered thumbnails in the bottom page strip.

---

## 5. Reusing #135 Motion focus and Agent focus

The core rendering and viewport mechanics for page isolation already exist in Duet:
1. **Rendering isolation in `src/canvas/render.ts`**:
   - `render.ts` already exports `setOnlyFrame(id)` and uses `alone(doc)`.
   - When `setOnlyFrame(activePageId)` is called:
     - `shownRoots(doc)` returns `[activePageId]`.
     - `shownOn(doc, id)` returns `true` only for `activePageId` and its descendants.
     - Elements outside the active frame are never drawn, never hit-tested, and never snap.
2. **Panning lock in `src/canvas/CanvasView.tsx`**:
   - Reuses the `lockedRef` pattern introduced in commit `35b5360` for Motion scenes:
     `lockedRef.current = (motion && !!scene) || (designing && viewMode === "pages" && !!activePage);`
   - In `onWheel`: disables wheel-based panning while locked.
   - In pointer events: spacebar drag and hand-tool panning are disabled while locked.
3. **Auto-fit on window resize**:
   - In `CanvasView.tsx` `ResizeObserver`: when locked, window resizing triggers `zoomToElements([activePage], w, h)`.
4. **Viewport restore on return**:
   - In `CanvasView.tsx`: `before.current` caches the open canvas viewport before entering Page View, and glides back to it on exit.

---

## 6. Canva-style page editor best practices worth copying in behaviour

1. **Auto-fit page centering with gutter clearance**: The active page always centers in the available viewport above the floating page strip, keeping margins balanced during window resizes.
2. **No accidental canvas loss**: Panning into empty space is completely prevented; users on laptop trackpads never get lost.
3. **Visual reorder slot preview**: Dragging a thumbnail shows a crisp vertical insertion marker between cards, making drop placement deterministic.
4. **Synchronized 2D canvas reflow**: Reordering in the strip re-sequences frames horizontally on the canvas, keeping spatial layout coherent.
5. **Contextual "+ Add page"**: Adding a page immediately adopts the active page's dimensions and background fill, placing it next in sequence and switching focus to it.
6. **One-click page duplicate**: Each thumbnail card provides a quick duplicate action for building multi-slide variations effortlessly.
7. **Scoped selection**: Selection is restricted to the active page; clicking outside does not de-focus the page.
8. **Direct keyboard page turning**: Page Up / Page Down or arrow keys cycle pages smoothly without touching the mouse.
9. **Single-page deletion guard**: Prevents accidental deletion of the last remaining page in a document.
10. **One-time canvas hint**: A gentle, dismissible hint near the page strip: *"Switch to Canvas to see all your pages side by side."*

---

## 7. Which files change and why

| File | Change | Why |
| :--- | :--- | :--- |
| `src/commands/pages.ts` | **New file** | Pure commands: `addPage`, `reorderPages`, `duplicatePage`, `deletePage`. |
| `src/commands/pages.test.ts` | **New file** | Unit tests for page commands verifying immutability, insertion order, reflow, and child handling. |
| `src/commands/index.ts` | **Modify** | Register `add_page`, `reorder_pages`, `duplicate_page`, `delete_page` in the command registry. |
| `src/ui/layout.ts` | **Modify** | Add `viewMode: "pages" \| "canvas"` to `Dock`; add `pageViewOf` and `keepPageView` localStorage persistence helpers. |
| `src/ui/layout.test.ts` | **Modify** | Unit tests for view mode layout state and persistence. |
| `src/ui/Home.tsx` | **Modify** | Set `viewMode: "pages"` for sized/custom templates; set `viewMode: "canvas"` for "Open canvas" / "App screens". |
| `src/canvas/CanvasView.tsx` | **Modify** | In Page View: activate `setOnlyFrame`, lock panning (`lockedRef`), auto-fit active page, and handle canvas return. |
| `src/ui/PageStrip.tsx` | **New file** | Floating bottom page strip: thumbnails, page numbers, drag-reorder, + Add page, duplicate/delete. |
| `src/ui/Toolbar.tsx` / `CanvasControls.tsx` | **Modify** | Add dedicated view switcher button (`Pages` / `Canvas` or focus toggle) in Studio header. |
| `src/styles.css` | **Modify** | Styling for `.page-strip-container`, `.page-thumbnail-item`, `.page-mini-card`, and view toggle in both light and dark themes. |

> [!NOTE]
> `src-tauri/`, `src/project/`, `src/memory/`, `src/state/`, and `src/document/serialize.ts` are **NOT** modified, strictly adhering to helper agent rules.

---

## 8. Risks and mitigation strategies

1. **Risk: Panning drift on trackpads**
   - *Mitigation*: Strictly disable wheel pan and spacebar pan in `CanvasView.tsx` when `lockedRef` is active.
2. **Risk: Canvas overlap vs manual placement conflicts**
   - *Mitigation*: The `reorder_pages` command only reflows horizontal positions when pages are arranged in a horizontal row (`reflow: true`).
3. **Risk: Thumbnail rendering overhead with 20+ pages**
   - *Mitigation*: Mini-thumbnails use lightweight SVG markup or CSS scaled views; off-screen thumbnails in long strips are virtualized/scroll-contained.
4. **Risk: Selection/Page desynchronization**
   - *Mitigation*: Whenever an element is selected, resolve its root page frame via `pageFrame(doc, selectedId)` and sync the active page strip indicator.
5. **Risk: File format compatibility**
   - *Mitigation*: View mode is stored strictly in `layout.ts` (`localStorage`), leaving `.duet` files untouched.

---

## 9. Numbered build order in small steps

1. **Step 1: Pure commands & tests**
   - Create `src/commands/pages.ts` (`addPage`, `reorderPages`, `duplicatePage`, `deletePage`).
   - Register in `src/commands/index.ts`.
   - Write comprehensive unit tests in `src/commands/pages.test.ts`. Run `npm test src/commands/pages.test.ts`.
2. **Step 2: View mode state in `layout.ts`**
   - Add `viewMode: "pages" | "canvas"` to `Dock` in `src/ui/layout.ts`.
   - Add `pageViewOf(path)` and `keepPageView(path, mode)` with `localStorage` persistence.
   - Update `src/ui/layout.test.ts`.
3. **Step 3: Canvas isolation & pan lock**
   - In `src/canvas/CanvasView.tsx`, wire `viewMode === "pages"` to `setOnlyFrame(activePageId)` and `lockedRef`.
   - Verify auto-fitting on window resize and disabled spacebar/wheel panning.
4. **Step 4: Bottom page strip component**
   - Implement `src/ui/PageStrip.tsx` with thumbnail rendering, page numbers, and active indicator.
   - Connect "+ Add page" button to `add_page` command.
   - Implement drag-and-drop reordering with live slot preview, calling `reorder_pages`.
5. **Step 5: View toggle in Studio**
   - Add dedicated view switcher in Studio top bar/canvas controls to toggle between Page View and Whole Canvas.
   - Add `< Page X of Y >` arrow controls.
6. **Step 6: Home integration**
   - In `src/ui/Home.tsx`, set `viewMode: "pages"` on sized templates (post, story, thumbnail, slide, A4, custom).
   - Set `viewMode: "canvas"` on "Open canvas" and "App screens".
7. **Step 7: Styling & theme polish**
   - Add CSS in `src/styles.css` using theme variables (`--panel`, `--line`, `--muted`, `--accent`) for both light and dark looks.
8. **Step 8: End-to-end verification**
   - Run `npm test`, `npx tsc --noEmit`. Verify all tests pass.
