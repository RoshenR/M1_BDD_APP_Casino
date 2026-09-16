import { useState } from 'react';
import { api } from '../lib/api';
import { jetons, useSolde } from '../lib/solde';

interface Resultat {
  partie_id: number;
  gain: number;
  mise: number;
  resultat: string;
  etat: { numero: number; couleur: 'rouge' | 'noir' | 'vert'; pari: string };
  server_seed: string;
  seed_hash: string;
  solde: number;
}

const PARIS_SIMPLES = [
  { code: 'rouge', libelle: 'Rouge', classe: 'rouge' },
  { code: 'noir', libelle: 'Noir', classe: 'noir' },
  { code: 'pair', libelle: 'Pair', classe: '' },
  { code: 'impair', libelle: 'Impair', classe: '' },
  { code: 'manque', libelle: 'Manque (1-18)', classe: '' },
  { code: 'passe', libelle: 'Passe (19-36)', classe: '' },
];

export function Roulette() {
  const [mise, setMise] = useState(10);
  const [pari, setPari] = useState('rouge');
  const [plein, setPlein] = useState(17);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [erreur, setErreur] = useState('');
  const [encours, setEncours] = useState(false);
  const { poser } = useSolde();

  async function lancer(codePari: string) {
    setErreur('');
    setEncours(true);
    try {
      // Un seul appel. Le debit, le tirage et le credit se font dans la meme
      // transaction PostgreSQL : il est impossible d'etre debite sans resultat.
      const r = await api.post<Resultat>('/jeux/roulette', { mise, pari: codePari });
      setResultat(r);
      poser(Number(r.solde));
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setEncours(false);
    }
  }

  return (
    <>
      <h1>Roulette europeenne</h1>
      <p className="sous-titre">
        37 cases, un seul zero. RTP annonce : 97,30 % — soit exactement 36/37.
      </p>

      {erreur && <div className="erreur">{erreur}</div>}

      <div className="tapis">
        {resultat ? (
          <>
            <div className={`numero-roulette ${resultat.etat.couleur}`}>{resultat.etat.numero}</div>
            <p style={{ margin: 0 }}>
              Pari <strong>{resultat.etat.pari}</strong> —{' '}
              {Number(resultat.gain) > 0 ? (
                <span className="gain">gagne {jetons(resultat.gain)} jetons</span>
              ) : (
                <span className="perte">perdu {jetons(resultat.mise)} jetons</span>
              )}
            </p>
          </>
        ) : (
          <p className="discret">Choisissez une mise et un pari, puis lancez la bille.</p>
        )}
      </div>

      <div className="carte">
        <div className="champ" style={{ maxWidth: 220 }}>
          <label htmlFor="mise">Mise (1 a 1000 jetons)</label>
          <input id="mise" type="number" min={1} max={1000} value={mise}
                 onChange={(e) => setMise(Number(e.target.value))} />
        </div>

        <h2 style={{ marginTop: '1rem' }}>Chances simples — paient 2x</h2>
        <div className="boutons" style={{ justifyContent: 'flex-start' }}>
          {PARIS_SIMPLES.map((p) => (
            <button key={p.code} className={p.classe} disabled={encours}
                    onClick={() => { setPari(p.code); void lancer(p.code); }}>
              {p.libelle}
            </button>
          ))}
        </div>

        <h2>Numero plein — paie 36x</h2>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 110 }}>
            <label htmlFor="plein">Numero</label>
            <input id="plein" type="number" min={0} max={36} value={plein}
                   onChange={(e) => setPlein(Number(e.target.value))} />
          </div>
          <button className="principal" disabled={encours}
                  onClick={() => { setPari(`plein:${plein}`); void lancer(`plein:${plein}`); }}>
            Miser sur le {plein}
          </button>
        </div>
        <p className="discret" style={{ marginTop: '0.5rem' }}>Pari courant : {pari}</p>
      </div>

      {resultat && (
        <>
          <h2>Verification du tirage</h2>
          <div className="carte">
            <p className="discret" style={{ marginTop: 0 }}>
              Le hash du seed etait publie <strong>avant</strong> le tirage ; le seed
              n&apos;est revele qu&apos;apres. Le casino ne pouvait donc pas choisir le
              resultat. Recalculez vous-meme avec{' '}
              <code className="mono">alea(server_seed, client_seed, nonce, 0, 37)</code>.
            </p>
            <table>
              <tbody>
                <tr><th>Partie</th><td className="mono">#{resultat.partie_id}</td></tr>
                <tr><th>Hash publie avant</th><td className="mono">{resultat.seed_hash}</td></tr>
                <tr><th>Seed revele apres</th><td className="mono">{resultat.server_seed}</td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
