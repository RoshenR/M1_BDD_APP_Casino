import { useState } from 'react';
import { api } from '../lib/api';
import { jetons, useSolde } from '../lib/solde';

interface Resultat {
  partie_id: number;
  mise: number;
  gain: number;
  etat: { rouleaux: string[]; combinaison: string };
  solde: number;
}

/* Les symboles sont decides par machine_symbole() en PL/pgSQL.
   Le front ne fait que choisir un emoji pour chaque code. */
const EMOJI: Record<string, string> = {
  cerise: '🍒',
  citron: '🍋',
  raisin: '🍇',
  pasteque: '🍉',
  cloche: '🔔',
  diamant: '💎',
  sept: '7️⃣',
};

const GAINS = [
  ['3 × 7️⃣', '×1000'],
  ['3 × 💎', '×200'],
  ['3 × 🔔', '×60'],
  ['3 × 🍉', '×25'],
  ['3 × 🍇', '×12'],
  ['3 × 🍋', '×8'],
  ['3 × 🍒', '×5'],
  ['2 identiques', 'mise rendue'],
];

export function Machine() {
  const [mise, setMise] = useState(5);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [erreur, setErreur] = useState('');
  const [encours, setEncours] = useState(false);
  const { poser } = useSolde();

  async function tourner() {
    setErreur('');
    setEncours(true);
    try {
      const r = await api.post<Resultat>('/jeux/machine', { mise });
      setResultat(r);
      poser(Number(r.solde));
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setEncours(false);
    }
  }

  const rouleaux = resultat?.etat.rouleaux ?? ['cerise', 'citron', 'raisin'];

  return (
    <>
      <h1>Machine a sous</h1>
      <p className="sous-titre">
        Trois rouleaux de 100 crans, sept symboles ponderes. RTP annonce : 92,40 %.
      </p>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="tapis">
        <div className="rouleaux">
          {rouleaux.map((s, i) => (
            <div key={i} className="rouleau">{EMOJI[s] ?? '❓'}</div>
          ))}
        </div>

        {resultat && (
          <p style={{ margin: 0 }}>
            {resultat.etat.combinaison} —{' '}
            {Number(resultat.gain) > Number(resultat.mise) ? (
              <span className="gain">+{jetons(Number(resultat.gain) - Number(resultat.mise))} jetons</span>
            ) : Number(resultat.gain) === Number(resultat.mise) ? (
              <span className="discret">mise rendue</span>
            ) : (
              <span className="perte">−{jetons(resultat.mise)} jetons</span>
            )}
          </p>
        )}
      </div>

      <div className="carte">
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 180 }}>
            <label htmlFor="mise">Mise (1 a 200 jetons)</label>
            <input id="mise" type="number" min={1} max={200} value={mise}
                   onChange={(e) => setMise(Number(e.target.value))} />
          </div>
          <button className="principal" onClick={() => void tourner()} disabled={encours}>
            {encours ? 'Ca tourne...' : 'Lancer'}
          </button>
        </div>
      </div>

      <h2>Table de gains</h2>
      <div className="carte">
        <table>
          <thead><tr><th>Combinaison</th><th className="num">Gain</th></tr></thead>
          <tbody>
            {GAINS.map(([combi, gain]) => (
              <tr key={combi}><td>{combi}</td><td className="num">{gain}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="notice">
          Cette table est celle de <code className="mono">machine_multiplicateur()</code> en PL/pgSQL.
          Le front l&apos;affiche, il ne la calcule pas : changer un gain se fait dans la base,
          et vaut aussitot pour tous les clients.
        </p>
      </div>
    </>
  );
}
