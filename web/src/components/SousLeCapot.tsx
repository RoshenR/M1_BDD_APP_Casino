import type { ReactNode } from 'react';

/**
 * Les explications techniques (PL/pgSQL, RLS, triggers...) restent disponibles
 * pour la soutenance, mais repliees : elles ne gênent plus le jeu.
 */
export function SousLeCapot({ children }: { children: ReactNode }) {
  return (
    <details className="capot">
      <summary>Sous le capot</summary>
      <div className="capot__corps">{children}</div>
    </details>
  );
}
