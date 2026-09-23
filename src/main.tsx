import { render } from 'preact';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles/base.css';
import './styles/pages.css';
import './styles/tv.css';
import { App } from './app/App';

render(<App />, document.getElementById('app')!);
