import { KIND_NAMES, kindGroups } from "../project/designExport";
import type { DesignKind } from "../project/designExport";

/** The one place a designer picks a file type for screens, grouped as Picture, Vector, Document (and Layered in Photo). */
export default function KindSelect({ value, photo, onChange }: { value: DesignKind; photo: boolean; onChange: (k: DesignKind) => void }) {
  return (
    <select data-name="export-kind" value={value} onChange={(e) => onChange(e.target.value as DesignKind)}>
      {kindGroups(photo).map((g) => (
        <optgroup key={g.name} label={g.name}>
          {g.kinds.map((k) => (
            <option key={k} value={k}>
              {k === "pdf" ? "PDF, all in one" : KIND_NAMES[k]}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
