import { Book } from './pages/Book';
import { Flight } from './pages/Flight';
import { Home } from './pages/Home';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  if (route.name === 'book') return <Book />;
  if (route.name === 'flight') return <Flight code={route.code} />;
  return <Home />;
}
