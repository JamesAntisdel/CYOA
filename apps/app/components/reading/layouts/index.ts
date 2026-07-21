import type { JSX } from "react";

import type { ReaderLayoutVariant } from "../../../hooks/useReaderSettings";
import { BookLayout } from "./Book";
import { GraphicNovelLayout } from "./GraphicNovel";
import { IllustratedBookLayout } from "./IllustratedBook";
import { JournalLayout } from "./Journal";
import { MobileLayout } from "./Mobile";
import { ModernAppLayout } from "./ModernApp";
import type { ReaderLayoutProps } from "./types";

export type { ReaderLayoutProps } from "./types";

/**
 * Lookup table from the persisted layout setting to the renderer. Every
 * layout shares the same props shape so the reader pipeline does not fork
 * per variant — `IllustratedBook` (reading-modes R3) consumes the IDENTICAL
 * `ReaderLayoutProps` as the five cosmetic skins.
 */
export const READER_LAYOUTS: Record<ReaderLayoutVariant, (props: ReaderLayoutProps) => JSX.Element> = {
  book: BookLayout,
  modernApp: ModernAppLayout,
  graphicNovel: GraphicNovelLayout,
  journal: JournalLayout,
  mobile: MobileLayout,
  illustratedBook: IllustratedBookLayout,
};

export { BookLayout, GraphicNovelLayout, IllustratedBookLayout, JournalLayout, MobileLayout, ModernAppLayout };
