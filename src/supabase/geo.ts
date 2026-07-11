export async function detectCountry(): Promise<string | null> {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.country_code === 'string' && data.country_code.length === 2 ? data.country_code : null;
  } catch {
    return null;
  }
}
