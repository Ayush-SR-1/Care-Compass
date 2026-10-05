import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import { AlertTriangle, ArrowUpRight, Building2, Check, Clock3, Crosshair, MapPin, Navigation, Phone, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import { searchNearby, type DepartmentId, type NearbyPlace } from '@/lib/nearby-care';
import 'leaflet/dist/leaflet.css';
import './nearby-care.css';

type DepartmentChoice = DepartmentId | 'all';
type Coordinates = { lat: number; lng: number };

export interface NearbyCareProps {
  departments: { id: DepartmentId; name: string }[];
  initialDepartmentId?: DepartmentChoice;
  emergency?: boolean;
  expandedByDefault?: boolean;
  onAddToChecklist(label: string): void;
}

interface CityArea {
  city: string;
  name: string;
  coordinates: Coordinates;
}

const CITY_AREAS: CityArea[] = [
  // Chennai
  { city: 'Chennai', name: 'Central Chennai · Egmore', coordinates: { lat: 13.0732, lng: 80.2609 } },
  { city: 'Chennai', name: 'Anna Nagar', coordinates: { lat: 13.0850, lng: 80.2101 } },
  { city: 'Chennai', name: 'Adyar', coordinates: { lat: 13.0067, lng: 80.2570 } },
  { city: 'Chennai', name: 'T. Nagar', coordinates: { lat: 13.0418, lng: 80.2337 } },
  { city: 'Chennai', name: 'Velachery', coordinates: { lat: 12.9756, lng: 80.2212 } },
  { city: 'Chennai', name: 'Porur', coordinates: { lat: 13.0358, lng: 80.1568 } },
  { city: 'Chennai', name: 'Tambaram', coordinates: { lat: 12.9249, lng: 80.1000 } },
  // Delhi
  { city: 'Delhi', name: 'Saket', coordinates: { lat: 28.5245, lng: 77.2066 } },
  { city: 'Delhi', name: 'Vasant Kunj', coordinates: { lat: 28.5200, lng: 77.1590 } },
  { city: 'Delhi', name: 'Connaught Place', coordinates: { lat: 28.6315, lng: 77.2167 } },
  // Gurugram
  { city: 'Gurugram', name: 'Gurugram City Center', coordinates: { lat: 28.4595, lng: 77.0266 } },
];

const CITIES = ['Chennai', 'Delhi', 'Gurugram'];
const RADII = [2, 5, 10, 20] as const;
const DEFAULT_CENTER: Coordinates = CITY_AREAS[0].coordinates;

function providerMarkerIcon(place: NearbyPlace, selected: boolean) {
  const markerType = place.emergency ? 'emergency' : place.type;
  return L.divIcon({
    className: 'nearby-marker-shell',
    html: `<span class="nearby-map-marker nearby-map-marker--${markerType}${selected ? ' is-selected' : ''}" data-testid="marker-provider-${place.id}" aria-label="${place.name.replace(/[<>&"]/g, '')}"><span></span></span>`,
    iconSize: [30, 38],
    iconAnchor: [15, 34],
  });
}

const userIcon = L.divIcon({
  className: 'nearby-marker-shell',
  html: '<span class="nearby-user-marker"><i></i></span>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

function MapViewport({ places, origin, selectedPlace }: {
  places: NearbyPlace[];
  origin: Coordinates;
  selectedPlace: NearbyPlace | null;
}) {
  const map = useMap();
  useEffect(() => {
    const points: LatLngExpression[] = [[origin.lat, origin.lng]];
    places.forEach((place) => points.push([place.lat, place.lng]));
    if (points.length > 1) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [38, 38], maxZoom: 14, animate: true });
    } else if (selectedPlace) {
      map.setView([selectedPlace.lat, selectedPlace.lng], 14, { animate: true });
    } else {
      map.setView([origin.lat, origin.lng], 13, { animate: true });
    }
  }, [map, places, selectedPlace, origin]);
  return null;
}

function formatDistance(distance: number) {
  return distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`;
}

function googleDirections(place: NearbyPlace) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${place.name}, ${place.address}`)}`;
}

export default function NearbyCare({
  departments,
  initialDepartmentId = 'all',
  emergency = false,
  expandedByDefault = false,
  onAddToChecklist,
}: NearbyCareProps) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  const [department, setDepartment] = useState<DepartmentChoice>(initialDepartmentId);
  const [radius, setRadius] = useState<number>(5);
  const [areaIndex, setAreaIndex] = useState(0);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'watching' | 'denied' | 'unavailable'>('idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [locateAfterExpand, setLocateAfterExpand] = useState(false);
  const [retryCounter, setRetryCounter] = useState(0);

  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const searchCenter = userLocation ?? CITY_AREAS[areaIndex].coordinates;

  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);

    searchNearby(
      searchCenter.lat,
      searchCenter.lng,
      emergency ? 'all' : department,
      radius,
      { emergencyOnly: emergency }
    )
      .then((results) => {
        if (!isCancelled) {
          setPlaces(results);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error('[NearbyCare error]', err);
          setError("We couldn't load nearby places. Check your connection and try again.");
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [department, emergency, radius, searchCenter.lat, searchCenter.lng, retryCounter]);

  const selectedPlace = places.find((place) => place.id === selectedId) ?? null;
  const isSampleFallback = places.some((place) => place.source === 'sample');

  useEffect(() => {
    if (selectedId && !places.some((place) => place.id === selectedId)) {
      setSelectedId(null);
    }
  }, [places, selectedId]);

  useEffect(() => () => {
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
  }, []);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus('unavailable');
      return;
    }
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    setLocationStatus('watching');
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocationStatus('idle');
      },
      (geoError) => {
        setLocationStatus(geoError.code === geoError.PERMISSION_DENIED ? 'denied' : 'unavailable');
        if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 },
    );
  }, []);

  useEffect(() => {
    if (!expanded || !locateAfterExpand) return;
    setLocateAfterExpand(false);
    requestLocation();
  }, [expanded, locateAfterExpand, requestLocation]);

  const handleAreaChange = (value: string) => {
    setAreaIndex(Number(value));
    setUserLocation(null);
  };

  const selectPlace = (place: NearbyPlace) => {
    setSelectedId((current) => current === place.id ? null : place.id);
  };

  const addToChecklist = (place: NearbyPlace) => {
    onAddToChecklist(`Visit ${place.name}, ${place.address}`);
    setAddedId(place.id);
    window.setTimeout(() => setAddedId((current) => current === place.id ? null : current), 2200);
  };

  const renderAreaSelect = () => (
    <label className="nearby-area-select">
      <span className="sr-only">Choose an area</span>
      <select value={areaIndex} onChange={(event) => handleAreaChange(event.target.value)} data-testid="select-city-area">
        {CITIES.map((cityName) => (
          <optgroup key={cityName} label={cityName}>
            {CITY_AREAS.map((area, index) => {
              if (area.city !== cityName) return null;
              return <option value={index} key={area.name}>{area.name}</option>;
            })}
          </optgroup>
        ))}
      </select>
    </label>
  );

  return (
    <section className={`nearby-care ${emergency ? 'nearby-care--emergency' : ''}`} data-testid="section-nearby-care">
      {!expanded ? (
        <div className="nearby-collapsed">
          <div className="nearby-collapsed-copy">
            <span className="nearby-eyebrow"><MapPin size={14} /> Nearby care</span>
            <h2>Find care close to you</h2>
            <p>Explore nearby {emergency ? 'emergency hospitals' : 'clinics and hospitals'} on OpenStreetMap.</p>
          </div>
          <button className="nearby-primary-button" type="button" onClick={() => { setExpanded(true); setLocateAfterExpand(true); }} data-testid="button-open-nearby-care">
            Explore nearby care <Navigation size={16} />
          </button>
        </div>
      ) : (
        <>
          <div className="nearby-heading">
            <div>
              <span className="nearby-eyebrow"><MapPin size={14} /> Nearby care</span>
              <h2>{emergency ? 'Emergency hospitals nearby' : 'Find care close to you'}</h2>
              <p>Compare nearby options, then choose the next step that feels right.</p>
            </div>
            {expandedByDefault && (
              <button type="button" className="nearby-location-button" onClick={requestLocation} disabled={locationStatus === 'watching'} data-testid="button-use-current-location">
                <Crosshair size={16} /> {locationStatus === 'watching' ? 'Finding your location…' : 'Use my current location'}
              </button>
            )}
          </div>

          <p className="nearby-privacy" data-testid="text-location-explanation">
            Your approximate location (rounded to about 1 km) is sent to OpenStreetMap's Overpass service to find nearby places. It is not stored and is not sent to CareCompass servers. OpenStreetMap supplies the map tiles.
          </p>

          {isSampleFallback && (
            <div className="nearby-sample-banner" role="alert" data-testid="banner-sample-fallback">
              <AlertTriangle size={16} style={{ flex: 'none' }} />
              <span>Showing a sample directory because live data could not be loaded. Details are not verified.</span>
            </div>
          )}

          {(locationStatus === 'denied' || locationStatus === 'unavailable') && (
            <div className="nearby-location-fallback" data-testid="status-location-fallback">
              <span>{locationStatus === 'denied' ? 'Location access was declined.' : 'Your location is unavailable.'} Choose an area instead.</span>
              {renderAreaSelect()}
            </div>
          )}

          {!expandedByDefault && locationStatus === 'idle' && !userLocation && (
            <div className="nearby-inline-controls">
              <button type="button" className="nearby-location-button" onClick={requestLocation} data-testid="button-use-current-location">
                <Crosshair size={16} /> Use my current location
              </button>
              <span className="nearby-location-hint">Or browse from</span>
              {renderAreaSelect()}
            </div>
          )}

          <div className="nearby-controls">
            <label className="nearby-filter">
              <span>Department</span>
              <select value={department} onChange={(event) => setDepartment(event.target.value as DepartmentChoice)} disabled={emergency} data-testid="select-nearby-department">
                <option value="all">All departments</option>
                {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <fieldset className="nearby-radius">
              <legend>Search radius</legend>
              <div>
                {RADII.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={radius === value ? 'active' : ''}
                    onClick={() => setRadius(value)}
                    aria-pressed={radius === value}
                    data-testid={`button-radius-${value}`}
                  >
                    {value} km
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          {emergency && (
            <a className="nearby-emergency-call" href="tel:112" data-testid="link-call-emergency">
              <Phone size={17} /> Call emergency services · 112
            </a>
          )}

          <div className="nearby-content">
            <div className="nearby-map-panel">
              <div className="nearby-map" data-testid="map-nearby-care" aria-label="Map of nearby care providers">
                <MapContainer center={DEFAULT_CENTER as LatLngExpression} zoom={12} scrollWheelZoom={false} zoomControl className="nearby-leaflet-map">
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <MapViewport places={places} origin={searchCenter} selectedPlace={selectedPlace} />
                  <Marker position={[searchCenter.lat, searchCenter.lng]} icon={userIcon} title={userLocation ? 'Your current location' : 'Selected area center'} />
                  {places.map((place) => (
                    <Marker
                      key={place.id}
                      position={[place.lat, place.lng]}
                      icon={providerMarkerIcon(place, place.id === selectedId)}
                      title={place.name}
                      eventHandlers={{ click: () => selectPlace(place) }}
                    />
                  ))}
                  {selectedPlace && (
                    <Polyline
                      positions={[[searchCenter.lat, searchCenter.lng], [selectedPlace.lat, selectedPlace.lng]]}
                      pathOptions={{ color: '#5275de', weight: 2, dashArray: '6 8', opacity: 0.8 }}
                    />
                  )}
                </MapContainer>
              </div>
              <div className="nearby-map-legend" data-testid="legend-nearby-map">
                <span><i className="legend-user" /> You / selected area</span>
                <span><i className="legend-clinic" /> Clinic</span>
                <span><i className="legend-hospital" /> Hospital</span>
                <span><i className="legend-emergency" /> Emergency hospital</span>
              </div>
              <p className="nearby-caution" data-testid="text-nearby-caution">
                <ShieldAlert size={15} /> Distances are approximate straight-line estimates, not driving distances. Please confirm services, hours, and availability directly with the provider. Place details come from OpenStreetMap contributors and may be incomplete.
              </p>
            </div>

            <div className="nearby-results" aria-live="polite">
              <div className="nearby-results-heading">
                <div>
                  <span className="nearby-eyebrow">Your options</span>
                  <h3 data-testid="text-nearby-result-count">{places.length} {places.length === 1 ? 'place' : 'places'} within {radius} km</h3>
                </div>
                {locationStatus === 'watching' && <span className="nearby-location-status" role="status" data-testid="status-location-loading">Finding you…</span>}
              </div>

              {loading ? (
                <div className="nearby-skeleton-list" role="status" data-testid="status-nearby-loading">
                  {[0, 1, 2].map((item) => <div className="nearby-skeleton-card" key={item}><i /><span /><span /><b /></div>)}
                </div>
              ) : error ? (
                <div className="nearby-empty" data-testid="status-nearby-error">
                  <span className="nearby-empty-icon"><AlertTriangle size={20} /></span>
                  <p>{error}</p>
                  <button type="button" className="nearby-retry-button" onClick={() => setRetryCounter(c => c + 1)}>
                    <RefreshCw size={12} style={{ display: 'inline', marginRight: 4 }} /> Try again
                  </button>
                </div>
              ) : places.length === 0 ? (
                <div className="nearby-empty" data-testid="status-nearby-empty">
                  <span className="nearby-empty-icon"><MapPin size={20} /></span>
                  <p>No nearby providers found. Try increasing the search radius or choosing a different area.</p>
                </div>
              ) : (
                <div className="nearby-card-list">
                  {places.map((place) => {
                    const isSelected = selectedId === place.id;
                    const isAdded = addedId === place.id;
                    return (
                      <article className={`nearby-provider-card ${isSelected ? 'selected' : ''}`} key={place.id} data-testid={`card-provider-${place.id}`}>
                        <button type="button" className="nearby-card-select" onClick={() => selectPlace(place)} aria-pressed={isSelected} data-testid={`button-select-provider-${place.id}`}>
                          <span className={`nearby-provider-icon ${place.emergency ? 'emergency' : place.type}`}><Building2 size={17} /></span>
                          <span className="nearby-provider-main">
                            <strong data-testid={`text-provider-name-${place.id}`}>{place.name}</strong>
                            <span className="nearby-provider-tags">
                              <i className={place.emergency ? 'tag-emergency' : place.type === 'clinic' ? 'tag-clinic' : 'tag-hospital'}>
                                {place.emergency ? 'Emergency hospital' : place.type === 'clinic' ? 'Clinic' : 'Hospital'}
                              </i>
                              {place.departmentMatch && <i className="tag-match">Department match</i>}
                              {place.source === 'osm' && !place.servicesListed && (
                                <i className="tag-unlisted">Services not listed. Call to confirm.</i>
                              )}
                              {emergency && !place.emergency && (
                                <i className="tag-unconfirmed">Emergency services not confirmed. Call 112 first.</i>
                              )}
                            </span>
                          </span>
                          <span className="nearby-distance" aria-label={`About ${formatDistance(place.distanceKm)} straight-line distance`}>
                            ~{formatDistance(place.distanceKm)}
                          </span>
                        </button>
                        <div className="nearby-provider-details">
                          <span><MapPin size={13} />{place.address}</span>
                          <span><Clock3 size={13} />{place.hours}</span>
                        </div>
                        <div className="nearby-card-actions">
                          {place.phone && place.source === 'osm' && (
                            <a href={`tel:${place.phone.replace(/[^\d+]/g, '')}`} data-testid={`link-call-provider-${place.id}`}>
                              <Phone size={14} /> Call
                            </a>
                          )}
                          <a href={googleDirections(place)} target="_blank" rel="noreferrer" data-testid={`link-directions-${place.id}`}>
                            <ArrowUpRight size={14} /> Directions
                          </a>
                          <button type="button" onClick={() => addToChecklist(place)} className={isAdded ? 'is-added' : ''} data-testid={`button-add-checklist-${place.id}`}>
                            {isAdded ? <Check size={14} /> : <Plus size={14} />} {isAdded ? 'Added' : 'Add to checklist'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
