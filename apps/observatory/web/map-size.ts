export function observeMapSize(container: HTMLElement, invalidate: () => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  let observing = true;
  const observer = new ResizeObserver(() => {
    if (observing && container.clientWidth > 0 && container.clientHeight > 0) invalidate();
  });
  observer.observe(container);
  return () => {
    observing = false;
    observer.disconnect();
  };
}
