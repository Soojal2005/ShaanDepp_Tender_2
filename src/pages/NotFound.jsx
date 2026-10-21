import { Link } from 'react-router-dom';
import { Empty } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div style={{ padding: '80px 16px' }}>
      <Empty title="Page not found">
        The page you are looking for does not exist. <Link to="/app">Go to your workspace</Link>.
      </Empty>
    </div>
  );
}
