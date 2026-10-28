import { useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { jetons, signe, useSolde } from '../lib/solde';
import { attendre, mouvementReduit, useJeu } from '../lib/jeux';
import { Jeton, Mise } from '../components/Jetons';
import { Historique } from '../components/Historique';
import { SousLeCapot } from '../components/SousLeCapot';

type Couleur = 'rouge' | 'noir' | 'vert';

interface Resultat {
  partie_id: number;
  mise: number;
  gain: number;
  etat: { numero: number; couleur: Couleur; pari: string };
  seed_hash: string;
  server_seed: string;
  solde: number;
}

const ROUGES = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const couleurDe = (n: number): Couleur => (n === 0 ? 'vert' : ROUGES.has(n) ? 'rouge' : 'noir');

/* -----------------------------------------------------------------------------
   Le tapis. Chaque case connait sa place en paysage (--dc/--dr) et en
   portrait (--mc/--mr) : le meme tapis se redresse sur mobile.
   -------------------------------------------------------------------------- */
interface Case {
  pari: string;
  libelle: string;
  classe: string;
  paie: string;
  d: [string, string];
  m: [string, string];
  vertical?: boolean;
}

function construireTapis(): Case[] {
  const cases: Case[] = [
    { pari: 'plein:0', libelle: '0', classe: 'case--vert', paie: '36 fois la mise',
      d: ['1', '1 / span 3'], m: ['3 / span 3', '1'] },
  ];

  for (let n = 1; n <= 36; n++) {
    const i = Math.floor((n - 1) / 3);   // colonne en paysage (0..11)
    const k = (n - 1) % 3;               // 0 = rangee du bas en paysage
    cases.push({
      pari: `plein:${n}`,
      libelle: String(n),
      classe: `case--${couleurDe(n)}`,
      paie: '36 fois la mise',
      d: [String(2 + i), String(3 - k)],
      m: [String(3 + k), String(2 + i)],
    });
  }

  for (let c = 1; c <= 3; c++) {
    cases.push({
      pari: `colonne:${c}`, libelle: '2 pour 1', classe: 'case--texte', paie: '3 fois la mise',
      d: ['14', String(4 - c)], m: [String(2 + c), '14'],
    });
  }

  const douzaines = ['1 à 12', '13 à 24', '25 à 36'];
  douzaines.forEach((libelle, d) => {
    cases.push({
      pari: `douzaine:${d + 1}`, libelle, classe: 'case--texte', paie: '3 fois la mise',
      d: [`${2 + 4 * d} / span 4`, '4'], m: ['1', `${2 + 4 * d} / span 4`], vertical: true,
    });
  });

  const simples: [string, string, string][] = [
    ['manque', '1 à 18', 'case--texte'],
    ['pair', 'Pair', 'case--texte'],
    ['rouge', 'Rouge', 'case--texte'],
    ['noir', 'Noir', 'case--texte'],
    ['impair', 'Impair', 'case--texte'],
    ['passe', '19 à 36', 'case--texte'],
  ];
  simples.forEach(([pari, libelle, classe], j) => {
    cases.push({
      pari, libelle, classe, paie: '2 fois la mise',
      d: [`${2 + 2 * j} / span 2`, '5'], m: ['2', `${2 + 2 * j} / span 2`], vertical: true,
    });
  });

  return cases;
}

const TAPIS = construireTapis();

/** Le pari en francais lisible, pour le panneau et l'historique. */
function nommerPari(pari: string): string {
  const c = TAPIS.find((x) => x.pari === pari);
  if (!c) return pari;
  if (pari.startsWith('plein')) return `le ${c.libelle}`;
  if (pari.startsWith('colonne')) return `la colonne ${pari.split(':')[1]}`;
  if (pari.startsWith('douzaine')) return `la douzaine ${c.libelle}`;
  return c.libelle.toLowerCase();
}

/** Le numero gagnant fait-il gagner cette case ? (pour la surbrillance) */
function caseGagne(pari: string, n: number): boolean {
  const [type, arg] = pari.split(':');
  if (n === 0) return pari === 'plein:0';
  switch (type) {
    case 'plein': return Number(arg) === n;
    case 'rouge': return ROUGES.has(n);
    case 'noir': return !ROUGES.has(n);
    case 'pair': return n % 2 === 0;
    case 'impair': return n % 2 === 1;
    case 'manque': return n <= 18;
    case 'passe': return n >= 19;
    case 'douzaine': return Math.floor((n - 1) / 12) + 1 === Number(arg);
    case 'colonne': return ((n - 1) % 3) + 1 === Number(arg);
    default: return false;
  }
}

export function Roulette() {
  const { min, max } = useJeu('roulette');
  const { solde, poser } = useSolde();
  const [pari, setPari] = useState('rouge');
  const [mise, setMise] = useState(10);
  const [bille, setBille] = useState<{ numero: number; roule: boolean } | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [historique, setHistorique] = useState<Resultat[]>([]);
  const [erreur, setErreur] = useState('');
  const [encours, setEncours] = useState(false);

  async function lancer() {
    setErreur('');
    setEncours(true);
    setResultat(null);
    try {
      // Un seul appel : debit, tirage et credit sont une seule transaction
      // PostgreSQL. On ne peut pas etre debite sans resultat.
      const r = await api.post<Resultat>('/jeux/roulette', { mise, pari });

      // La bille tourne un instant avant de se poser : c'est la seule
      // animation de la page, et elle repond au geste du joueur.
      if (!mouvementReduit()) {
        for (let t = 0; t < 14; t++) {
          setBille({ numero: Math.floor(Math.random() * 37), roule: true });
          await attendre(45 + t * 6);
        }
      }
      setBille({ numero: r.etat.numero, roule: false });
      setResultat(r);
      setHistorique((h) => [r, ...h].slice(0, 12));
      poser(Number(r.solde));
    } catch (err) {
      setErreur((err as Error).message);
      setBille(null);
    } finally {
      setEncours(false);
    }
  }

  const net = resultat ? Number(resultat.gain) - Number(resultat.mise) : 0;
  const caseChoisie = TAPIS.find((c) => c.pari === pari);
  const peutLancer = !encours && mise >= min && mise <= max && mise <= solde;

  return (
    <>
      <header className="page-titre">
        <h1>Roulette</h1>
        <p className="chapeau">
          Choisissez une case sur le tapis, posez vos jetons, lancez la bille.
          37 cases, un seul zéro.
        </p>
      </header>

      <div className="jeu">
        <div>
          <section className="table" aria-label="Table de roulette">
            <div className="roulette__resultat" aria-live="polite">
              {bille ? (
                <>
                  <div className={`bille bille--${couleurDe(bille.numero)} ${bille.roule ? 'bille--roule' : ''}`}>
                    {bille.numero}
                  </div>
                  {resultat && !bille.roule && (
                    <p className="roulette__verdict">
                      {net > 0 ? 'Gagné sur ' : 'Perdu sur '}{nommerPari(resultat.etat.pari)}
                      <span className={`montant ${net > 0 ? 'gain' : 'perte'}`}>{signe(net)} jetons</span>
                    </p>
                  )}
                </>
              ) : (
                <p className="table__titre" style={{ margin: 0 }}>Les jeux sont faits quand vous lancez la bille</p>
              )}
            </div>

            <div className="tapis" role="group" aria-label="Tapis de mise">
              {TAPIS.map((c) => {
                const choisie = c.pari === pari;
                const gagnante = resultat && !bille?.roule && caseGagne(c.pari, resultat.etat.numero)
                  && c.pari.startsWith('plein');
                const style = {
                  '--dc': c.d[0], '--dr': c.d[1], '--mc': c.m[0], '--mr': c.m[1],
                } as CSSProperties;
                return (
                  <button
                    key={c.pari}
                    type="button"
                    className={`case ${c.classe} ${c.vertical ? 'case--vertical' : ''} ${gagnante ? 'case--gagnante' : ''}`}
                    style={style}
                    aria-pressed={choisie}
                    aria-label={`Miser sur ${nommerPari(c.pari)}, paie ${c.paie}`}
                    onClick={() => setPari(c.pari)}
                    disabled={encours}
                  >
                    {c.pari === 'rouge' ? <span className="losange losange--rouge" /> :
                     c.pari === 'noir' ? <span className="losange losange--noir" /> : c.libelle}
                    {choisie && mise > 0 && (
                      <span className="case__jeton"><Jeton valeur={mise >= 500 ? 500 : mise >= 100 ? 100 : mise >= 25 ? 25 : mise >= 5 ? 5 : 1} taille="xs" /></span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <Historique vide="Aucun coup joué pour l'instant">
            {historique.map((h) => (
              <span
                key={h.partie_id}
                className={`puce puce--${h.etat.couleur}`}
                title={`${h.etat.numero} — ${signe(Number(h.gain) - Number(h.mise))} jetons`}
              >
                {h.etat.numero}
              </span>
            ))}
          </Historique>
        </div>

        <aside className="panneau" aria-label="Votre mise">
          <p className="mise__cible">
            Sur <strong>{nommerPari(pari)}</strong> — paie {caseChoisie?.paie}
          </p>
          <Mise valeur={mise} onChange={setMise} min={min} max={max} solde={solde} disabled={encours} />
          {erreur && <p className="alerte" role="alert">{erreur}</p>}
          <button className="bouton bouton--principal bouton--grand" onClick={() => void lancer()} disabled={!peutLancer}>
            {encours ? 'La bille tourne…' : `Lancer la bille`}
          </button>
        </aside>
      </div>

      <SousLeCapot>
        <p>
          Le tirage, le débit de la mise et le crédit du gain se font dans une seule
          fonction PL/pgSQL, <code>jouer_roulette()</code>, donc dans une seule
          transaction. Le front n'additionne jamais rien : le solde affiché est celui
          que renvoie la base.
        </p>
        <p>
          <strong>Tirage vérifiable.</strong> Le casino publie l'empreinte SHA-256 de
          sa graine <em>avant</em> le tirage et ne révèle la graine qu'<em>après</em>.
          Il ne peut donc pas choisir le numéro après coup.
          {resultat && (
            <>
              {' '}Pour le dernier coup (partie n° {resultat.partie_id}), l'empreinte publiée
              était <code>{resultat.seed_hash.slice(0, 16)}…</code> et la graine révélée
              est <code>{resultat.server_seed.slice(0, 16)}…</code>. Rejouez le calcul
              avec <code>alea(server_seed, client_seed, nonce, 0, 37)</code>.
            </>
          )}
        </p>
        <p>
          Le RTP est de 36/37 soit 97,30 % pour tous les paris : c'est le zéro, et lui
          seul, qui fait la marge du casino. Mise actuelle : {jetons(mise)} jetons.
        </p>
      </SousLeCapot>
    </>
  );
}
