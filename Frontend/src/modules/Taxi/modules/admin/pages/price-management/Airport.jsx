import React from 'react';
import { useParams } from 'react-router-dom';
import HubList from './hubs/HubList';
import HubEditor from './hubs/HubEditor';

/**
 * Airports & Stations (transit hubs: airports, railway stations, bus stands).
 * Routes are unchanged: /taxi/admin/pricing/airport, /create, /edit/:id.
 * Contract: docs/taxi-transit-hubs-contract.md.
 */
const Airport = ({ mode = 'list' }) => {
  const { id } = useParams();

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8 font-sans">
      {mode === 'list' ? (
        <HubList />
      ) : (
        <HubEditor key={mode === 'edit' ? id : 'create'} hubId={mode === 'edit' ? id : null} />
      )}
    </div>
  );
};

export default Airport;
