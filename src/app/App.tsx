import { Book } from './pages/Book';
import { DutyFree } from './pages/DutyFree';
import { Flight } from './pages/Flight';
import { Home } from './pages/Home';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  if (route.name === 'book') return <Book />;
  if (route.name === 'dutyFree') return <DutyFree />;
  if (route.name === 'flight') return <Flight code={route.code} />;
  return <Home />;
}
