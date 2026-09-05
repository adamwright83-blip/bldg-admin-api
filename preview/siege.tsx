import { createRoot } from 'react-dom/client';
import { SiegeGame } from '@/components/admin/control-room/TowerSiege';
import './index.css';
createRoot(document.getElementById('root')!).render(<SiegeGame storageKey="goldline:siege:playtest" pressure={0.8} reflection="Playtest fixture: zero orders. No live business data." />);
