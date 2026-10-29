import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { requestPersistentStorage } from './db/db';
import { useApp } from './lib/store';
import { currentTheme, setTheme, type Theme } from './lib/theme';
import { Icon } from './ui/components/kit';
import Garage from './ui/pages/Garage';
import AddVehicle from './ui/pages/AddVehicle';
import VehicleLayout from './ui/pages/VehicleLayout';
import Settings from './ui/pages/Settings';
import Buy from './ui/pages/Buy';
import Admin from './ui/pages/Admin';

function ThemeToggle() {
  const [t, setT] = useState<Theme>(currentTheme);
  const next: Theme = t === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="theme-toggle" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`} onClick={() => { setTheme(next); setT(next); }}>
      <Icon name={t === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}

export default function App() {
  const { online } = useApp();
  useEffect(() => { void requestPersistentStorage(); }, []);
  return (
    <>
      <header className="app-header no-print">
        <div className="inner">
          <Link to="/" className="brand" aria-label="RideRecord home">
            <span className="brand-mark"><Icon name="gauge" size={17} /></span>RideRecord
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end><Icon name="home" size={18} /> <span>Garage</span></NavLink>
            <NavLink to="/add"><Icon name="plus" size={18} /> <span>Add bike</span></NavLink>
            <NavLink to="/buy"><Icon name="wallet" size={18} /> <span>Buy new</span></NavLink>
            <NavLink to="/admin"><Icon name="shield" size={18} /> <span>Catalog</span></NavLink>
            <NavLink to="/settings"><Icon name="cog" size={18} /> <span>Backup</span></NavLink>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      {!online && <div className="banner" role="status">You are offline. Everything you record is saved on this device and keeps working.</div>}
      <Routes>
        <Route path="/" element={<Garage />} />
        <Route path="/add" element={<AddVehicle />} />
        <Route path="/buy" element={<Buy />} />
        <Route path="/v/:id/*" element={<VehicleLayout />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<main className="page"><div className="empty"><h3>Page not found</h3><Link to="/">Back to your garage</Link></div></main>} />
      </Routes>
    </>
  );
}
