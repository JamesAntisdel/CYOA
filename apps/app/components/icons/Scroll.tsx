import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Scroll(props: SvgIconProps) {
  return (
    <SvgIcon name="scroll" {...props}>
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
            d: "M5 4 h12 c1.5 0 2.5 1.2 2.5 2.5 v11 c0 1.5-1 2.5-2.5 2.5 h-12 c1.5 0 2.5-1 2.5-2.5 v-11 c0-1.3-1-2.5-2.5-2.5 z",
          }),
          svgEl("path", { key: "b", d: "M9 9 h7 M9 12 h7 M9 15 h5", opacity: 0.5 }),
        ],
      )}
    </SvgIcon>
  );
}
