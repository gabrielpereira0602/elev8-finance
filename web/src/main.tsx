import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { accounts, boot, onboarding, privateMode, toast, useSignalsAll, user } from './store';
import { Lancar } from './screens/lancar';
import { Analises, Inicio } from './screens/home';
import { Ajustes, Aprender, Cartoes, Categorias, Excluir, Instalar, Lancamento, Lancamentos, Login, Orcamento, Principio, Sessoes } from './screens/other';

function useRoute() {
  const [hash, setHash] = useState(location.hash || '#/inicio');
  useEffect(() => {
    const on = () => { setHash(location.hash || '#/inicio'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [path, qs] = hash.replace(/^#/, '').split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(qs ?? '') };
}

function App() {
  useSignalsAll();
  const { parts, params } = useRoute();
  useEffect(() => { boot(); }, []);
  if (user.value === undefined) return <main class="center"><img src="/icons/simbolo-azul.svg" alt="Carregando" style={{ height: '64px', alignSelf: 'center' }} /></main>;
  if (user.value === null) return <Login />;
  const [a, b] = parts;
  let screen;
  if (onboarding.value === null) onboarding.value = !localStorage.getItem('e8f_onboarded') && accounts.value.length === 0;
  if (onboarding.value && a !== 'ajustes') {
    screen = <Cartoes onboarding />;
  } else switch (a) {
    case 'lancar': screen = <Lancar params={params} />; break;
    case 'analises': screen = <Analises tab={b ?? 'geral'} />; break;
    case 'aprender': screen = b ? <Principio id={b} /> : <Aprender />; break;
    case 'lancamentos': screen = <Lancamentos params={params} />; break;
    case 'lancamento': screen = <Lancamento id={b} />; break;
    case 'ajustes':
      screen = b === 'cartoes' ? <Cartoes /> : b === 'categorias' ? <Categorias /> : b === 'orcamento' ? <Orcamento /> : b === 'instalar' ? <Instalar params={params} />
        : b === 'sessoes' ? <Sessoes /> : b === 'excluir' ? <Excluir /> : <Ajustes />;
      break;
    default: screen = <Inicio />;
  }
  return (
    <div class={'app' + (privateMode.value ? ' private' : '')}>
      {screen}
      {toast.value && <div class="toast" role="status">{toast.value}</div>}
    </div>
  );
}

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
