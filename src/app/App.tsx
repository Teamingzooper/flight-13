import { AccountPage } from './pages/Account';
import { Book } from './pages/Book';
import { SettingsPage } from './pages/SettingsPage';
import { DutyFree } from './pages/DutyFree';
import { Flight } from './pages/Flight';
import { Home } from './pages/Home';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  if (route.name === 'book') return <Book />;
  if (route.name === 'dutyFree') return <DutyFree />;
  if (route.name === 'settings') return <SettingsPage />;
  if (route.name === 'account') return <AccountPage ticket={route.ticket} error={route.error} />;
  if (route.name === 'flight') return <Flight code={route.code} move={route.move} />;
  return <Home />;
}
