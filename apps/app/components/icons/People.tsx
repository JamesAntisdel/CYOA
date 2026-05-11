import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function People(props: SvgIconProps) {
  return (
    <SvgIcon name="people" {...props}>
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
          svgEl("circle", { key: "a", cx: 9, cy: 9, r: 3 }),
          svgEl("path", { key: "b", d: "M3 20 c0-4 3-6 6-6 c3 0 6 2 6 6" }),
          svgEl("circle", { key: "c", cx: 17, cy: 10, r: 2.2 }),
          svgEl("path", { key: "d", d: "M15 20 c0-3 1.5-4.5 3.5-4.5 c2 0 3.5 1.5 3.5 4.5" }),
        ],
      )}
    </SvgIcon>
  );
}
