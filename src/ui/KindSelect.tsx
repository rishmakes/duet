import { KIND_NAMES, kindGroups } from "../project/designExport";
import type { DesignKind } from "../project/designExport";
import Choose from "./Choose";

/** What each file type is good for, in a few words. */
const HINTS: Record<DesignKind, string> = {
  png: "Sharp, can be see-through",
  jpg: "Small, for photos",
  svg: "Sharp at any size",
  pdf: "Every screen in one file",
  psd: "Keeps the layers",
};

/** The one place a designer picks a file type for screens, grouped as Picture, Vector, Document (and Layered in Photo). */
export default function KindSelect({ value, photo, onChange }: { value: DesignKind; photo: boolean; onChange: (k: DesignKind) => void }) {
  const groups = kindGroups(photo).map((g) => ({ name: g.name, options: g.kinds.map((k) => ({ value: k, label: KIND_NAMES[k], hint: HINTS[k] })) }));
  return <Choose name="export-kind" value={value} groups={groups} onChange={onChange} />;
}
