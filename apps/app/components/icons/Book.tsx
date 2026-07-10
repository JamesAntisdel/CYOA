import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Book(props: SvgIconProps) {
  return (
    <SvgIcon name="book" {...props}>
      {svgEl(
        "g",
        {
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 1.5,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
        [
          svgEl("path", {
            key: "a",
            d: "M3 5 c2.5-1 5.5-1 9 0 c3.5-1 6.5-1 9 0 v14 c-2.5-1-5.5-1-9 0 c-3.5-1-6.5-1-9 0 z",
          }),
          svgEl("path", { key: "b", d: "M12 5 v14" }),
          svgEl("path", { key: "c", d: "M6 8 c1.5-0.4 3-0.4 4.5 0", opacity: 0.5 }),
          svgEl("path", { key: "d", d: "M13.5 8 c1.5-0.4 3-0.4 4.5 0", opacity: 0.5 }),
        ],
      )}
    </SvgIcon>
  );
}
