import Icon from "./Icons";
import { toggleFavourite, useFavourites } from "./favourites";

/** The star in a tile's corner: it puts the thing on the Favourites shelf, or takes it off (#338). */
export default function Star({ fave, name }: { fave: string; name: string }) {
  const on = useFavourites().includes(fave);
  return (
    <button
      type="button"
      className={`tile-star${on ? " on" : ""}`}
      data-name="tile-star"
      aria-pressed={on}
      title={on ? `Take ${name} out of Favourites` : `Add ${name} to Favourites`}
      onClick={(e) => {
        e.stopPropagation();
        toggleFavourite(fave);
      }}
    >
      <Icon name="star" size={13} />
    </button>
  );
}
