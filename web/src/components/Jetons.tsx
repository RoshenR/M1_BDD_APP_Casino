/**
 * Les jetons : l'element central de l'interface.
 * On mise en posant des jetons, comme a une vraie table, au lieu de taper un
 * nombre. Les bornes (mise min/max du jeu, solde) desactivent les jetons qui
 * feraient deborder — la base revalide de toute facon.
 */
import { useState } from 'react';
import { jetons } from '../lib/solde';

export const VALEURS = [1, 5, 25, 100, 500] as const;

const COULEUR: Record<number, string> = {
  1: 'blanc',
  5: 'rouge',
  25: 'vert',
  100: 'noir',
  500: 'violet',
  1000: 'orange',
};

const TEINTES: Record<string, [string, string]> = {
  blanc: ['var(--j-blanc)', 'var(--j-rouge)'],
  rouge: ['var(--j-rouge)', 'var(--j-blanc)'],
  vert: ['var(--j-vert)', 'var(--j-blanc)'],
  noir: ['var(--j-noir)', 'var(--j-orange)'],
  violet: ['var(--j-violet)', 'var(--j-blanc)'],
  orange: ['var(--j-orange)', 'var(--j-noir)'],
};

type Taille = 'xs' | 's' | 'm' | 'l';

export function Jeton({ valeur, taille = 'm' }: { valeur: number; taille?: Taille }) {
  const couleur = COULEUR[valeur] ?? 'blanc';
  return (
    <span className={`jeton jeton--${couleur} jeton--${taille}`} aria-hidden="true">
      <span>{taille === 'xs' ? '' : valeur >= 1000 ? `${valeur / 1000}k` : valeur}</span>
    </span>
  );
}

/** Decompose un montant en jetons, du plus gros au plus petit. */
function decomposer(montant: number): Map<number, number> {
  const pile = new Map<number, number>();
  let reste = Math.floor(montant);
  for (const v of [1000, 500, 100, 25, 5, 1]) {
    const n = Math.floor(reste / v);
    if (n > 0) pile.set(v, n);
    reste -= n * v;
  }
  return pile;
}

/** La mise vue de profil : une pile par valeur, plafonnee pour rester lisible. */
export function Piles({ montant }: { montant: number }) {
  const piles = [...decomposer(montant).entries()];
  return (
    <div className="piles" aria-hidden="true">
      {piles.map(([valeur, nombre]) => {
        const [c, bord] = TEINTES[COULEUR[valeur] ?? 'blanc']!;
        return (
          <div key={valeur} className="pile">
            {Array.from({ length: Math.min(nombre, 12) }, (_, i) => (
              <span
                key={i}
                className="pile__jeton"
                style={{ ['--c' as string]: c, ['--bord' as string]: bord }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface MiseProps {
  valeur: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  solde: number;
  disabled?: boolean;
}

/** Le panneau ou l'on compose sa mise jeton par jeton. */
export function Mise({ valeur, onChange, min, max, solde, disabled }: MiseProps) {
  // On garde l'ordre des jetons poses pour pouvoir retirer le dernier.
  const [poses, setPoses] = useState<number[]>([]);
  const plafond = Math.min(max, Math.floor(solde));

  const poser = (v: number) => {
    if (valeur + v > plafond) return;
    setPoses((p) => [...p, v]);
    onChange(valeur + v);
  };

  const retirer = () => {
    const dernier = poses.at(-1);
    if (dernier === undefined) {
      onChange(0);
      return;
    }
    setPoses((p) => p.slice(0, -1));
    onChange(Math.max(0, valeur - dernier));
  };

  const doubler = () => {
    const double = Math.min(valeur * 2, plafond);
    setPoses([]);
    onChange(double);
  };

  const effacer = () => {
    setPoses([]);
    onChange(0);
  };

  const tropBas = valeur > 0 && valeur < min;

  return (
    <div>
      <div className="mise__tete">
        <span className="montant mise__valeur" aria-live="polite">
          {jetons(valeur)}
          <span className="visuellement-cache"> jetons misés</span>
        </span>
        <span className="mise__bornes">
          de {jetons(min)} à {jetons(max)}
        </span>
      </div>

      <div className="mise__plateau">
        {valeur > 0 ? <Piles montant={valeur} /> : <span className="mise__vide">Posez vos jetons</span>}
      </div>

      <div className="mise__jetons" role="group" aria-label="Ajouter des jetons">
        {VALEURS.map((v) => (
          <button
            key={v}
            type="button"
            className={`jeton jeton--${COULEUR[v]} jeton--m`}
            onClick={() => poser(v)}
            disabled={disabled || valeur + v > plafond}
            aria-label={`Ajouter ${v} jeton${v > 1 ? 's' : ''}`}
          >
            <span>{v}</span>
          </button>
        ))}
      </div>

      <div className="mise__outils">
        <button type="button" className="bouton bouton--discret" onClick={retirer} disabled={disabled || valeur === 0}>
          Retirer
        </button>
        <button type="button" className="bouton bouton--discret" onClick={doubler} disabled={disabled || valeur === 0 || valeur * 2 > plafond}>
          Doubler
        </button>
        <button type="button" className="bouton bouton--discret" onClick={effacer} disabled={disabled || valeur === 0}>
          Effacer
        </button>
      </div>

      {tropBas && <p className="alerte">La mise minimale est de {jetons(min)} jetons.</p>}
    </div>
  );
}
