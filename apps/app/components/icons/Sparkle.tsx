import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Sparkle(props: SvgIconProps) {
  return (
    <SvgIcon name="sparkle" {...props}>
      {svgEl("path", {
        fill: "currentColor",
        "fill-opacity": 0.2,
        stroke: "currentColor",
        "stroke-width": 1.5,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        d: "M12 3 l1.5 6.5 l6.5 1.5 l-6.5 1.5 l-1.5 6.5 l-1.5-6.5 l-6.5-1.5 l6.5-1.5 z",
      })}
    </SvgIcon>
  );
}
