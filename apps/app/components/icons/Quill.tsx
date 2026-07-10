import { SvgIcon, SvgIconProps, svgEl } from "./SvgIcon";

export function Quill(props: SvgIconProps) {
  return (
    <SvgIcon name="quill" {...props}>
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
            d: "M3 21 c2-8 8-15 18-18 c-2 9-9 16-18 18 z",
          }),
          svgEl("path", { key: "b", d: "M3 21 l8-8" }),
          svgEl("path", { key: "c", d: "M14 5 c-2 1-4 3-6 6", opacity: 0.5 }),
        ],
      )}
    </SvgIcon>
  );
}
