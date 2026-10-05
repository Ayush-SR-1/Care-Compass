import hospitalData from '@/data/hospitals.json';

export type DepartmentId =
  | 'primary-care'
  | 'cardiology'
  | 'orthopedics'
  | 'womens-health'
  | 'pediatrics'
  | 'neurology'
  | 'dermatology'
  | 'gastroenterology'
  | 'ophthalmology'
  | 'pulmonology'
  | 'ent'
  | 'oncology'
  | 'imaging-diagnostics';

export interface NearbyHospital {
  id: string;
  name: string;
  type: 'hospital' | 'clinic';
  departments: DepartmentId[];
  emergency: boolean;
  address: string;
  phone: string | null;
  lat: number;
  lng: number;
  hours: string;
}

export interface NearbyPlace extends NearbyHospital {
  distanceKm: number;
  departmentMatch: boolean;
  source: 'osm' | 'sample';
  specialities: string[];
  servicesListed: boolean;
}

export interface NearbySearchOptions {
  emergencyOnly?: boolean;
}

export interface NearbyCareProvider {
  searchNearby(
    lat: number,
    lng: number,
    department: DepartmentId | 'all',
    radiusKm: number,
    options?: NearbySearchOptions,
  ): Promise<NearbyPlace[]>;
}

const hospitals = hospitalData as NearbyHospital[];

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lng2 - lng1);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

const DEPARTMENT_OSM_SPECIALITIES: Record<DepartmentId, string[]> = {
  'primary-care': ['general', 'internal', 'general_medicine', 'family_medicine', 'general_practice', 'general_practitioner'],
  'cardiology': ['cardiology', 'cardio', 'cardiovascular'],
  'orthopedics': ['orthopaedics', 'orthopedics', 'orthopaedic', 'orthopedic', 'trauma'],
  'dermatology': ['dermatology', 'skin', 'venereology'],
  'gastroenterology': ['gastroenterology', 'gastro', 'hepatology'],
  'ophthalmology': ['ophthalmology', 'eye', 'optometry'],
  'pulmonology': ['pulmonology', 'respiratory', 'chest', 'pulmonary'],
  'neurology': ['neurology', 'neuro', 'neurosurgery'],
  'womens-health': ['gynaecology', 'gynecology', 'obstetrics', 'gyn', 'obs', 'maternity'],
  'ent': ['otolaryngology', 'ent', 'ear_nose_throat', 'otorhinolaryngology'],
  'pediatrics': ['paediatrics', 'pediatrics', 'child', 'neonatology'],
  'oncology': ['oncology', 'cancer', 'radiation_oncology'],
  'imaging-diagnostics': ['radiology', 'imaging', 'diagnostics', 'diagnostic', 'x-ray', 'mri', 'ultrasound', 'scan'],
};

function matchesDepartmentSpecialities(dept: DepartmentId, specialities: string[]): boolean {
  const targetTokens = DEPARTMENT_OSM_SPECIALITIES[dept] || [];
  return specialities.some(s => {
    const normS = s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return targetTokens.some(token => {
      const normT = token.toLowerCase().replace(/[^a-z0-9]/g, '');
      return normS.includes(normT) || normT.includes(normS);
    });
  });
}

// SessionStorage cache helper (10 minutes expiry)
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCachedResults(cacheKey: string): NearbyPlace[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.timestamp === 'number' && Date.now() - parsed.timestamp < CACHE_TTL_MS) {
      return parsed.data as NearbyPlace[];
    }
    sessionStorage.removeItem(cacheKey);
  } catch {
    // Ignore cache error
  }
  return null;
}

function setCachedResults(cacheKey: string, data: NearbyPlace[]) {
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {
    // Ignore cache error
  }
}

async function fetchOverpassEndpoint(url: string, query: string, timeoutMs: number = 12000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Overpass HTTP error ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const overpassProvider: NearbyCareProvider = {
  async searchNearby(exactLat, exactLng, department, radiusKm, options = {}) {
    const roundedLat = Number(exactLat.toFixed(2));
    const roundedLng = Number(exactLng.toFixed(2));
    const queryRadiusMeters = Math.round(radiusKm * 1000 + 1500);

    const cacheKey = `nearby_osm_${roundedLat}_${roundedLng}_${radiusKm}_${department}_${Boolean(options?.emergencyOnly)}`;
    const cached = getCachedResults(cacheKey);
    if (cached) {
      // Recalculate distance against exact user lat/lng
      return cached
        .map(p => ({
          ...p,
          distanceKm: haversineDistanceKm(exactLat, exactLng, p.lat, p.lng),
        }))
        .filter(p => p.distanceKm <= radiusKm)
        .sort((a, b) => {
          if (options.emergencyOnly) {
            return Number(b.emergency) - Number(a.emergency) || a.distanceKm - b.distanceKm;
          }
          return Number(b.departmentMatch) - Number(a.departmentMatch) || a.distanceKm - b.distanceKm;
        })
        .slice(0, 10);
    }

    const query = `[out:json][timeout:20];
(
  nwr["amenity"="hospital"](around:${queryRadiusMeters},${roundedLat},${roundedLng});
  nwr["amenity"="clinic"](around:${queryRadiusMeters},${roundedLat},${roundedLng});
  nwr["healthcare"="hospital"](around:${queryRadiusMeters},${roundedLat},${roundedLng});
);
out center tags 80;`;

    let data: any;
    try {
      data = await fetchOverpassEndpoint('https://overpass-api.de/api/interpreter', query, 12000);
    } catch (primaryErr) {
      console.warn('[Overpass] Primary endpoint failed, trying fallback...', primaryErr);
      data = await fetchOverpassEndpoint('https://overpass.kumi.systems/api/interpreter', query, 12000);
    }

    if (!data || !Array.isArray(data.elements)) {
      throw new Error('Invalid Overpass response format');
    }

    const seenIds = new Set<string>();
    const places: NearbyPlace[] = [];

    for (const el of data.elements) {
      const tags = el.tags || {};
      const name = tags.name || tags['name:en'];
      if (!name) continue;

      const placeId = `osm-${el.type}-${el.id}`;
      if (seenIds.has(placeId)) continue;
      seenIds.add(placeId);

      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;

      const isHospital = tags.amenity === 'hospital' || tags.healthcare === 'hospital';
      const isEmergency = tags.emergency === 'yes';

      if (options.emergencyOnly && !isHospital) {
        continue;
      }

      const addressParts = [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:suburb'] || tags['addr:district'] || tags['addr:city'],
      ].filter(Boolean);
      const address = addressParts.length > 0 ? addressParts.join(', ') : 'Address not listed';

      const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || null;
      const hours = tags.opening_hours || 'Hours not listed';

      const rawSpecialities = tags['healthcare:speciality'] || tags['health_facility:speciality'] || '';
      const specialities = rawSpecialities
        ? rawSpecialities.split(';').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
        : [];
      const servicesListed = specialities.length > 0;

      const distanceKm = haversineDistanceKm(exactLat, exactLng, lat, lng);
      if (distanceKm > radiusKm) continue;

      const departmentMatch = department !== 'all' && servicesListed && matchesDepartmentSpecialities(department, specialities);

      places.push({
        id: placeId,
        name: name.trim(),
        type: isHospital ? 'hospital' : 'clinic',
        departments: department !== 'all' && departmentMatch ? [department] : [],
        emergency: isEmergency,
        address,
        phone,
        lat,
        lng,
        hours,
        distanceKm,
        departmentMatch,
        source: 'osm',
        specialities,
        servicesListed,
      });
    }

    places.sort((a, b) => {
      if (options.emergencyOnly) {
        return Number(b.emergency) - Number(a.emergency) || a.distanceKm - b.distanceKm;
      }
      return Number(b.departmentMatch) - Number(a.departmentMatch) || a.distanceKm - b.distanceKm;
    });

    const finalResults = places.slice(0, 10);
    setCachedResults(cacheKey, finalResults);
    return finalResults;
  },
};

const sampleDataProvider: NearbyCareProvider = {
  async searchNearby(lat, lng, department, radiusKm, options = {}) {
    return hospitals
      .filter((place) => {
        if (options.emergencyOnly) return place.type === 'hospital' && place.emergency;
        return department === 'all' || place.departments.includes(department);
      })
      .map((place) => {
        const distanceKm = haversineDistanceKm(lat, lng, place.lat, place.lng);
        return {
          ...place,
          distanceKm,
          departmentMatch:
            department !== 'all' && place.departments.includes(department),
          source: 'sample' as const,
          specialities: [],
          servicesListed: true,
        };
      })
      .filter((place) => place.distanceKm <= radiusKm)
      .sort(
        (a, b) =>
          Number(b.departmentMatch) - Number(a.departmentMatch) ||
          a.distanceKm - b.distanceKm,
      )
      .slice(0, 10);
  },
};

// Main entry point - tries live Overpass, falls back to sample provider
export async function searchNearby(
  lat: number,
  lng: number,
  department: DepartmentId | 'all',
  radiusKm: number,
  options?: NearbySearchOptions,
): Promise<NearbyPlace[]> {
  try {
    const liveResults = await overpassProvider.searchNearby(lat, lng, department, radiusKm, options);
    if (liveResults && liveResults.length > 0) {
      return liveResults;
    }
  } catch (err) {
    console.warn('[NearbyCare] Live Overpass provider failed, falling back to sample data:', err);
  }
  return sampleDataProvider.searchNearby(lat, lng, department, radiusKm, options);
}

export function getSampleHospitalCount(): number {
  return hospitals.length;
}
