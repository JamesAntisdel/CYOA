import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Crown(props: SvgIconProps) {
  return (
    <SvgIcon name="crown" {...props}>
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
            d: "M3 8 l3 9 h12 l3-9 l-4 3 l-2-6 l-3 5 l-3-5 l-2 6 z",
          }),
          svgEl("path", { key: "b", d: "M6 17 h12" }),
        ],
      )}
    </SvgIcon>
  );
}
