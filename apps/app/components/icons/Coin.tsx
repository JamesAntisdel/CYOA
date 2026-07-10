import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Coin(props: SvgIconProps) {
  return (
    <SvgIcon name="coin" {...props}>
      {svgEl("g", { fill: "none", stroke: "currentColor", "stroke-width": 1.5 }, [
        svgEl("circle", { key: "a", cx: 12, cy: 12, r: 8.5 }),
        svgEl("circle", { key: "b", cx: 12, cy: 12, r: 6, opacity: 0.4 }),
      ])}
      {svgEl(
        "text",
        {
          x: 12,
          y: 15.5,
          "text-anchor": "middle",
          "font-size": 9,
          "font-family": "Special Elite, monospace",
          fill: "currentColor",
        },
        "¤",
      )}
    </SvgIcon>
  );
}
