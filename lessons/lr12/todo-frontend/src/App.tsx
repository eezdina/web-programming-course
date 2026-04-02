import { FormEvent, useCallback, useEffect, useState } from 'react';

type ServerTodo = {
  id: number;
  title: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
};

type QueueAction =
  | { id: string; type: 'create'; payload: { title: string }; ts: number }
  | { id: string; type: 'toggle'; payload: { id: number; done: boolean }; ts: number }
  | { id: string; type: 'delete'; payload: { id: number }; ts: number };

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const QUEUE_KEY = 'offline_queue';

function readQueue(): QueueAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(q: QueueAction[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

function pushQueue(action: Omit<QueueAction, 'id' | 'ts'>) {
  const item: QueueAction = { ...action, id: crypto.randomUUID(), ts: Date.now() } as QueueAction;
  writeQueue([...readQueue(), item]);
}

function toLocalText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
}

// -------- API --------

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function apiFetchTodos(): Promise<ServerTodo[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/todos`);
    const data = await parseJson<{ items: ServerTodo[] }>(response);
    return data.items;
  } catch {
    return [];
  }
}

async function apiCreate(title: string) {
  const response = await fetch(`${API_BASE_URL}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return parseJson<ServerTodo>(response);
}

async function apiToggle(id: number, done: boolean) {
  const response = await fetch(`${API_BASE_URL}/api/todos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done }),
  });
  return parseJson<ServerTodo>(response);
}

async function apiDelete(id: number) {
  const response = await fetch(`${API_BASE_URL}/api/todos/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error();
}

// -------- Service Worker --------

function registerServiceWorkerStarter() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered');
    } catch (e) {
      console.error(e);
    }
  });
}

// -------- Queue Sync --------

let isSyncing = false;

async function syncQueue(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  const queue = readQueue();
  const rest: QueueAction[] = [];

  for (const action of queue) {
    try {
      if (action.type === 'create') await apiCreate(action.payload.title);
      if (action.type === 'toggle') await apiToggle(action.payload.id, action.payload.done);
      if (action.type === 'delete') await apiDelete(action.payload.id);
    } catch {
      rest.push(action); // оставляем в очереди, если ошибка
    }
  }

  writeQueue(rest);
  isSyncing = false;
}

// -------- App Component --------

export default function App() {
  const [todos, setTodos] = useState<ServerTodo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(readQueue().length);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');

  const refreshFromServer = useCallback(async () => {
    const data = await apiFetchTodos();
    setTodos(data);
  }, []);

  const updateQueueCount = () => setQueueCount(readQueue().length);

  // -------- Handlers --------

  const onCreate = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      if (!navigator.onLine) {
        pushQueue({ type: 'create', payload: { title: trimmed } });
        updateQueueCount();
        setMessage('Офлайн: задача добавлена в очередь');
        return;
      }

      try {
        await apiCreate(trimmed);
        await refreshFromServer();
        setMessage('Задача добавлена');
      } catch {
        pushQueue({ type: 'create', payload: { title: trimmed } });
        updateQueueCount();
        setMessage('Ошибка сети → добавлено в очередь');
      }
    },
    [refreshFromServer]
  );

  const onToggle = useCallback(
    async (todo: ServerTodo) => {
      if (!navigator.onLine) {
        pushQueue({ type: 'toggle', payload: { id: todo.id, done: !todo.done } });
        updateQueueCount();
        setMessage('Офлайн: изменение сохранено');
        return;
      }

      try {
        await apiToggle(todo.id, !todo.done);
        await refreshFromServer();
        setMessage('Статус обновлён');
      } catch {
        pushQueue({ type: 'toggle', payload: { id: todo.id, done: !todo.done } });
        updateQueueCount();
        setMessage('Ошибка → в очередь');
      }
    },
    [refreshFromServer]
  );

  const onDelete = useCallback(
    async (todo: ServerTodo) => {
      if (!navigator.onLine) {
        pushQueue({ type: 'delete', payload: { id: todo.id } });
        updateQueueCount();
        setMessage('Офлайн: удаление в очереди');
        return;
      }

      try {
        await apiDelete(todo.id);
        await refreshFromServer();
        setMessage('Удалено');
      } catch {
        pushQueue({ type: 'delete', payload: { id: todo.id } });
        updateQueueCount();
        setMessage('Ошибка → удаление в очередь');
      }
    },
    [refreshFromServer]
  );

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const value = inputValue;
      setInputValue('');
      await onCreate(value);
    },
    [inputValue, onCreate]
  );

  // -------- Effects --------

  useEffect(() => {
    registerServiceWorkerStarter();

    refreshFromServer()
      .catch(() => setMessage('Не удалось загрузить данные'))
      .finally(() => setIsLoading(false));
  }, [refreshFromServer]);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      setSyncStatus('syncing');
      setMessage('Синхронизация...');

      try {
        await syncQueue();
        updateQueueCount();

        const data = await apiFetchTodos(); // обновляем локальный стейт после sync
        setTodos(data);

        setSyncStatus('idle');
        setMessage('Синхронизация завершена');
      } catch {
        setSyncStatus('error');
        setMessage('Ошибка синхронизации');
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setMessage('Вы офлайн');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // -------- Render --------

  return (
    <main className="app">
      <header className="header">
        <h1>Todo-сы</h1>
        <span className={`badge ${isOnline ? 'online' : 'offline'}`}>
          {isOnline ? 'online' : 'offline'}
        </span>
      </header>

      <form className="toolbar" onSubmit={onSubmit}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Новая задача"
        />
        <button type="submit">Добавить</button>
      </form>

      <section className="meta">
        <span className="badge">Очередь: {queueCount}</span>
        <span className="badge">sync: {syncStatus}</span>
      </section>

      {message && <div className="message">{message}</div>}
      {isLoading && <p>Загрузка...</p>}

      <ul className="list">
        {todos.map((todo) => (
          <li className="item" key={todo.id}>
            <button onClick={() => onToggle(todo)}>
              {todo.done ? '✅' : '⬜'}
            </button>
            <div>
              <div className={todo.done ? 'done' : ''}>{todo.title}</div>
              <div className="hint">Сервер · {toLocalText(todo.updatedAt)}</div>
            </div>
            <button onClick={() => onDelete(todo)}>Удалить</button>
          </li>
        ))}
      </ul>
    </main>
  );
}