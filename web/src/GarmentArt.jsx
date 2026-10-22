import React from 'react';
import GarmentIcon from './GarmentIcon.jsx';

// Picture shown for a product that has no photo yet: the menswear line icon, centred on the tile.
export default function GarmentArt({ code, name, nameKm, kind, style }) {
  return <GarmentIcon code={code} name={name} nameKm={nameKm} kind={kind} size="100%" style={style} />;
}

// Kept so older screens still import cleanly; there is only one look now.
export const ART_STYLES = ['icons'];
export const getArtStyle = () => 'icons';
export const setArtStyle = () => {};
