/** Notifications de confirmation, en bas a droite, qui disparaissent seules. */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  texte: string;
  type: 'succes' | 'erreur';
}

const Contexte = createContext<(texte: string, type?: Toast['type']) => void>(() => {});

export function FournisseurToasts({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const montrer = useCallback((texte: string, type: Toast['type'] = 'succes') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, texte, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <Contexte.Provider value={montrer}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`}>{t.texte}</div>
        ))}
      </div>
    </Contexte.Provider>
  );
}

export const useToast = () => useContext(Contexte);
