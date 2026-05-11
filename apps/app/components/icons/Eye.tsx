import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Eye(props: SvgIconProps) {
  return (
    <SvgIcon name="eye" {...props}>
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
          svgEl("path", { key: "a", d: "M2 12 c4-6 14-6 18 0 c-4 6-14 6-18 0 z" }),
          svgEl("circle", { key: "b", cx: 12, cy: 12, r: 3 }),
          svgEl("circle", { key: "c", cx: 12, cy: 12, r: 1, fill: "currentColor" }),
        ],
      )}
    </SvgIcon>
  );
}
