import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { jetons, signe, useSolde } from '../lib/solde';
import { attendre, mouvementReduit, useJeu } from '../lib/jeux';
import { Mise } from '../components/Jetons';
import { Historique } from '../components/Historique';
import { SousLeCapot } from '../components/SousLeCapot';

interface Resultat {
  partie_id: number;
  mise: number;
  gain: number;
  etat: { rouleaux: string[]; combinaison: string };
  solde: number;
}

/* Les symboles sont tires par machine_symbole() en PL/pgSQL. Le front ne fait
   que choisir un dessin pour chaque code. */
const SYMBOLE: Record<string, string> = {
  cerise: '🍒',
  citron: '🍋',
  raisin: '🍇',
  pasteque: '🍉',
  cloche: '🔔',
  diamant: '💎',
  sept: '7️⃣',
};
const CODES = Object.keys(SYMBOLE);

const NOM: Record<string, string> = {
  cerise: 'cerises', citron: 'citrons', raisin: 'raisins', pasteque: 'pastèques',
  cloche: 'cloches', diamant: 'diamants', sept: 'sept',
};

const GAINS: { code: string; multiplicateur: string }[] = [
  { code: 'sept', multiplicateur: '× 1000' },
  { code: 'diamant', multiplicateur: '× 200' },
  { code: 'cloche', multiplicateur: '× 60' },
  { code: 'pasteque', multiplicateur: '× 25' },
  { code: 'raisin', multiplicateur: '× 12' },
  { code: 'citron', multiplicateur: '× 8' },
  { code: 'cerise', multiplicateur: '× 5' },
];

const hasard = () => CODES[Math.floor(Math.random() * CODES.length)]!;

export function Machine() {
  const { min, max } = useJeu('machine');
  const { solde, poser } = useSolde();
  const [mise, setMise] = useState(5);
  const [rouleaux, setRouleaux] = useState(['sept', 'sept', 'sept']);
  const [tournent, setTournent] = useState([false, false, false]);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [historique, setHistorique] = useState<Resultat[]>([]);
  const [erreur, setErreur] = useState('');
  const [encours, setEncours] = useState(false);
  const minuterie = useRef<number>();
  // Quels rouleaux tournent encore : lu par l'intervalle sans le recreer.
  const tournentRef = useRef([true, true, true]);

  async function tirer() {
    setErreur('');
    setEncours(true);
    setResultat(null);

    const anime = !mouvementReduit();
    if (anime) {
      setTournent([true, true, true]);
      minuterie.current = window.setInterval(() => {
        setRouleaux((r) => r.map((s, i) => (tournentRef.current[i] ? hasard() : s)));
      }, 70);
    }

    try {
      const r = await api.post<Resultat>('/jeux/machine', { mise });

      // Les rouleaux s'arretent l'un apres l'autre, de gauche a droite.
      for (let i = 0; i < 3; i++) {
        if (anime) await attendre(i === 0 ? 450 : 380);
        tournentRef.current[i] = false;
        setTournent([...tournentRef.current]);
        setRouleaux((prev) => prev.map((s, j) => (j === i ? r.etat.rouleaux[i]! : s)));
      }

      setResultat(r);
      setHistorique((h) => [r, ...h].slice(0, 12));
      poser(Number(r.solde));
    } catch (err) {
      setErreur((err as Error).message);
      tournentRef.current = [false, false, false];
      setTournent([false, false, false]);
    } finally {
      window.clearInterval(minuterie.current);
      tournentRef.current = [true, true, true];
      setEncours(false);
    }
  }

  const net = resultat ? Number(resultat.gain) - Number(resultat.mise) : 0;
  const triple = resultat?.etat.combinaison.startsWith('trois ') ? resultat.etat.rouleaux[0] : null;
  const peutTirer = !encours && mise >= min && mise <= max && mise <= solde;

  return (
    <>
      <header className="page-titre">
        <h1>Machine à sous</h1>
        <p className="chapeau">
          Trois symboles identiques multiplient votre mise. Deux identiques vous la rendent.
        </p>
      </header>

      <div className="jeu">
        <div>
          <section className="table" aria-label="Machine à sous">
            <div className="machine">
              <div className="fenetre" aria-live="polite" aria-atomic="true">
                {rouleaux.map((s, i) => (
                  <div key={i} className={`rouleau ${tournent[i] ? 'rouleau--tourne' : resultat ? 'rouleau--arrete' : ''}`}>
                    <span role="img" aria-label={tournent[i] ? 'en rotation' : NOM[s]}>{SYMBOLE[s]}</span>
                  </div>
                ))}
              </div>

              <p className="machine__verdict" aria-live="polite">
                {resultat && (
                  net > 0 ? (
                    <>Trois {NOM[triple ?? ''] ?? ''} : <span className="montant gain">{signe(net)} jetons</span></>
                  ) : net === 0 ? (
                    <>Une paire : votre mise vous est rendue.</>
                  ) : (
                    <>Pas de combinaison : <span className="montant perte">{signe(net)} jetons</span></>
                  )
                )}
              </p>
            </div>
          </section>

          <Historique vide="Aucun tour joué pour l'instant">
            {historique.map((h) => {
              const n = Number(h.gain) - Number(h.mise);
              return (
                <span key={h.partie_id} className={`puce ${n > 0 ? 'puce--gain' : n < 0 ? 'puce--perte' : ''}`}>
                  {signe(n)}
                </span>
              );
            })}
          </Historique>
        </div>

        <div>
          <aside className="panneau" aria-label="Votre mise">
            <Mise valeur={mise} onChange={setMise} min={min} max={max} solde={solde} disabled={encours} />
            {erreur && <p className="alerte" role="alert">{erreur}</p>}
            <button className="bouton bouton--principal bouton--grand" onClick={() => void tirer()} disabled={!peutTirer}>
              {encours ? 'Ça tourne…' : 'Tirer le levier'}
            </button>
          </aside>

          <section className="panneau" aria-label="Table des gains" style={{ position: 'static' }}>
            <h3 style={{ marginBottom: '0.6rem' }}>Ce que paie la machine</h3>
            <table className="gains-table">
              <tbody>
                {GAINS.map((g) => (
                  <tr key={g.code} data-actif={triple === g.code}>
                    <td className="symboles" aria-label={`Trois ${NOM[g.code]}`}>
                      {SYMBOLE[g.code]}{SYMBOLE[g.code]}{SYMBOLE[g.code]}
                    </td>
                    <td>{g.multiplicateur}</td>
                  </tr>
                ))}
                <tr data-actif={resultat?.etat.combinaison === 'paire'}>
                  <td>Une paire</td>
                  <td>mise rendue</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>

      <SousLeCapot>
        <p>
          Chaque rouleau compte 100 crans répartis selon la rareté du symbole : 25 cerises,
          22 citrons… et 4 sept seulement. Le tirage est fait par <code>jouer_machine()</code>,
          le symbole par <code>machine_symbole()</code> et le gain par{' '}
          <code>machine_multiplicateur()</code>. Changer un gain se fait dans la base et
          vaut aussitôt pour tous les clients.
        </p>
        <p>
          <strong>RTP annoncé : 92,40 %.</strong> Le RTP réellement constaté sur les 800 000
          parties de la base s'en écarte de plusieurs points, à cause de la combinaison
          × 1000 : elle sort si rarement que la moyenne met longtemps à converger. Mise
          actuelle : {jetons(mise)} jetons.
        </p>
      </SousLeCapot>
    </>
  );
}
