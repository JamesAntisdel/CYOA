import type { JSX } from "react";

import type { ReaderLayoutVariant } from "../../../hooks/useReaderSettings";
import { BookLayout } from "./Book";
import { GraphicNovelLayout } from "./GraphicNovel";
import { JournalLayout } from "./Journal";
import { MobileLayout } from "./Mobile";
import { ModernAppLayout } from "./ModernApp";
import type { ReaderLayoutProps } from "./types";

export type { ReaderLayoutProps } from "./types";

/**
 * Lookup table from the persisted layout setting to the renderer. All five
 * layouts share the same props shape so the reader pipeline does not fork
 * per variant.
 */
export const READER_LAYOUTS: Record<ReaderLayoutVariant, (props: ReaderLayoutProps) => JSX.Element> = {
  book: BookLayout,
  modernApp: ModernAppLayout,
  graphicNovel: GraphicNovelLayout,
  journal: JournalLayout,
  mobile: MobileLayout,
};

export { BookLayout, GraphicNovelLayout, JournalLayout, MobileLayout, ModernAppLayout };
