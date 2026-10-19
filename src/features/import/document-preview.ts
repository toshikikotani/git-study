import type { Box } from './document-detect';

type Size = { width: number; height: number };

/** Centered object-fit: cover coordinates, expressed as CSS percentages of the preview. */
export function projectDocumentBox(
  box: Box,
  video: Size,
  viewport: Size,
): { left: number; top: number; width: number; height: number } | null {
  if (
    ![video.width, video.height, viewport.width, viewport.height].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    ![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) ||
    box.x1 <= box.x0 ||
    box.y1 <= box.y0
  ) {
    return null;
  }

  const scale = Math.max(viewport.width / video.width, viewport.height / video.height);
  const renderedWidth = video.width * scale;
  const renderedHeight = video.height * scale;
  if (!Number.isFinite(renderedWidth) || !Number.isFinite(renderedHeight)) return null;

  const offsetX = (viewport.width - renderedWidth) / 2;
  const offsetY = (viewport.height - renderedHeight) / 2;
  const left = Math.max(0, box.x0 * renderedWidth + offsetX);
  const top = Math.max(0, box.y0 * renderedHeight + offsetY);
  const right = Math.min(viewport.width, box.x1 * renderedWidth + offsetX);
  const bottom = Math.min(viewport.height, box.y1 * renderedHeight + offsetY);
  if (right <= left || bottom <= top) return null;

  return {
    left: (left / viewport.width) * 100,
    top: (top / viewport.height) * 100,
    width: ((right - left) / viewport.width) * 100,
    height: ((bottom - top) / viewport.height) * 100,
  };
}
