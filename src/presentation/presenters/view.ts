/** JSON-compatible value produced by presenters and consumed by every delivery mechanism. */
export type View = null | boolean | number | string | View[] | { [key: string]: View };

/**
 * Presents an application-service result as a plain view model: value objects collapse to their primitive form
 * (`toJSON`), dates become ISO-8601 strings, `undefined` fields disappear.
 */
export function toView(result: unknown): View {
  if (result === undefined) return null;
  return JSON.parse(JSON.stringify(result)) as View;
}

export function isRecord(view: View): view is { [key: string]: View } {
  return view !== null && typeof view === 'object' && !Array.isArray(view);
}
