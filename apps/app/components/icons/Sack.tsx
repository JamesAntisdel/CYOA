import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Sack(props: SvgIconProps) {
  return (
    <SvgIcon name="sack" {...props}>
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
            d: "M8 4 h8 l2.5 4 c1 9-2 13-6.5 13 c-4.5 0-7.5-4-6.5-13 z",
          }),
          svgEl("path", { key: "b", d: "M8 4 l1.5 3 h5 l1.5-3" }),
        ],
      )}
    </SvgIcon>
  );
}
