import type { Weather } from './care';

type OpenMeteo = {
  daily?: { time: string[]; precipitation_sum: (number | null)[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] };
  hourly?: { time: string[]; temperature_2m: (number | null)[] };
};

/** Turns an Open-Meteo response into the small shape the care logic uses. */
export function parseWeather(json: OpenMeteo, today: string): Weather | null {
  const d = json.daily;
  if (!d || !d.time?.length) return null;
  const days = d.time.map((date, i) => ({
    date,
    rain_mm: d.precipitation_sum[i] ?? 0,
    tmax: d.temperature_2m_max[i] ?? 0,
    tmin: d.temperature_2m_min[i] ?? 0,
  }));

  // Coldest hour from 18:00 today to 09:00 tomorrow.
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  let low: number | null = null;
  const h = json.hourly;
  if (h) {
    h.time.forEach((t, i) => {
      const v = h.temperature_2m[i];
      if (v === null || v === undefined) return;
      const inWindow = (t.startsWith(today) && t.slice(11, 13) >= '18') || (t.startsWith(tomorrow) && t.slice(11, 13) <= '09');
      if (inWindow && (low === null || v < low)) low = v;
    });
  }
  if (low === null) {
    const t = days.find((x) => x.date === tomorrow);
    low = t ? t.tmin : null;
  }
  return { days, lowTonight: low };
}

/** Weather for a point: the last two days and the next two. Cached for 30 minutes. Never throws. */
export async function getWeather(lat: number | null, lon: number | null, timezone: string, today: string): Promise<Weather | null> {
  if (lat === null || lon === null) return null;
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
    '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&hourly=temperature_2m' +
    `&past_days=2&forecast_days=3&timezone=${encodeURIComponent(timezone)}`;
  try {
    const res = await fetch(url, { next: { revalidate: 1800 }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return parseWeather((await res.json()) as OpenMeteo, today);
  } catch (err) {
    console.error('weather lookup failed', err);
    return null;
  }
}
