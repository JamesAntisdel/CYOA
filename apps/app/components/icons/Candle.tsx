import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Candle(props: SvgIconProps) {
  return (
    <SvgIcon name="candle" {...props}>
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
            d: "M12 3 c1 1.6 1 3 0 4 c-1-1-1-2.4 0-4 z",
            fill: "currentColor",
          }),
          svgEl("path", { key: "b", d: "M12 7 v3" }),
          svgEl("rect", { key: "c", x: 9, y: 10, width: 6, height: 9, rx: 0.5 }),
          svgEl("path", { key: "d", d: "M8 19 h8" }),
          svgEl("path", { key: "e", d: "M9.5 13 v3", opacity: 0.4 }),
        ],
      )}
    </SvgIcon>
  );
}
