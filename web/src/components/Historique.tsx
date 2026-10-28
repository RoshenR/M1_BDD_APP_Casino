import type { ReactNode } from 'react';

/** Les derniers coups de la session, du plus recent au plus ancien. */
export function Historique({ children, vide }: { children: ReactNode[]; vide: string }) {
  return (
    <div className="historique" aria-label="Derniers coups">
      <span className="historique__titre">{children.length ? 'Derniers coups' : vide}</span>
      {children}
    </div>
  );
}
