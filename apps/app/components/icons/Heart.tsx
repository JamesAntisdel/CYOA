import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Heart(props: SvgIconProps) {
  return (
    <SvgIcon name="heart" {...props}>
      {svgEl("path", {
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 1.5,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        d: "M12 20 c-7-4.5-9-8-9-12 c0-2.8 2.2-4.5 4.5-4.5 c2 0 3.5 1.2 4.5 3 c1-1.8 2.5-3 4.5-3 c2.3 0 4.5 1.7 4.5 4.5 c0 4-2 7.5-9 12 z",
      })}
    </SvgIcon>
  );
}
