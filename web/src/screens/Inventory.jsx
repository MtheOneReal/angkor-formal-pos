import React, { useState } from 'react';
import { useApp } from '../ui.jsx';
import Lookup from './Lookup.jsx';
import StockScreen from './Stock.jsx';
import Catalogue from './Catalogue.jsx';
import StockCount from './StockCount.jsx';

// One place for everything about the goods: where they are, receiving and counting, and the product list.
export default function Inventory() {
  const { me, lang } = useApp();
  const km = lang === 'km';
  const tabs = [
    ['find', km ? '🔎 ស្វែងរកគ្រប់សាខា' : '🔎 Search all branches', 'stock.view', Lookup],
    ['stock', km ? '📦 ស្តុកក្នុងសាខានេះ' : '📦 Stock in this branch', 'stock.in', StockScreen],
    ['count', km ? '🧮 រាប់ស្តុក' : '🧮 Stock count', 'stock.adjust', StockCount],
    ['catalogue', km ? '👔 កាតាឡុក & ស្លាក' : '👔 Catalogue & labels', 'catalog.edit', Catalogue],
  ].filter((x) => me.perms.includes(x[2]));
  const [cur, setCur] = useState(tabs[0]?.[0]);
  const Active = (tabs.find((x) => x[0] === cur) || tabs[0])?.[3];
  return (
    <div className="embedded">
      <h1 style={{ marginBottom: 12 }}>{km ? 'ការគ្រប់គ្រងស្តុក' : 'Inventory control'}</h1>
      {tabs.length > 1 && <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={`chip ${cur === k ? 'on' : ''}`} onClick={() => setCur(k)}>{l}</button>)}</div>}
      {Active && <Active key={cur} />}
    </div>
  );
}
