export interface Place {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export function addressWith(params: URLSearchParams, place: Place = location): string {
  const query = params.toString();
  return `${place.pathname}${query ? `?${query}` : ""}${place.hash}`;
}

export function currentAddress(place: Place = location): string {
  return `${place.pathname}${place.search}${place.hash}`;
}
