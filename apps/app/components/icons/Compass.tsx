import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Compass(props: SvgIconProps) {
  return (
    <SvgIcon name="compass" {...props}>
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
          svgEl("circle", { key: "a", cx: 12, cy: 12, r: 9 }),
          svgEl("path", {
            key: "b",
            d: "M12 5 l2 7 l-2 7 l-2-7 z",
            fill: "currentColor",
            "fill-opacity": 0.15,
          }),
          svgEl("circle", { key: "c", cx: 12, cy: 12, r: 0.8, fill: "currentColor" }),
        ],
      )}
    </SvgIcon>
  );
}
