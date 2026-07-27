import * as Location from "expo-location";
import { supabase } from "./supabase";

// Location privacy: we NEVER store coordinates. The device reduces its
// position to a ~1.2km geohash cell (precision 6) and only that cell string
// leaves the phone. Distance is computed server-side as coarse bands.
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohashEncode(lat: number, lon: number, precision = 6): string {
  let idx = 0, bit = 0, evenBit = true, hash = "";
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { idx = idx * 2 + 1; lonMin = mid; } else { idx = idx * 2; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid; } else { idx = idx * 2; latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

/** Ask permission, read a coarse fix, store only the geohash cell. Silent no-op on denial. */
export async function updateGeoCell(userId: string): Promise<void> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    const cell = geohashEncode(loc.coords.latitude, loc.coords.longitude, 6);
    await supabase.from("profiles").update({ geo_cell: cell }).eq("id", userId);
  } catch {
    // location unavailable — distance simply won't show
  }
}
