import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Key(props: SvgIconProps) {
  return (
    <SvgIcon name="key" {...props}>
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
          svgEl("circle", { key: "a", cx: 7, cy: 12, r: 3.5 }),
          svgEl("path", { key: "b", d: "M10.5 12 h10 M16 12 v3 M19 12 v2.5" }),
          svgEl("circle", { key: "c", cx: 7, cy: 12, r: 1, fill: "currentColor" }),
        ],
      )}
    </SvgIcon>
  );
}
