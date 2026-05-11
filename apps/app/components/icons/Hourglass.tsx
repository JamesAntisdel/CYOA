import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Hourglass(props: SvgIconProps) {
  return (
    <SvgIcon name="hourglass" {...props}>
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
            d: "M6 3 h12 v3 c0 3-3 4.5-3 6 c0 1.5 3 3 3 6 v3 h-12 v-3 c0-3 3-4.5 3-6 c0-1.5-3-3-3-6 z",
          }),
          svgEl("path", { key: "b", d: "M9 7 h6", opacity: 0.5 }),
          svgEl("path", { key: "c", d: "M9 17 h6", opacity: 0.5 }),
        ],
      )}
    </SvgIcon>
  );
}
