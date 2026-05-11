import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Skull(props: SvgIconProps) {
  return (
    <SvgIcon name="skull" {...props}>
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
            d: "M5 11 c0-5 3-8 7-8 c4 0 7 3 7 8 v4 h-2 v3 h-3 v-2 h-4 v2 h-3 v-3 h-2 z",
          }),
          svgEl("circle", { key: "b", cx: 9, cy: 12, r: 1.4, fill: "currentColor" }),
          svgEl("circle", { key: "c", cx: 15, cy: 12, r: 1.4, fill: "currentColor" }),
          svgEl("path", { key: "d", d: "M11 16 l1-1 l1 1" }),
        ],
      )}
    </SvgIcon>
  );
}
