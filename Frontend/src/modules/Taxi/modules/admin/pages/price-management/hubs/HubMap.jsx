import React, { useEffect, useRef, useState } from 'react';
import { Autocomplete, CircleF, DrawingManagerF, GoogleMap, MarkerF, PolygonF } from '@react-google-maps/api';
import { Circle, Eraser, Loader2, MapPin, PenTool, Search, X } from 'lucide-react';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../../utils/googleMaps';
import { circlePolygon } from './hubUtils';

const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' };
const POLY_STYLE = { fillColor: '#4f46e5', strokeColor: '#4f46e5', fillOpacity: 0.12, strokeWeight: 2 };

const readPath = (polygon) =>
  polygon
    ?.getPath()
    ?.getArray()
    .map((p) => ({ lat: Number(p.lat().toFixed(6)), lng: Number(p.lng().toFixed(6)) })) || [];

/**
 * Pin + boundary editor. Same loader and @react-google-maps/api components as the
 * zone and geo-fencing screens. Click the map to place the pin, drag it to move;
 * "Draw boundary" switches to polygon drawing; drawn vertices can be dragged and
 * right-clicked to remove.
 */
const HubMap = ({ pin, fallbackCenter, boundary, radius, onPinChange, onBoundaryChange }) => {
  const { isLoaded, loadError } = useAppGoogleMapsLoader();
  const mapRef = useRef(null);
  const polygonRef = useRef(null);
  const searchRef = useRef(null);
  const [autocomplete, setAutocomplete] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [center, setCenter] = useState(pin || fallbackCenter);

  // Recentre when the pin or the service location changes from outside the map.
  useEffect(() => {
    const next = pin || fallbackCenter;
    if (next && Number.isFinite(next.lat) && Number.isFinite(next.lng)) {
      setCenter(next);
      mapRef.current?.panTo(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.lat, pin?.lng, fallbackCenter?.lat, fallbackCenter?.lng]);

  const goTo = (geometry) => {
    const loc = geometry?.location;
    const lat = loc?.lat?.();
    const lng = loc?.lng?.();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    onPinChange(lat, lng);
    if (geometry.viewport) mapRef.current?.fitBounds(geometry.viewport);
    else {
      mapRef.current?.panTo({ lat, lng });
      mapRef.current?.setZoom(16);
    }
  };

  const manualSearch = () => {
    const query = searchRef.current?.value;
    if (!query || !window.google?.maps) return;
    new window.google.maps.Geocoder().geocode({ address: query, region: 'in' }, (results, status) => {
      if (status === 'OK' && results?.[0]?.geometry) goTo(results[0].geometry);
    });
  };

  const syncPolygon = () => {
    const next = readPath(polygonRef.current);
    if (next.length) onBoundaryChange(next);
  };

  const removeVertex = (event) => {
    if (event?.vertex === undefined || event.vertex === null) return;
    const next = boundary.filter((_, i) => i !== event.vertex);
    onBoundaryChange(next.length >= 3 ? next : []);
  };

  const useCircle = () => {
    if (!pin) return;
    onBoundaryChange(circlePolygon(pin, radius));
    setDrawing(false);
  };

  if (!HAS_VALID_GOOGLE_MAPS_KEY || loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg bg-gray-50 p-6 text-center text-sm text-gray-500">
        <MapPin size={28} className="text-gray-300" />
        <p className="font-medium text-gray-700">The map could not load.</p>
        <p className="text-xs max-w-sm">
          {loadError
            ? 'Google Maps failed to load. Check the Maps key under Integration settings.'
            : 'No Google Maps key is configured. You can still type the pin latitude/longitude and rely on the radius.'}
        </p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-gray-50">
        <Loader2 className="animate-spin text-gray-300" size={32} />
      </div>
    );
  }

  const g = window.google.maps;
  const btn =
    'inline-flex items-center gap-1.5 rounded-xl border border-gray-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide shadow-lg transition-all active:scale-95 disabled:opacity-50';

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
        <div className="flex h-11 w-full max-w-sm items-center gap-2 rounded-xl border border-gray-100 bg-white/95 px-3 shadow-lg">
          <button type="button" onClick={manualSearch} className="text-gray-400 hover:text-indigo-600" aria-label="Search">
            <Search size={16} />
          </button>
          <Autocomplete
            onLoad={setAutocomplete}
            onPlaceChanged={() => goTo(autocomplete?.getPlace()?.geometry)}
            className="flex-1"
          >
            <input
              ref={searchRef}
              type="text"
              placeholder="Search airport, station or address"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  manualSearch();
                }
              }}
              className="w-full bg-transparent text-sm font-medium text-gray-800 outline-none placeholder:text-gray-400"
            />
          </Autocomplete>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDrawing((d) => !d)}
            className={`${btn} ${drawing ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}
          >
            {drawing ? <X size={13} /> : <PenTool size={13} />}
            {drawing ? 'Cancel drawing' : boundary.length ? 'Redraw boundary' : 'Draw boundary'}
          </button>
          <button
            type="button"
            onClick={useCircle}
            disabled={!pin}
            title={pin ? '' : 'Place the pin first'}
            className={`${btn} bg-white text-indigo-600 hover:bg-indigo-50`}
          >
            <Circle size={13} /> {Number(radius) > 0 ? `${Math.round(Number(radius))} m` : '500 m'} around pin
          </button>
          {boundary.length ? (
            <button type="button" onClick={() => onBoundaryChange([])} className={`${btn} bg-white text-rose-600 hover:bg-rose-50`}>
              <Eraser size={13} /> Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="absolute bottom-3 left-3 z-10 rounded-lg bg-white/95 px-3 py-1.5 text-[11px] text-gray-600 shadow">
        {drawing
          ? 'Click to add corners; click the first corner to close the shape.'
          : boundary.length
            ? 'Drag corners to adjust · right-click a corner to remove it · click the map to move the pin'
            : 'Click the map to place the pin · drag the pin to fine-tune'}
      </div>

      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={center}
        zoom={pin ? 15 : 12}
        onLoad={(m) => {
          mapRef.current = m;
        }}
        onClick={(e) => {
          if (!drawing) onPinChange(e.latLng?.lat(), e.latLng?.lng());
        }}
        options={{
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          draggableCursor: drawing ? 'crosshair' : undefined,
        }}
      >
        {drawing ? (
          <DrawingManagerF
            drawingMode={g.drawing?.OverlayType?.POLYGON}
            options={{ drawingControl: false, polygonOptions: { ...POLY_STYLE, editable: false } }}
            onPolygonComplete={(poly) => {
              const next = readPath(poly);
              poly.setMap(null);
              setDrawing(false);
              if (next.length >= 3) onBoundaryChange(next);
            }}
          />
        ) : null}

        {!drawing && boundary.length >= 3 ? (
          <PolygonF
            key={boundary.length}
            paths={boundary}
            editable
            options={POLY_STYLE}
            onLoad={(p) => {
              polygonRef.current = p;
            }}
            onUnmount={() => {
              polygonRef.current = null;
            }}
            onMouseUp={syncPolygon}
            onDragEnd={syncPolygon}
            onRightClick={removeVertex}
            onClick={(e) => onPinChange(e.latLng?.lat(), e.latLng?.lng())}
          />
        ) : null}

        {!drawing && boundary.length < 3 && pin && Number(radius) > 0 ? (
          <CircleF
            center={pin}
            radius={Number(radius)}
            options={{ fillColor: '#f59e0b', strokeColor: '#f59e0b', fillOpacity: 0.08, strokeWeight: 1, clickable: false }}
          />
        ) : null}

        {pin ? (
          <MarkerF
            position={pin}
            draggable
            onDragEnd={(e) => onPinChange(e.latLng?.lat(), e.latLng?.lng())}
            icon={{
              path: g.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: '#4f46e5',
              fillOpacity: 1,
              strokeColor: 'white',
              strokeWeight: 2,
            }}
          />
        ) : null}
      </GoogleMap>
    </div>
  );
};

export default HubMap;
