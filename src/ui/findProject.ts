/** Asked from the menu: go to the projects list with the cursor in its find box. Kept until the list is there to take it. */
let wanted = false;

export function askToFindProject() {
  wanted = true;
  window.dispatchEvent(new Event("duet:find-project"));
}

/** True once after the find box was asked for. */
export function takeFindProject(): boolean {
  const was = wanted;
  wanted = false;
  return was;
}
