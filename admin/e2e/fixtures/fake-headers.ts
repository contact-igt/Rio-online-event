// Minimal browser-safe stand-in for next/headers used by the offline staff-page fixtures.
export async function cookies() {
  return {
    get: () => undefined,
    set: () => {},
    delete: () => {},
  };
}

export async function headers() {
  return new Headers();
}
