import { Join } from './screens/Join.js';
import { Landing } from './screens/Landing.js';
import { OpenTable } from './screens/OpenTable.js';
import { TableRoute } from './screens/TableRoute.js';
import { useRoute } from './ui/route.js';
import { ToastProvider } from './ui/Toast.js';

export function App() {
  const route = useRoute();
  return (
    <ToastProvider>
      {route.name === 'landing' && <Landing />}
      {route.name === 'open' && <OpenTable />}
      {route.name === 'join' && <Join key={route.code} initialCode={route.code} />}
      {route.name === 'table' && <TableRoute key={route.code} code={route.code} />}
    </ToastProvider>
  );
}
